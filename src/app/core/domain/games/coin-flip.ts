import { hashCanonicalFields } from './canonical';
import type { GameRole, RuleResult } from './game-contracts';

export type CoinSide = 'heads' | 'tails';

export interface CoinFlipContext {
  readonly gameId: string;
  readonly gameVersion: string;
  readonly sessionId: string;
  readonly roundId: string;
}

export interface CoinFlipCommit {
  readonly role: GameRole;
  readonly value: string;
}

export interface CoinFlipReveal {
  readonly role: GameRole;
  readonly choice: CoinSide;
  readonly nonce: string;
}

export interface CoinFlipRoundInput extends CoinFlipContext {
  readonly commits: readonly CoinFlipCommit[];
  readonly reveals: readonly CoinFlipReveal[];
  readonly usedNonces?: readonly string[];
}

export interface CoinFlipResult {
  readonly side: CoinSide;
  readonly initiatorScore: 0 | 1;
  readonly responderScore: 0 | 1;
}

const ROLE_ORDER: readonly GameRole[] = Object.freeze(['initiator', 'responder']);

function roleIndex(role: GameRole): number {
  return role === 'initiator' ? 0 : 1;
}

function roundFields(
  context: CoinFlipContext,
  role: GameRole,
  choice: CoinSide,
  nonce: string,
): readonly string[] {
  return [
    'atomic-chat:coinflip:commit',
    '1',
    context.gameId,
    context.gameVersion,
    context.sessionId,
    context.roundId,
    role,
    choice,
    nonce,
  ];
}

export function createCoinFlipCommit(
  context: CoinFlipContext,
  reveal: CoinFlipReveal,
): CoinFlipCommit {
  return Object.freeze({
    role: reveal.role,
    value: hashCanonicalFields(roundFields(context, reveal.role, reveal.choice, reveal.nonce)),
  });
}

export function verifyCoinFlipCommit(
  context: CoinFlipContext,
  commit: CoinFlipCommit,
  reveal: CoinFlipReveal,
): RuleResult<void> {
  if (commit.role !== reveal.role)
    return {
      ok: false,
      error: {
        code: 'INVALID_COMMIT',
        message: 'Commit and reveal roles do not match',
        role: reveal.role,
      },
    };
  if (
    commit.value !==
    hashCanonicalFields(roundFields(context, reveal.role, reveal.choice, reveal.nonce))
  )
    return {
      ok: false,
      error: {
        code: 'INVALID_COMMIT',
        message: 'Reveal does not match the commit',
        role: reveal.role,
      },
    };
  return { ok: true, value: undefined };
}

export function canonicalCoinFlipCommits(
  commits: readonly CoinFlipCommit[],
): readonly CoinFlipCommit[] {
  return Object.freeze(
    [...commits].sort((left, right) => roleIndex(left.role) - roleIndex(right.role)),
  );
}

export function addCoinFlipCommit(
  commits: readonly CoinFlipCommit[],
  commit: CoinFlipCommit,
): RuleResult<readonly CoinFlipCommit[]> {
  if (commits.some((current) => current.role === commit.role))
    return {
      ok: false,
      error: {
        code: 'DUPLICATE_COMMIT',
        message: 'Only one commit is allowed per role',
        role: commit.role,
      },
    };
  return { ok: true, value: canonicalCoinFlipCommits([...commits, Object.freeze({ ...commit })]) };
}

function findByRole<T extends { readonly role: GameRole }>(
  values: readonly T[],
  role: GameRole,
): T | undefined {
  return values.find((value) => value.role === role);
}

function scoreFor(choice: CoinSide, side: CoinSide): 0 | 1 {
  return choice === side ? 1 : 0;
}

export function resolveCoinFlipRound(input: CoinFlipRoundInput): RuleResult<CoinFlipResult> {
  const commits = canonicalCoinFlipCommits(input.commits);
  const reveals = [...input.reveals];
  for (const role of ROLE_ORDER) {
    if (!findByRole(commits, role) || !findByRole(reveals, role))
      return {
        ok: false,
        error: { code: 'INCOMPLETE_ROUND', message: 'Both commit-reveal pairs are required' },
      };
  }
  if (commits.length !== 2 || reveals.length !== 2)
    return {
      ok: false,
      error: {
        code: 'INVALID_REVEAL',
        message: 'Exactly two roles are required',
        role: 'initiator',
      },
    };
  const emptyNonce = reveals.find((reveal) => reveal.nonce.length === 0);
  if (emptyNonce)
    return {
      ok: false,
      error: { code: 'INVALID_REVEAL', message: 'Nonce cannot be empty', role: emptyNonce.role },
    };
  if (new Set(reveals.map((reveal) => reveal.nonce)).size !== reveals.length)
    return {
      ok: false,
      error: { code: 'NONCE_REUSED', message: 'A nonce cannot be reused in the same round' },
    };
  if (input.usedNonces?.some((nonce) => reveals.some((reveal) => reveal.nonce === nonce)))
    return {
      ok: false,
      error: { code: 'NONCE_REUSED', message: 'A nonce was already used by an earlier round' },
    };

  for (const role of ROLE_ORDER) {
    const commit = findByRole(commits, role);
    const reveal = findByRole(reveals, role);
    if (!commit || !reveal)
      return { ok: false, error: { code: 'INCOMPLETE_ROUND', message: 'Missing role reveal' } };
    const verification = verifyCoinFlipCommit(input, commit, reveal);
    if (!verification.ok) return verification;
  }
  const initiatorReveal = findByRole(reveals, 'initiator');
  const responderReveal = findByRole(reveals, 'responder');
  if (!initiatorReveal || !responderReveal)
    return {
      ok: false,
      error: { code: 'INCOMPLETE_ROUND', message: 'Both role reveals are required' },
    };

  const resultHash = hashCanonicalFields([
    'atomic-chat:coinflip:result',
    '1',
    input.sessionId,
    input.roundId,
    initiatorReveal.nonce,
    responderReveal.nonce,
  ]);
  const firstByte = Number.parseInt(resultHash.slice(0, 2), 16);
  const side: CoinSide = (firstByte & 1) === 0 ? 'heads' : 'tails';
  return {
    ok: true,
    value: Object.freeze({
      side,
      initiatorScore: scoreFor(initiatorReveal.choice, side),
      responderScore: scoreFor(responderReveal.choice, side),
    }),
  };
}
