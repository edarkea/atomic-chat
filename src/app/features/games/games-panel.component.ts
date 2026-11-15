import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  REVERSI_BOARD_CELLS,
  REVERSI_BOARD_SIZE,
  REVERSI_GAME_ID,
  TIC_TAC_TOE_GAME_ID,
  reversiCounts,
} from '../../core/domain';
import type {
  GameId,
  GameRole,
  GameOperation,
  GameSessionDto,
  GameSnapshotDto,
  GameVersion,
  OfficialGameCatalog,
} from '../../core/domain';
import {
  BOARD_VISIBLE_STATES,
  FALLBACK_GAME_NAMES,
  REVERSI_DEFAULT_FOCUS_INDEX,
  SESSION_STATE_LABELS,
  stateFor,
  isReversiState,
  isTicTacToeState,
  type BoardCell,
} from './games-panel.models';

@Component({
  selector: 'app-games-panel',
  templateUrl: './games-panel.component.html',
  styleUrls: ['./games-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GamesPanelComponent {
  readonly catalog = input<OfficialGameCatalog>([]);
  readonly currentSession = input<GameSessionDto>();
  readonly currentSnapshot = input<GameSnapshotDto>();
  readonly pending = input<ReadonlySet<string>>(new Set());
  readonly error = input<string | null>(null);
  readonly menuOpen = input(false);
  readonly menuOnly = input(false);
  readonly matchOnly = input(false);

  readonly inviteRequested = output<{ gameId: GameId; gameVersion: GameVersion }>();
  readonly acceptRequested = output<GameSessionDto>();
  readonly rejectRequested = output<GameSessionDto>();
  readonly cancelRequested = output<GameSessionDto>();
  readonly moveRequested = output<{ session: GameSessionDto; move: unknown }>();
  readonly resignRequested = output<GameSessionDto>();
  readonly resyncRequested = output<GameSessionDto>();
  readonly rematchRequested = output<GameSessionDto>();
  readonly closeRequested = output<GameSessionDto>();

  protected readonly reversiBoardSize = REVERSI_BOARD_SIZE;
  protected readonly reversiFocusIndex = signal(REVERSI_DEFAULT_FOCUS_INDEX);
  protected readonly tttState = computed(() => {
    return stateFor(
      this.currentSession(),
      this.currentSnapshot(),
      TIC_TAC_TOE_GAME_ID,
      isTicTacToeState,
    );
  });
  protected readonly reversiState = computed(() => {
    return stateFor(this.currentSession(), this.currentSnapshot(), REVERSI_GAME_ID, isReversiState);
  });
  protected readonly reversiCounts = computed(() => {
    return reversiCounts(this.reversiState()?.board ?? []);
  });
  protected readonly legalReversiMoves = computed(
    () => new Set(this.currentSnapshot()?.legalMoves ?? []),
  );
  protected readonly localCanMove = computed(() => {
    const session = this.currentSession();
    const state = this.tttState() ?? this.reversiState();
    return Boolean(
      session &&
      session.state === 'active' &&
      state?.status === 'active' &&
      state.turn === session.localRole &&
      !this.pending().has(`${session.sessionId}:move`),
    );
  });
  protected readonly passAllowed = computed(() => this.currentSnapshot()?.passAllowed === true);
  protected readonly resultLabel = computed(() => {
    const session = this.currentSession();
    const state = this.tttState() ?? this.reversiState();
    if (!session || !state || !['finished', 'abandoned'].includes(session.state)) return undefined;
    if (session.state === 'abandoned') return 'PARTIDA ABANDONADA';
    if (state.status === 'draw') return 'EMPATE';
    if (!state.winner) return 'PARTIDA FINALIZADA';
    return state.winner === session.localRole ? 'GANASTE' : 'PERDISTE';
  });
  protected readonly visibleSession = computed(() => {
    const session = this.currentSession();
    return session && session.state !== 'cancelled' && session.state !== 'expired'
      ? session
      : undefined;
  });

  protected readonly currentGameName = computed(() => {
    const session = this.currentSession();
    if (!session) return '';
    return (
      this.catalog().find(
        (entry) => entry.gameId === session.gameId && entry.version === session.gameVersion,
      )?.displayName ||
      FALLBACK_GAME_NAMES[session.gameId] ||
      session.gameId
    );
  });

  protected isPending(session: GameSessionDto, operation: GameOperation): boolean {
    return this.pending().has(`${session.sessionId}:${operation}`);
  }

  protected isBoardVisible(session: GameSessionDto): boolean {
    return BOARD_VISIBLE_STATES.has(session.state);
  }

  protected statusLabel(session: GameSessionDto): string {
    if (session.state === 'invited')
      return session.localRole === 'responder' ? 'INVITACIÓN RECIBIDA' : 'INVITANDO A JUGAR…';
    return SESSION_STATE_LABELS[session.state];
  }

  protected roleLabel(role: GameRole): string {
    return role === 'initiator' ? 'INICIADOR' : 'RESPONDER';
  }

  protected cellLabel(index: number, cell: BoardCell, boardSize: number): string {
    const row = Math.floor(index / boardSize) + 1;
    const column = (index % boardSize) + 1;
    const value = cell === 'empty' ? 'vacía' : this.roleLabel(cell);
    return `Fila ${row}, columna ${column}: ${value}`;
  }

  protected boardRow(index: number, boardSize: number): number {
    return Math.floor(index / boardSize) + 1;
  }

  protected boardColumn(index: number, boardSize: number): number {
    return (index % boardSize) + 1;
  }

  protected reversiTabIndex(index: number): number {
    const legalMoves = this.legalReversiMoves();
    const focusIndex =
      this.localCanMove() && legalMoves.size
        ? legalMoves.has(this.reversiFocusIndex())
          ? this.reversiFocusIndex()
          : [...legalMoves][0]
        : this.reversiFocusIndex();
    return index === focusIndex ? 0 : -1;
  }

  protected handleReversiKeydown(event: KeyboardEvent, index: number): void {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -REVERSI_BOARD_SIZE,
      ArrowDown: REVERSI_BOARD_SIZE,
      Home: -index,
      End: REVERSI_BOARD_CELLS - 1 - index,
    };
    const offset = offsets[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(REVERSI_BOARD_CELLS - 1, index + offset));
    this.reversiFocusIndex.set(next);
    const target = event.currentTarget;
    if (target instanceof HTMLElement)
      target.parentElement?.querySelector<HTMLElement>(`[data-reversi-index="${next}"]`)?.focus();
  }

  protected requestTicTacToeMove(index: number): void {
    const session = this.currentSession();
    if (!session || !this.localCanMove()) return;
    this.moveRequested.emit({ session, move: { actor: session.localRole, index } });
  }

  protected requestReversiMove(index: number): void {
    const session = this.currentSession();
    const state = this.reversiState();
    if (!session || !this.localCanMove() || state?.board[index] !== 'empty') return;
    this.moveRequested.emit({
      session,
      move: { kind: 'place', actor: session.localRole, index },
    });
  }

  protected requestReversiPass(): void {
    const session = this.currentSession();
    if (!session || !this.localCanMove() || !this.passAllowed()) return;
    this.moveRequested.emit({
      session,
      move: { kind: 'pass', actor: session.localRole },
    });
  }
}
