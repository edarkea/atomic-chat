import { encodeCanonicalFields, hashCanonicalFields, serializeCanonicalFields } from './canonical';
import type { GameRole, GameRules, RuleResult } from './game-contracts';

export type TicTacToeCell = 'empty' | GameRole;
export type TicTacToeStatus = 'active' | 'won' | 'draw';

export interface TicTacToeMove {
  readonly actor: GameRole;
  readonly index: number;
}

export interface TicTacToeState {
  readonly board: readonly TicTacToeCell[];
  readonly turn: GameRole | null;
  readonly status: TicTacToeStatus;
  readonly winner?: GameRole;
  readonly moveCount: number;
}

export interface TicTacToeOutcome {
  readonly status: TicTacToeStatus;
  readonly winner?: GameRole;
}

export const TIC_TAC_TOE_GAME_ID = 'com.atomicchat.tic-tac-toe';
export const TIC_TAC_TOE_GAME_VERSION = '1.0.0';

export const TIC_TAC_TOE_WINNING_LINES: readonly (readonly [number, number, number])[] =
  Object.freeze([
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ]);

function freezeState(state: TicTacToeState): TicTacToeState {
  return Object.freeze({ ...state, board: Object.freeze([...state.board]) });
}

function otherRole(role: GameRole): GameRole {
  return role === 'initiator' ? 'responder' : 'initiator';
}

function winnerOf(board: readonly TicTacToeCell[]): GameRole | undefined {
  for (const [first, second, third] of TIC_TAC_TOE_WINNING_LINES) {
    const cell = board[first];
    if (cell !== 'empty' && cell === board[second] && cell === board[third]) return cell;
  }
  return undefined;
}

export function createTicTacToeState(): TicTacToeState {
  return freezeState({
    board: Array.from({ length: 9 }, () => 'empty' as const),
    turn: 'initiator',
    status: 'active',
    moveCount: 0,
  });
}

export function validateTicTacToeMove(
  state: TicTacToeState,
  move: TicTacToeMove,
): RuleResult<void> {
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
  if (!Number.isInteger(move.index) || move.index < 0 || move.index >= 9)
    return {
      ok: false,
      error: {
        code: 'OUT_OF_RANGE',
        message: 'Tic Tac Toe index must be between 0 and 8',
        index: move.index,
      },
    };
  if (state.board[move.index] !== 'empty')
    return {
      ok: false,
      error: { code: 'CELL_OCCUPIED', message: 'The selected cell is occupied', index: move.index },
    };
  return { ok: true, value: undefined };
}

export function applyTicTacToeMove(
  state: TicTacToeState,
  move: TicTacToeMove,
): RuleResult<TicTacToeState> {
  const validation = validateTicTacToeMove(state, move);
  if (!validation.ok) return validation;
  const board = [...state.board];
  board[move.index] = move.actor;
  const winner = winnerOf(board);
  const moveCount = state.moveCount + 1;
  const status: TicTacToeStatus = winner ? 'won' : moveCount === 9 ? 'draw' : 'active';
  return {
    ok: true,
    value: freezeState({
      board,
      turn: status === 'active' ? otherRole(move.actor) : null,
      status,
      ...(winner ? { winner } : {}),
      moveCount,
    }),
  };
}

export function serializeTicTacToeState(state: TicTacToeState): string {
  return serializeCanonicalFields([
    TIC_TAC_TOE_GAME_ID,
    TIC_TAC_TOE_GAME_VERSION,
    state.board.join(','),
    state.turn ?? 'none',
    state.status,
    state.winner ?? 'none',
    String(state.moveCount),
  ]);
}

export function hashTicTacToeState(state: TicTacToeState): string {
  return hashCanonicalFields([
    TIC_TAC_TOE_GAME_ID,
    TIC_TAC_TOE_GAME_VERSION,
    state.board.join(','),
    state.turn ?? 'none',
    state.status,
    state.winner ?? 'none',
    String(state.moveCount),
  ]);
}

export const ticTacToeRules: GameRules<TicTacToeState, TicTacToeMove, TicTacToeOutcome> =
  Object.freeze({
    gameId: TIC_TAC_TOE_GAME_ID,
    gameVersion: TIC_TAC_TOE_GAME_VERSION,
    initialState: createTicTacToeState,
    validateMove: validateTicTacToeMove,
    applyMove: applyTicTacToeMove,
    outcome: (state: TicTacToeState) =>
      Object.freeze({ status: state.status, ...(state.winner ? { winner: state.winner } : {}) }),
    serializeState: serializeTicTacToeState,
    hashState: hashTicTacToeState,
  });

export function canonicalTicTacToeBytes(state: TicTacToeState): Uint8Array {
  return encodeCanonicalFields([
    TIC_TAC_TOE_GAME_ID,
    TIC_TAC_TOE_GAME_VERSION,
    state.board.join(','),
    state.turn ?? 'none',
    state.status,
    state.winner ?? 'none',
    String(state.moveCount),
  ]);
}
