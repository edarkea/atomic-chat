import { describe, expect, it } from 'vitest';
import {
  createReversiState,
  createTicTacToeState,
  REVERSI_GAME_ID,
  TIC_TAC_TOE_GAME_ID,
} from '../../core/domain';
import type { GameSessionDto, GameSnapshotDto } from '../../core/domain';
import { isReversiState, isTicTacToeState, stateFor } from './games-panel.models';

const session: GameSessionDto = {
  accountId: 'alice@example.invalid',
  conversationId: 'bob@example.invalid',
  peerBareJid: 'bob@example.invalid',
  sessionId: 'session-1',
  gameId: TIC_TAC_TOE_GAME_ID,
  gameVersion: '1.0.0',
  apiVersion: 1,
  localRole: 'initiator',
  state: 'active',
  revision: 1,
  stateHash: 'hash-1',
  sessionGeneration: 1,
  connectionGeneration: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};

describe('games panel models', () => {
  it('accepts only complete Tic-Tac-Toe and Reversi states', () => {
    expect(isTicTacToeState(createTicTacToeState())).toBe(true);
    expect(isReversiState(createReversiState())).toBe(true);
    expect(isTicTacToeState({ board: [] })).toBe(false);
    expect(isReversiState({ board: Array.from({ length: 64 }, () => 'empty') })).toBe(false);
  });

  it('returns a state only for the matching game and valid snapshot', () => {
    const snapshot: GameSnapshotDto = {
      sessionId: session.sessionId,
      state: createTicTacToeState(),
      revision: 1,
      stateHash: 'hash-1',
    };

    expect(stateFor(session, snapshot, TIC_TAC_TOE_GAME_ID, isTicTacToeState)).toEqual(
      snapshot.state,
    );
    expect(stateFor(session, snapshot, REVERSI_GAME_ID, isReversiState)).toBeUndefined();
    expect(
      stateFor(
        session,
        { ...snapshot, state: { invalid: true } },
        TIC_TAC_TOE_GAME_ID,
        isTicTacToeState,
      ),
    ).toBeUndefined();
  });
});
