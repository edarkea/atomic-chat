import type { Result, TypedDomainEvent } from '../domain';
import type {
  GameActionReceipt,
  GameCatalogRequest,
  GameConversationRequest,
  GameDomainEventPayload,
  GameDomainEventType,
  GameInviteRequest,
  GameMoveRequest,
  GameSessionDto,
  GameSessionRequest,
  GameSnapshotDto,
  GameSubscriptionRequest,
  OfficialGameCatalog,
} from '../domain';

export interface GamesPort {
  catalog(input: GameCatalogRequest): Promise<Result<OfficialGameCatalog>>;
  sessions(input: GameConversationRequest): Promise<Result<ReadonlyArray<GameSessionDto>>>;
  snapshot(input: GameSessionRequest): Promise<Result<GameSnapshotDto>>;
  invite(input: GameInviteRequest): Promise<Result<GameActionReceipt>>;
  accept(input: GameSessionRequest): Promise<Result<GameActionReceipt>>;
  reject(input: GameSessionRequest): Promise<Result<GameActionReceipt>>;
  cancel(input: GameSessionRequest): Promise<Result<GameActionReceipt>>;
  start(input: GameSessionRequest): Promise<Result<GameActionReceipt>>;
  move(input: GameMoveRequest): Promise<Result<GameActionReceipt>>;
  resign(input: GameSessionRequest): Promise<Result<GameActionReceipt>>;
  resync(input: GameSessionRequest): Promise<Result<GameActionReceipt>>;
  rematch(input: GameSessionRequest): Promise<Result<GameActionReceipt>>;
  close(input: GameSessionRequest): Promise<Result<GameActionReceipt>>;
  subscribe(
    input: GameSubscriptionRequest,
    listener: (event: TypedDomainEvent) => void,
  ): () => void;
}

export type GameEventPayload = GameDomainEventPayload;
export type GameEventType = GameDomainEventType;
