import type {
  EventApplication,
  GameMoveProposal,
  GameReplicaSnapshot,
  GameRole,
  GameRules,
  RuleResult,
  SequencedGameEvent,
} from './game-contracts';

function hasAppliedEvent<State>(snapshot: GameReplicaSnapshot<State>, eventId: string): boolean {
  return snapshot.appliedEventIds.includes(eventId);
}

export function createGameReplica<State, Move, Outcome>(
  rules: GameRules<State, Move, Outcome>,
  sessionId: string,
): GameReplicaSnapshot<State> {
  const state = rules.initialState();
  return Object.freeze({
    sessionId,
    state,
    revision: 0,
    stateHash: rules.hashState(state),
    appliedEventIds: Object.freeze([]),
  });
}

export function sequenceProposal<State, Move, Outcome>(
  rules: GameRules<State, Move, Outcome>,
  current: GameReplicaSnapshot<State>,
  proposal: GameMoveProposal<Move>,
): RuleResult<SequencedGameEvent<Move>> {
  if (
    proposal.sessionId !== current.sessionId ||
    proposal.eventId.length === 0 ||
    !Number.isInteger(proposal.actorSeq) ||
    proposal.actorSeq < 1
  )
    return {
      ok: false,
      error: { code: 'INVALID_EVENT', message: 'Proposal identity or actor sequence is invalid' },
    };
  if (proposal.expectedRevision !== current.revision)
    return {
      ok: false,
      error: {
        code: 'PROPOSAL_CONFLICT',
        message: 'Proposal expectedRevision does not match the sequencer state',
      },
    };
  if (proposal.previousStateHash !== current.stateHash)
    return {
      ok: false,
      error: { code: 'HASH_MISMATCH', message: 'Proposal hash does not match the sequencer state' },
    };
  const applied = rules.applyMove(current.state, proposal.move);
  if (!applied.ok) return applied;
  const resultingStateHash = rules.hashState(applied.value);
  return {
    ok: true,
    value: Object.freeze({
      ...proposal,
      sequencer: 'initiator',
      revision: current.revision + 1,
      resultingStateHash,
    }),
  };
}

export function applySequencedEvent<State, Move, Outcome>(
  rules: GameRules<State, Move, Outcome>,
  current: GameReplicaSnapshot<State>,
  event: SequencedGameEvent<Move>,
): EventApplication<State> {
  if (
    event.sessionId !== current.sessionId ||
    event.eventId.length === 0 ||
    !Number.isInteger(event.actorSeq) ||
    event.actorSeq < 1
  )
    return {
      kind: 'rejected',
      error: { code: 'INVALID_EVENT', message: 'Event identity or actor sequence is invalid' },
    };
  if (hasAppliedEvent(current, event.eventId)) return { kind: 'duplicate', snapshot: current };
  if (event.revision <= current.revision)
    return {
      kind: 'ignored-late',
      snapshot: current,
    };
  if (event.sequencer !== 'initiator')
    return {
      kind: 'rejected',
      error: { code: 'SEQUENCER_REQUIRED', message: 'Only the initiator may assign revisions' },
    };
  if (event.revision > current.revision + 1)
    return {
      kind: 'rejected',
      error: {
        code: 'REVISION_GAP',
        message: 'The event arrived before its predecessor',
        revision: event.revision,
      },
    };
  if (event.expectedRevision !== current.revision)
    return {
      kind: 'rejected',
      error: {
        code: 'PROPOSAL_CONFLICT',
        message: 'The event expected a different current revision',
      },
    };
  if (event.previousStateHash !== current.stateHash)
    return {
      kind: 'rejected',
      error: {
        code: 'HASH_MISMATCH',
        message: 'The event previous hash differs from the snapshot',
      },
    };

  const applied = rules.applyMove(current.state, event.move);
  if (!applied.ok) return { kind: 'rejected', error: applied.error };
  const resultingStateHash = rules.hashState(applied.value);
  if (resultingStateHash !== event.resultingStateHash)
    return {
      kind: 'rejected',
      error: { code: 'HASH_MISMATCH', message: 'The event resulting hash is not reproducible' },
    };
  const snapshot = Object.freeze({
    sessionId: current.sessionId,
    state: applied.value,
    revision: event.revision,
    stateHash: resultingStateHash,
    appliedEventIds: Object.freeze([...current.appliedEventIds, event.eventId]),
  });
  return { kind: 'applied', snapshot };
}

export function roleOrder(role: GameRole): number {
  return role === 'initiator' ? 0 : 1;
}
