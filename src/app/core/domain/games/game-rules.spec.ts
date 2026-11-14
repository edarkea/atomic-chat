import { describe, expect, it } from 'vitest';
import {
  addCoinFlipCommit,
  bytesToHex,
  canonicalCoinFlipCommits,
  createCoinFlipCommit,
  hashCanonicalFields,
  resolveCoinFlipRound,
  serializeCanonicalFields,
  sha256,
  TIC_TAC_TOE_WINNING_LINES,
  verifyCoinFlipCommit,
} from './index';
import type {
  CoinFlipContext,
  CoinFlipReveal,
  EventApplication,
  GameErrorCode,
  GameReplicaSnapshot,
  ReversiCell,
  RuleResult,
  ReversiState,
  TicTacToeMove,
} from './index';
import {
  applyReversiMove,
  createReversiState,
  reversiCaptures,
  reversiCounts,
  reversiLegalMoves,
  reversiRules,
} from './reversi';
import {
  applyTicTacToeMove,
  createTicTacToeState,
  hashTicTacToeState,
  ticTacToeRules,
} from './tic-tac-toe';
import { applySequencedEvent, createGameReplica, sequenceProposal } from './replica';

function expectOk<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error('Expected a successful rule result');
  return result.value;
}

function expectErrorCode<T>(result: RuleResult<T>): GameErrorCode {
  if (result.ok) throw new Error('Expected a rule error');
  return result.error.code;
}

function expectApplied<State>(result: EventApplication<State>): GameReplicaSnapshot<State> {
  if (result.kind !== 'applied') throw new Error('Expected an applied event');
  return result.snapshot;
}

function expectRejectedCode<State>(result: EventApplication<State>): GameErrorCode {
  if (result.kind !== 'rejected') throw new Error('Expected a rejected event');
  return result.error.code;
}

function customReversiState(
  cells: ReadonlyArray<ReversiCell>,
  turn: 'initiator' | 'responder',
): ReversiState {
  return Object.freeze({
    board: Object.freeze([...cells]),
    turn,
    status: 'active',
    consecutivePasses: 0,
  });
}

function emptyReversiBoard(): ReversiCell[] {
  return Array.from({ length: 64 }, () => 'empty' as ReversiCell);
}

describe('canonical game primitives', () => {
  it('uses length-prefixed UTF-8 fields and stable SHA-256', () => {
    expect(serializeCanonicalFields(['a', 'é'])).toBe('000000016100000002c3a9');
    expect(bytesToHex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashCanonicalFields(['abc'])).toBe(
      'd04b72a650ce0f8ce4963330a53ee2832733d2baeffff3c1d8e256cca096d120',
    );
  });

  it('keeps game hashes stable for equal immutable snapshots', () => {
    const first = createTicTacToeState();
    const second = createTicTacToeState();
    expect(first).toEqual(second);
    expect(hashTicTacToeState(first)).toBe(hashTicTacToeState(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.board)).toBe(true);
  });
});

describe('Tic Tac Toe rules', () => {
  it('starts from canonical roles rather than local perspective', () => {
    expect(createTicTacToeState()).toEqual(createTicTacToeState());
    expect(createTicTacToeState().turn).toBe('initiator');
  });

  it('alternates turns and rejects occupied, out-of-range, wrong-turn and finished moves', () => {
    const initial = createTicTacToeState();
    const firstMove: TicTacToeMove = { actor: 'initiator', index: 0 };
    const afterFirst = expectOk(applyTicTacToeMove(initial, firstMove));
    expect(afterFirst.turn).toBe('responder');
    expect(afterFirst.board[0]).toBe('initiator');
    expect(expectErrorCode(applyTicTacToeMove(initial, { actor: 'responder', index: 0 }))).toBe(
      'NOT_YOUR_TURN',
    );
    expect(expectErrorCode(applyTicTacToeMove(afterFirst, { actor: 'responder', index: 0 }))).toBe(
      'CELL_OCCUPIED',
    );
    expect(expectErrorCode(applyTicTacToeMove(afterFirst, { actor: 'responder', index: 9 }))).toBe(
      'OUT_OF_RANGE',
    );
  });

  it('detects all rows, columns and diagonals and stops after a win', () => {
    const moves: readonly TicTacToeMove[] = [
      { actor: 'initiator', index: 0 },
      { actor: 'responder', index: 3 },
      { actor: 'initiator', index: 1 },
      { actor: 'responder', index: 4 },
      { actor: 'initiator', index: 2 },
    ];
    let state = createTicTacToeState();
    for (const move of moves) state = expectOk(applyTicTacToeMove(state, move));
    expect(ticTacToeRules.outcome(state)).toEqual({ status: 'won', winner: 'initiator' });
    expect(expectErrorCode(applyTicTacToeMove(state, { actor: 'responder', index: 8 }))).toBe(
      'GAME_FINISHED',
    );
  });

  it('covers all eight canonical winning combinations', () => {
    expect(TIC_TAC_TOE_WINNING_LINES).toHaveLength(8);
    for (const line of TIC_TAC_TOE_WINNING_LINES) {
      const safeResponderCells = Array.from({ length: 9 }, (_, index) => index).filter(
        (index) => !line.includes(index),
      );
      let state = createTicTacToeState();
      for (let moveNumber = 0; moveNumber < line.length; moveNumber++) {
        state = expectOk(
          applyTicTacToeMove(state, { actor: 'initiator', index: line[moveNumber] }),
        );
        if (moveNumber < line.length - 1)
          state = expectOk(
            applyTicTacToeMove(state, {
              actor: 'responder',
              index: safeResponderCells[moveNumber],
            }),
          );
      }
      expect(state.winner).toBe('initiator');
    }
  });

  it('detects a draw and never mutates the previous snapshot on invalid action', () => {
    const moves: readonly TicTacToeMove[] = [
      { actor: 'initiator', index: 0 },
      { actor: 'responder', index: 1 },
      { actor: 'initiator', index: 2 },
      { actor: 'responder', index: 4 },
      { actor: 'initiator', index: 3 },
      { actor: 'responder', index: 5 },
      { actor: 'initiator', index: 7 },
      { actor: 'responder', index: 6 },
      { actor: 'initiator', index: 8 },
    ];
    let state = createTicTacToeState();
    for (const move of moves) state = expectOk(applyTicTacToeMove(state, move));
    expect(state.status).toBe('draw');
    const before = JSON.stringify(state);
    expect(applyTicTacToeMove(state, { actor: 'responder', index: 0 }).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('Reversi rules', () => {
  it('creates the standard position and four initial legal moves', () => {
    const state = createReversiState();
    expect(reversiCounts(state.board)).toEqual({ initiator: 2, responder: 2, empty: 60 });
    expect(reversiLegalMoves(state, 'initiator')).toEqual([19, 26, 37, 44]);
  });

  it('captures in multiple directions and preserves the prior snapshot', () => {
    const board = emptyReversiBoard();
    board[24] = 'initiator';
    board[25] = 'responder';
    board[26] = 'responder';
    board[0] = 'initiator';
    board[9] = 'responder';
    board[18] = 'responder';
    board[48] = 'initiator';
    board[41] = 'responder';
    board[34] = 'responder';
    const state = customReversiState(board, 'initiator');
    expect(reversiCaptures(state.board, 27, 'initiator')).toEqual([18, 9, 26, 25, 34, 41]);
    const next = expectOk(
      applyReversiMove(state, { kind: 'place', actor: 'initiator', index: 27 }),
    );
    expect(next.board[27]).toBe('initiator');
    expect(next.board[26]).toBe('initiator');
    expect(next.board[18]).toBe('initiator');
    expect(state.board[27]).toBe('empty');
  });

  it('supports edge and corner captures while rejecting no-capture moves', () => {
    const board = emptyReversiBoard();
    board[1] = 'responder';
    board[2] = 'initiator';
    board[3] = 'initiator';
    const state = customReversiState(board, 'initiator');
    expect(reversiCaptures(state.board, 0, 'initiator')).toEqual([1]);
    expect(
      expectOk(applyReversiMove(state, { kind: 'place', actor: 'initiator', index: 0 })).board[0],
    ).toBe('initiator');
    expect(
      expectErrorCode(applyReversiMove(state, { kind: 'place', actor: 'initiator', index: 10 })),
    ).toBe('NO_CAPTURE');
  });

  it('requires passes and finishes after two consecutive passes', () => {
    const board = Array.from({ length: 64 }, () => 'initiator' as ReversiCell);
    board[0] = 'empty';
    board[1] = 'responder';
    const state = customReversiState(board, 'responder');
    expect(reversiLegalMoves(state, 'responder')).toEqual([]);
    expect(applyReversiMove(state, { kind: 'pass', actor: 'responder' }).ok).toBe(true);
    const afterFirstPass = expectOk(applyReversiMove(state, { kind: 'pass', actor: 'responder' }));
    expect(afterFirstPass.turn).toBe('initiator');
    expect(
      expectErrorCode(applyReversiMove(afterFirstPass, { kind: 'pass', actor: 'initiator' })),
    ).toBe('PASS_NOT_ALLOWED');

    const afterPlace = expectOk(
      applyReversiMove(afterFirstPass, { kind: 'place', actor: 'initiator', index: 0 }),
    );
    const afterResponderPass = expectOk(
      applyReversiMove(afterPlace, { kind: 'pass', actor: 'responder' }),
    );
    const finished = expectOk(
      applyReversiMove(afterResponderPass, { kind: 'pass', actor: 'initiator' }),
    );
    expect(finished.status).toBe('won');
    expect(finished.winner).toBe('initiator');
  });

  it('reports victory, defeat and draw counts in a deterministic outcome', () => {
    const board = emptyReversiBoard();
    board[0] = 'initiator';
    board[1] = 'initiator';
    board[3] = 'responder';
    const state = customReversiState(board, 'initiator');
    const first = expectOk(applyReversiMove(state, { kind: 'pass', actor: 'initiator' }));
    const second = expectOk(applyReversiMove(first, { kind: 'pass', actor: 'responder' }));
    expect(reversiRules.outcome(second)).toEqual({
      status: 'won',
      winner: 'initiator',
      counts: { initiator: 2, responder: 1, empty: 61 },
    });
    const empty = customReversiState(emptyReversiBoard(), 'initiator');
    const emptyAfterFirstPass = expectOk(
      applyReversiMove(empty, { kind: 'pass', actor: 'initiator' }),
    );
    const emptyFinished = expectOk(
      applyReversiMove(emptyAfterFirstPass, { kind: 'pass', actor: 'responder' }),
    );
    expect(reversiRules.outcome(emptyFinished)).toEqual({
      status: 'draw',
      counts: { initiator: 0, responder: 0, empty: 64 },
    });
  });
});

describe('two-client sequencer and replica convergence', () => {
  it('converges after inverted delivery, duplicate delivery and replay', () => {
    const sessionId = 'session-1';
    const initiator = createGameReplica(ticTacToeRules, sessionId);
    const proposalOne: TicTacToeMove = { actor: 'initiator', index: 0 };
    const eventOne = expectOk(
      sequenceProposal(ticTacToeRules, initiator, {
        eventId: 'event-1',
        sessionId,
        actor: 'initiator',
        actorSeq: 1,
        expectedRevision: 0,
        previousStateHash: initiator.stateHash,
        move: proposalOne,
      }),
    );
    const afterOne = expectApplied(applySequencedEvent(ticTacToeRules, initiator, eventOne));
    const eventTwo = expectOk(
      sequenceProposal(ticTacToeRules, afterOne, {
        eventId: 'event-2',
        sessionId,
        actor: 'responder',
        actorSeq: 1,
        expectedRevision: 1,
        previousStateHash: afterOne.stateHash,
        move: { actor: 'responder', index: 4 },
      }),
    );

    let responder = createGameReplica(ticTacToeRules, sessionId);
    expect(expectRejectedCode(applySequencedEvent(ticTacToeRules, responder, eventTwo))).toBe(
      'REVISION_GAP',
    );
    responder = expectApplied(applySequencedEvent(ticTacToeRules, responder, eventOne));
    responder = expectApplied(applySequencedEvent(ticTacToeRules, responder, eventTwo));
    expect(applySequencedEvent(ticTacToeRules, responder, eventTwo).kind).toBe('duplicate');
    expect(applySequencedEvent(ticTacToeRules, responder, eventOne).kind).toBe('duplicate');
    expect(
      applySequencedEvent(ticTacToeRules, responder, { ...eventOne, eventId: 'late-copy' }).kind,
    ).toBe('ignored-late');
    expect(responder.stateHash).toBe(eventTwo.resultingStateHash);
    expect(responder.revision).toBe(2);
  });

  it('rejects concurrent non-commutative proposals instead of pretending to reach consensus', () => {
    const replica = createGameReplica(ticTacToeRules, 'session-2');
    const base = {
      sessionId: 'session-2',
      actorSeq: 1,
      expectedRevision: 0,
      previousStateHash: replica.stateHash,
    } as const;
    const first = expectOk(
      sequenceProposal(ticTacToeRules, replica, {
        ...base,
        eventId: 'first',
        actor: 'initiator',
        move: { actor: 'initiator', index: 0 },
      }),
    );
    const afterFirst = expectApplied(applySequencedEvent(ticTacToeRules, replica, first));
    expect(
      expectErrorCode(
        sequenceProposal(ticTacToeRules, afterFirst, {
          ...base,
          eventId: 'concurrent',
          actor: 'responder',
          move: { actor: 'responder', index: 1 },
        }),
      ),
    ).toBe('PROPOSAL_CONFLICT');
  });
});

describe('Cara o Cruz commit-reveal', () => {
  const context: CoinFlipContext = {
    gameId: 'com.example.coinflip',
    gameVersion: '1.0.0',
    sessionId: 'session-coin',
    roundId: 'round-1',
  };
  const initiatorReveal: CoinFlipReveal = { role: 'initiator', choice: 'heads', nonce: 'nonce-a' };
  const responderReveal: CoinFlipReveal = { role: 'responder', choice: 'tails', nonce: 'nonce-b' };

  it('accepts both commit orders and derives the same result', () => {
    const initiatorCommit = createCoinFlipCommit(context, initiatorReveal);
    const responderCommit = createCoinFlipCommit(context, responderReveal);
    const firstOrder = resolveCoinFlipRound({
      ...context,
      commits: [initiatorCommit, responderCommit],
      reveals: [initiatorReveal, responderReveal],
    });
    const invertedOrder = resolveCoinFlipRound({
      ...context,
      commits: canonicalCoinFlipCommits([responderCommit, initiatorCommit]),
      reveals: [responderReveal, initiatorReveal],
    });
    expect(firstOrder).toEqual(invertedOrder);
    const resolved = expectOk(firstOrder);
    const expectedSide =
      Number.parseInt(
        hashCanonicalFields([
          'atomic-chat:coinflip:result',
          '1',
          context.sessionId,
          context.roundId,
          initiatorReveal.nonce,
          responderReveal.nonce,
        ]).slice(0, 2),
        16,
      ) & 1;
    expect(resolved.side).toBe(expectedSide === 0 ? 'heads' : 'tails');
    expect(resolved.initiatorScore).toBe(resolved.side === initiatorReveal.choice ? 1 : 0);
    expect(resolved.responderScore).toBe(resolved.side === responderReveal.choice ? 1 : 0);
    expect(verifyCoinFlipCommit(context, initiatorCommit, initiatorReveal).ok).toBe(true);
    expect(verifyCoinFlipCommit(context, responderCommit, responderReveal).ok).toBe(true);
  });

  it('treats commits as a conmutative set but rejects repeated roles and nonces', () => {
    const first = createCoinFlipCommit(context, initiatorReveal);
    expect(addCoinFlipCommit([], first).ok).toBe(true);
    expect(expectErrorCode(addCoinFlipCommit([first], first))).toBe('DUPLICATE_COMMIT');
    const secondReveal: CoinFlipReveal = { ...responderReveal, nonce: initiatorReveal.nonce };
    const result = resolveCoinFlipRound({
      ...context,
      commits: [first, createCoinFlipCommit(context, secondReveal)],
      reveals: [initiatorReveal, secondReveal],
    });
    expect(expectErrorCode(result)).toBe('NONCE_REUSED');
  });

  it('rejects false reveals, incomplete rounds and previously used nonces', () => {
    const initiatorCommit = createCoinFlipCommit(context, initiatorReveal);
    const responderCommit = createCoinFlipCommit(context, responderReveal);
    expect(
      expectErrorCode(
        verifyCoinFlipCommit(context, initiatorCommit, { ...initiatorReveal, choice: 'tails' }),
      ),
    ).toBe('INVALID_COMMIT');
    expect(
      expectErrorCode(
        resolveCoinFlipRound({
          ...context,
          commits: [initiatorCommit, responderCommit],
          reveals: [initiatorReveal],
        }),
      ),
    ).toBe('INCOMPLETE_ROUND');
    expect(
      expectErrorCode(
        resolveCoinFlipRound({
          ...context,
          commits: [initiatorCommit, responderCommit],
          reveals: [initiatorReveal, responderReveal],
          usedNonces: ['nonce-b'],
        }),
      ),
    ).toBe('NONCE_REUSED');
  });
});
