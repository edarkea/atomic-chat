export type GameRole = 'initiator' | 'responder';

export type GameId = string;
export type GameVersion = string;
export type GameApiVersion = 1;

export type GameSessionState =
  | 'invited'
  | 'accepted'
  | 'active'
  | 'paused'
  | 'resync-required'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'finished'
  | 'abandoned'
  | 'closed';

export type GameDistribution = 'official' | 'external';
export type GameSource = 'built-in' | 'installed';
export type GameCapability = 'invites' | 'replay' | 'resync' | 'score';

export interface GamePlayers {
  readonly min: 2;
  readonly max: 2;
}

export interface GameDescriptorCore {
  readonly gameId: GameId;
  readonly displayName: string;
  readonly version: GameVersion;
  readonly apiVersion: GameApiVersion;
  readonly players: GamePlayers;
  readonly capabilities: readonly GameCapability[];
}

/** Package contract. Distribution is assigned by the host registry, not the file. */
export interface ExternalGameManifest extends GameDescriptorCore {
  readonly manifestVersion: 1;
  readonly entrypoint: string;
  readonly assets?: readonly string[];
  readonly permissions: readonly [];
}

/** Built-in rules do not require a package entrypoint or manifest metadata. */
export interface OfficialGameDescriptor extends GameDescriptorCore {
  readonly distribution: 'official';
  readonly source: 'built-in';
}

export interface OfficialGameRegistryEntry extends OfficialGameDescriptor {
  readonly enabled: boolean;
}

export interface ExternalGameRegistryEntry extends ExternalGameManifest {
  readonly distribution: 'external';
  readonly source: 'installed';
  readonly integritySha256: string;
  readonly enabled: boolean;
  readonly installedAt: string;
}

export type GameRegistryEntry = OfficialGameRegistryEntry | ExternalGameRegistryEntry;

export type GameErrorCode =
  | 'INVALID_MOVE'
  | 'INVALID_ACTOR'
  | 'NOT_YOUR_TURN'
  | 'GAME_FINISHED'
  | 'OUT_OF_RANGE'
  | 'CELL_OCCUPIED'
  | 'NO_CAPTURE'
  | 'NO_LEGAL_MOVE'
  | 'PASS_NOT_ALLOWED'
  | 'INVALID_EVENT'
  | 'DUPLICATE_EVENT'
  | 'STALE_EVENT'
  | 'REVISION_GAP'
  | 'HASH_MISMATCH'
  | 'SEQUENCER_REQUIRED'
  | 'PROPOSAL_CONFLICT'
  | 'INVALID_COMMIT'
  | 'INCOMPLETE_ROUND'
  | 'DUPLICATE_COMMIT'
  | 'INVALID_REVEAL'
  | 'NONCE_REUSED';

export type GameRuleError =
  | { readonly code: 'INVALID_MOVE'; readonly message: string }
  | { readonly code: 'INVALID_ACTOR'; readonly message: string; readonly actor: GameRole }
  | { readonly code: 'NOT_YOUR_TURN'; readonly message: string; readonly expected: GameRole }
  | { readonly code: 'GAME_FINISHED'; readonly message: string }
  | { readonly code: 'OUT_OF_RANGE'; readonly message: string; readonly index: number }
  | { readonly code: 'CELL_OCCUPIED'; readonly message: string; readonly index: number }
  | { readonly code: 'NO_CAPTURE'; readonly message: string; readonly index: number }
  | { readonly code: 'NO_LEGAL_MOVE'; readonly message: string; readonly actor: GameRole }
  | { readonly code: 'PASS_NOT_ALLOWED'; readonly message: string; readonly actor: GameRole }
  | { readonly code: 'INVALID_EVENT'; readonly message: string }
  | { readonly code: 'DUPLICATE_EVENT'; readonly message: string; readonly eventId: string }
  | { readonly code: 'STALE_EVENT'; readonly message: string; readonly revision: number }
  | { readonly code: 'REVISION_GAP'; readonly message: string; readonly revision: number }
  | { readonly code: 'HASH_MISMATCH'; readonly message: string }
  | { readonly code: 'SEQUENCER_REQUIRED'; readonly message: string }
  | { readonly code: 'PROPOSAL_CONFLICT'; readonly message: string }
  | { readonly code: 'INVALID_COMMIT'; readonly message: string; readonly role: GameRole }
  | { readonly code: 'INCOMPLETE_ROUND'; readonly message: string }
  | { readonly code: 'DUPLICATE_COMMIT'; readonly message: string; readonly role: GameRole }
  | { readonly code: 'INVALID_REVEAL'; readonly message: string; readonly role: GameRole }
  | { readonly code: 'NONCE_REUSED'; readonly message: string };

export type RuleResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: GameRuleError };

export interface GameRules<State, Move, Outcome> {
  readonly gameId: GameId;
  readonly gameVersion: GameVersion;
  readonly initialState: () => State;
  readonly validateMove: (state: State, move: Move) => RuleResult<void>;
  readonly applyMove: (state: State, move: Move) => RuleResult<State>;
  readonly outcome: (state: State) => Outcome;
  readonly serializeState: (state: State) => string;
  readonly hashState: (state: State) => string;
}

export interface GameMoveProposal<Move> {
  readonly eventId: string;
  readonly sessionId: string;
  readonly actor: GameRole;
  readonly actorSeq: number;
  readonly expectedRevision: number;
  readonly previousStateHash: string;
  readonly move: Move;
}

export interface SequencedGameEvent<Move> extends GameMoveProposal<Move> {
  readonly sequencer: 'initiator';
  readonly revision: number;
  readonly resultingStateHash: string;
}

export interface GameReplicaSnapshot<State> {
  readonly sessionId: string;
  readonly state: State;
  readonly revision: number;
  readonly stateHash: string;
  readonly appliedEventIds: readonly string[];
}

export type EventApplication<State> =
  | { readonly kind: 'applied'; readonly snapshot: GameReplicaSnapshot<State> }
  | { readonly kind: 'duplicate'; readonly snapshot: GameReplicaSnapshot<State> }
  | { readonly kind: 'ignored-late'; readonly snapshot: GameReplicaSnapshot<State> }
  | { readonly kind: 'rejected'; readonly error: GameRuleError };
