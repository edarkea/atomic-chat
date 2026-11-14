import {
  REVERSI_BOARD_CELLS,
  REVERSI_GAME_ID,
  TIC_TAC_TOE_BOARD_CELLS,
  TIC_TAC_TOE_GAME_ID,
} from '../../core/domain';
import type {
  GameId,
  GameRole,
  GameSessionDto,
  GameSessionState,
  GameSnapshotDto,
  ReversiState,
  TicTacToeState,
} from '../../core/domain';

export type BoardCell = 'empty' | GameRole;

export const REVERSI_DEFAULT_FOCUS_INDEX = 19;

export const BOARD_VISIBLE_STATES: ReadonlySet<GameSessionState> = new Set([
  'active',
  'paused',
  'resync-required',
  'finished',
  'abandoned',
]);

export const SESSION_STATE_LABELS: Readonly<Record<GameSessionState, string>> = {
  invited: '',
  accepted: 'PARTIDA ACEPTADA · INICIANDO',
  active: 'EN CURSO',
  paused: 'PAUSADA · DESCONECTADA',
  'resync-required': 'SINCRONIZACIÓN REQUERIDA',
  rejected: 'INVITACIÓN RECHAZADA',
  cancelled: 'CANCELADA',
  expired: 'EXPIRADA',
  finished: 'FINALIZADA',
  abandoned: 'ABANDONADA',
  closed: 'JUEGO FINALIZADO',
};

export const FALLBACK_GAME_NAMES: Readonly<Record<string, string>> = {
  [TIC_TAC_TOE_GAME_ID]: 'Tic-Tac-Toe',
  [REVERSI_GAME_ID]: 'Reversi',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRole(value: unknown): value is GameRole {
  return value === 'initiator' || value === 'responder';
}

function isTurn(value: unknown): value is GameRole | null {
  return value === null || isRole(value);
}

function isGameStatus(value: unknown): value is 'active' | 'won' | 'draw' {
  return value === 'active' || value === 'won' || value === 'draw';
}

function isBoard(value: unknown, size: number): value is readonly BoardCell[] {
  return (
    Array.isArray(value) &&
    value.length === size &&
    value.every((cell) => cell === 'empty' || isRole(cell))
  );
}

export function isTicTacToeState(value: unknown): value is TicTacToeState {
  if (!isRecord(value) || !isBoard(value['board'], TIC_TAC_TOE_BOARD_CELLS)) return false;
  return (
    isTurn(value['turn']) && isGameStatus(value['status']) && Number.isInteger(value['moveCount'])
  );
}

export function isReversiState(value: unknown): value is ReversiState {
  if (!isRecord(value) || !isBoard(value['board'], REVERSI_BOARD_CELLS)) return false;
  return (
    isTurn(value['turn']) &&
    isGameStatus(value['status']) &&
    (value['consecutivePasses'] === 0 ||
      value['consecutivePasses'] === 1 ||
      value['consecutivePasses'] === 2)
  );
}

export function stateFor<State>(
  session: GameSessionDto | undefined,
  snapshot: GameSnapshotDto | undefined,
  gameId: GameId,
  isState: (value: unknown) => value is State,
): State | undefined {
  if (session?.gameId !== gameId || !snapshot || !isState(snapshot.state)) return undefined;
  return snapshot.state;
}
