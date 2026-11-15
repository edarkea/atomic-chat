import type {
  GameApiVersion,
  GameDescriptorCore,
  GameId,
  GameRole,
  GameSessionState,
  GameVersion,
  OfficialGameRegistryEntry,
} from './games/game-contracts';
import type { ContractVersion, RequestId } from './domain-primitives';

export type GameOperation =
  | 'invite'
  | 'accept'
  | 'reject'
  | 'cancel'
  | 'start'
  | 'move'
  | 'resign'
  | 'resync'
  | 'rematch'
  | 'close';

export type GameOperationStatus =
  'requested' | 'proposal-sent' | 'confirmation-pending' | 'accepted';

export interface GameSessionDto {
  readonly accountId: string;
  readonly conversationId: string;
  readonly peerBareJid: string;
  readonly sessionId: string;
  readonly gameId: GameId;
  readonly gameVersion: GameVersion;
  readonly apiVersion: GameApiVersion;
  readonly localRole: GameRole;
  readonly state: GameSessionState;
  readonly revision: number;
  readonly stateHash: string;
  readonly sessionGeneration: number;
  readonly connectionGeneration: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GameSnapshotDto {
  readonly sessionId: string;
  readonly state: unknown;
  readonly revision: number;
  readonly stateHash: string;
  /** Main-derived legal moves for presentation; the Renderer never computes rules. */
  readonly legalMoves?: readonly number[];
  /** Main-derived Reversi pass availability for the confirmed turn. */
  readonly passAllowed?: boolean;
}

export interface GameActionReceipt {
  readonly operation: GameOperation;
  readonly status: GameOperationStatus;
  readonly session: GameSessionDto;
  readonly snapshot?: GameSnapshotDto;
  readonly eventId?: string;
  readonly revision?: number;
}

export interface GameCatalogRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
}

export interface GameConversationRequest extends GameCatalogRequest {
  readonly conversationId: string;
}

export interface GameSessionRequest extends GameConversationRequest {
  readonly sessionId: string;
  readonly sessionGeneration?: number;
  readonly connectionGeneration?: number;
}

export interface GameInviteRequest extends GameConversationRequest {
  readonly gameId: GameId;
  readonly gameVersion: GameVersion;
}

export interface GameMoveRequest extends GameSessionRequest {
  readonly actor: GameRole;
  readonly move: unknown;
  readonly eventId?: string;
}

export interface GameSubscriptionRequest extends GameCatalogRequest {
  readonly conversationId?: string;
  readonly sessionId?: string;
}

export type GameDomainEventType =
  | 'game.sessionChanged'
  | 'game.invitationReceived'
  | 'game.invitationUpdated'
  | 'game.moveAccepted'
  | 'game.moveConfirmed'
  | 'game.stateSynchronized'
  | 'game.syncRequired'
  | 'game.remoteError'
  | 'game.transportError'
  | 'game.eventDuplicate';

export interface GameDomainEventPayload {
  readonly accountId: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly connectionGeneration: number;
  readonly session?: GameSessionDto;
  readonly snapshot?: GameSnapshotDto;
  readonly eventId?: string;
  readonly revision?: number;
  readonly stateHash?: string;
  readonly localRevision?: number;
  readonly remoteRevision?: number;
  readonly localStateHash?: string;
  readonly remoteStateHash?: string;
  readonly actorSeq?: number;
  readonly code?: string;
}

export type OfficialGameCatalog = readonly OfficialGameRegistryEntry[];
export type GameDescriptor = GameDescriptorCore & OfficialGameRegistryEntry;
