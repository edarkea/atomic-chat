import { Injectable } from '@angular/core';
import type {
  GameActionReceipt,
  GameCatalogRequest,
  GameConversationRequest,
  GameInviteRequest,
  GameMoveRequest,
  GameSessionRequest,
  GameSessionDto,
  GameSnapshotDto,
  GameSubscriptionRequest,
  OfficialGameCatalog,
  Result,
  TypedDomainEvent,
} from '../domain';
import { subscribeToDomainEvents } from '../domain/domain-event.validation';
import { getAtomicChatApi } from './electron-api';
import type { GamesPort } from './games.port';

const unavailable = <T>(requestId: string): Result<T> => ({
  ok: false,
  version: 1,
  error: {
    code: 'UNSUPPORTED',
    retryable: false,
    requestId,
    message: 'La API de juegos de Electron no está disponible.',
  },
});

@Injectable({ providedIn: 'root' })
export class ElectronGamesPort implements GamesPort {
  catalog(input: GameCatalogRequest): Promise<Result<OfficialGameCatalog>> {
    const api = getAtomicChatApi();
    return api ? api.games.catalog(input) : Promise.resolve(unavailable(input.requestId));
  }
  sessions(input: GameConversationRequest): Promise<Result<ReadonlyArray<GameSessionDto>>> {
    const api = getAtomicChatApi();
    return api ? api.games.sessions(input) : Promise.resolve(unavailable(input.requestId));
  }
  snapshot(input: GameSessionRequest): Promise<Result<GameSnapshotDto>> {
    const api = getAtomicChatApi();
    return api ? api.games.snapshot(input) : Promise.resolve(unavailable(input.requestId));
  }
  invite(input: GameInviteRequest): Promise<Result<GameActionReceipt>> {
    const api = getAtomicChatApi();
    return api ? api.games.invite(input) : Promise.resolve(unavailable(input.requestId));
  }
  accept(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    const api = getAtomicChatApi();
    return api ? api.games.accept(input) : Promise.resolve(unavailable(input.requestId));
  }
  reject(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    const api = getAtomicChatApi();
    return api ? api.games.reject(input) : Promise.resolve(unavailable(input.requestId));
  }
  cancel(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    const api = getAtomicChatApi();
    return api ? api.games.cancel(input) : Promise.resolve(unavailable(input.requestId));
  }
  start(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    const api = getAtomicChatApi();
    return api ? api.games.start(input) : Promise.resolve(unavailable(input.requestId));
  }
  move(input: GameMoveRequest): Promise<Result<GameActionReceipt>> {
    const api = getAtomicChatApi();
    return api ? api.games.move(input) : Promise.resolve(unavailable(input.requestId));
  }
  resign(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    const api = getAtomicChatApi();
    return api ? api.games.resign(input) : Promise.resolve(unavailable(input.requestId));
  }
  resync(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    const api = getAtomicChatApi();
    return api ? api.games.resync(input) : Promise.resolve(unavailable(input.requestId));
  }
  rematch(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    const api = getAtomicChatApi();
    return api ? api.games.rematch(input) : Promise.resolve(unavailable(input.requestId));
  }
  close(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    const api = getAtomicChatApi();
    return api ? api.games.close(input) : Promise.resolve(unavailable(input.requestId));
  }
  subscribe(
    input: GameSubscriptionRequest,
    listener: (event: TypedDomainEvent) => void,
  ): () => void {
    const subscribe = getAtomicChatApi()?.games.subscribe;
    return subscribe
      ? subscribeToDomainEvents((handler) => subscribe(input, handler), listener)
      : () => undefined;
  }
}
