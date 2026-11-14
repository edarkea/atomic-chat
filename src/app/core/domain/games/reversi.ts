import { hashCanonicalFields, serializeCanonicalFields } from './canonical';
import type { GameRole, GameRules, RuleResult } from './game-contracts';

export const REVERSI_BOARD_SIZE = 8;
export const REVERSI_BOARD_CELLS = REVERSI_BOARD_SIZE * REVERSI_BOARD_SIZE;
export const REVERSI_GAME_ID = 'com.atomicchat.reversi';
export const REVERSI_GAME_VERSION = '1.0.0';

export type ReversiCell = 'empty' | GameRole;
export type ReversiStatus = 'active' | 'won' | 'draw';

export type ReversiMove =
  | { readonly kind: 'place'; readonly actor: GameRole; readonly index: number }
  | { readonly kind: 'pass'; readonly actor: GameRole };

export interface ReversiState {
  readonly board: readonly ReversiCell[];
  readonly turn: GameRole | null;
  readonly status: ReversiStatus;
  readonly winner?: GameRole;
  readonly consecutivePasses: 0 | 1 | 2;
}

export interface ReversiCounts {
  readonly initiator: number;
  readonly responder: number;
  readonly empty: number;
}

export interface ReversiOutcome {
  readonly status: ReversiStatus;
  readonly winner?: GameRole;
  readonly counts: ReversiCounts;
}

const DIRECTIONS: readonly (readonly [number, number])[] = Object.freeze([
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
]);

function freezeState(state: ReversiState): ReversiState {
  return Object.freeze({ ...state, board: Object.freeze([...state.board]) });
}

function otherRole(role: GameRole): GameRole {
  return role === 'initiator' ? 'responder' : 'initiator';
}

function coordinates(index: number): readonly [number, number] {
  return [Math.floor(index / REVERSI_BOARD_SIZE), index % REVERSI_BOARD_SIZE];
}

function indexAt(row: number, column: number): number | undefined {
  if (row < 0 || row >= REVERSI_BOARD_SIZE || column < 0 || column >= REVERSI_BOARD_SIZE)
    return undefined;
  return row * REVERSI_BOARD_SIZE + column;
}

function capturesForDirection(
  board: readonly ReversiCell[],
  index: number,
  actor: GameRole,
  rowDirection: number,
  columnDirection: number,
): readonly number[] {
  const opponent = otherRole(actor);
  const [row, column] = coordinates(index);
  const captured: number[] = [];
  let nextRow = row + rowDirection;
  let nextColumn = column + columnDirection;
  let nextIndex = indexAt(nextRow, nextColumn);
  while (nextIndex !== undefined && board[nextIndex] === opponent) {
    captured.push(nextIndex);
    nextRow += rowDirection;
    nextColumn += columnDirection;
    nextIndex = indexAt(nextRow, nextColumn);
  }
  return nextIndex !== undefined && captured.length > 0 && board[nextIndex] === actor
    ? captured
    : [];
}

export function reversiCaptures(
  board: readonly ReversiCell[],
  index: number,
  actor: GameRole,
): readonly number[] {
  if (!Number.isInteger(index) || index < 0 || index >= REVERSI_BOARD_CELLS) return [];
  if (board[index] !== 'empty') return [];
  return DIRECTIONS.flatMap(([rowDirection, columnDirection]) =>
    capturesForDirection(board, index, actor, rowDirection, columnDirection),
  );
}

export function reversiLegalMoves(state: ReversiState, actor: GameRole): readonly number[] {
  if (state.status !== 'active') return [];
  const legal: number[] = [];
  for (let index = 0; index < REVERSI_BOARD_CELLS; index++)
    if (reversiCaptures(state.board, index, actor).length > 0) legal.push(index);
  return Object.freeze(legal);
}

export function reversiCounts(board: readonly ReversiCell[]): ReversiCounts {
  return Object.freeze({
    initiator: board.filter((cell) => cell === 'initiator').length,
    responder: board.filter((cell) => cell === 'responder').length,
    empty: board.filter((cell) => cell === 'empty').length,
  });
}

function winnerFromCounts(counts: ReversiCounts): GameRole | undefined {
  if (counts.initiator === counts.responder) return undefined;
  return counts.initiator > counts.responder ? 'initiator' : 'responder';
}

export function createReversiState(): ReversiState {
  const board: ReversiCell[] = Array.from({ length: REVERSI_BOARD_CELLS }, () => 'empty');
  board[27] = 'responder';
  board[28] = 'initiator';
  board[35] = 'initiator';
  board[36] = 'responder';
  return freezeState({
    board,
    turn: 'initiator',
    status: 'active',
    consecutivePasses: 0,
  });
}

export function validateReversiMove(state: ReversiState, move: ReversiMove): RuleResult<void> {
  if (state.status !== 'active')
    return {
      ok: false,
      error: { code: 'GAME_FINISHED', message: 'The game has already finished' },
    };
  if (move.actor !== state.turn)
    return {
      ok: false,
      error: {
        code: 'NOT_YOUR_TURN',
        message: 'The move actor does not own the current turn',
        expected: state.turn ?? 'initiator',
      },
    };
  const legalMoves = reversiLegalMoves(state, move.actor);
  if (move.kind === 'pass') {
    if (legalMoves.length > 0)
      return {
        ok: false,
        error: {
          code: 'PASS_NOT_ALLOWED',
          message: 'A player with a legal move cannot pass',
          actor: move.actor,
        },
      };
    return { ok: true, value: undefined };
  }
  if (!Number.isInteger(move.index) || move.index < 0 || move.index >= REVERSI_BOARD_CELLS)
    return {
      ok: false,
      error: {
        code: 'OUT_OF_RANGE',
        message: 'Reversi index must be between 0 and 63',
        index: move.index,
      },
    };
  if (state.board[move.index] !== 'empty')
    return {
      ok: false,
      error: {
        code: 'CELL_OCCUPIED',
        message: 'The selected Reversi cell is occupied',
        index: move.index,
      },
    };
  if (reversiCaptures(state.board, move.index, move.actor).length === 0)
    return {
      ok: false,
      error: {
        code: 'NO_CAPTURE',
        message: 'A Reversi move must capture at least one disc',
        index: move.index,
      },
    };
  return { ok: true, value: undefined };
}

export function applyReversiMove(state: ReversiState, move: ReversiMove): RuleResult<ReversiState> {
  const validation = validateReversiMove(state, move);
  if (!validation.ok) return validation;
  if (move.kind === 'pass') {
    const passes = (state.consecutivePasses + 1) as 1 | 2;
    if (passes === 2) {
      const counts = reversiCounts(state.board);
      const winner = winnerFromCounts(counts);
      return {
        ok: true,
        value: freezeState({
          ...state,
          turn: null,
          status: winner ? 'won' : 'draw',
          ...(winner ? { winner } : {}),
          consecutivePasses: 2,
        }),
      };
    }
    return freezeResult({ ...state, turn: otherRole(move.actor), consecutivePasses: passes });
  }
  const board = [...state.board];
  board[move.index] = move.actor;
  for (const captured of reversiCaptures(state.board, move.index, move.actor))
    board[captured] = move.actor;
  return freezeResult({
    board,
    turn: otherRole(move.actor),
    status: 'active',
    consecutivePasses: 0,
  });
}

function freezeResult(state: ReversiState): RuleResult<ReversiState> {
  return { ok: true, value: freezeState(state) };
}

function stateFields(state: ReversiState): readonly string[] {
  return [
    REVERSI_GAME_ID,
    REVERSI_GAME_VERSION,
    state.board.join(','),
    state.turn ?? 'none',
    state.status,
    state.winner ?? 'none',
    String(state.consecutivePasses),
  ];
}

export function serializeReversiState(state: ReversiState): string {
  return serializeCanonicalFields(stateFields(state));
}

export function hashReversiState(state: ReversiState): string {
  return hashCanonicalFields(stateFields(state));
}

export const reversiRules: GameRules<ReversiState, ReversiMove, ReversiOutcome> = Object.freeze({
  gameId: REVERSI_GAME_ID,
  gameVersion: REVERSI_GAME_VERSION,
  initialState: createReversiState,
  validateMove: validateReversiMove,
  applyMove: applyReversiMove,
  outcome: (state: ReversiState) =>
    Object.freeze({
      status: state.status,
      ...(state.winner ? { winner: state.winner } : {}),
      counts: reversiCounts(state.board),
    }),
  serializeState: serializeReversiState,
  hashState: hashReversiState,
});
