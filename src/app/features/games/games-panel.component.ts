import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type {
  GameSessionDto,
  GameSnapshotDto,
  OfficialGameCatalog,
  TicTacToeState,
  ReversiState,
} from '../../core/domain';

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

  readonly inviteRequested = output<{ gameId: string; gameVersion: string }>();
  readonly acceptRequested = output<GameSessionDto>();
  readonly rejectRequested = output<GameSessionDto>();
  readonly cancelRequested = output<GameSessionDto>();
  readonly moveRequested = output<{ session: GameSessionDto; move: unknown }>();
  readonly resignRequested = output<GameSessionDto>();
  readonly resyncRequested = output<GameSessionDto>();
  readonly rematchRequested = output<GameSessionDto>();
  readonly closeRequested = output<GameSessionDto>();

  protected readonly reversiFocusIndex = signal(19);
  protected readonly tttState = computed(() => {
    const session = this.currentSession();
    const state = this.currentSnapshot()?.state;
    return session?.gameId === 'com.atomicchat.tic-tac-toe' ? (state as TicTacToeState) : undefined;
  });
  protected readonly reversiState = computed(() => {
    const session = this.currentSession();
    const state = this.currentSnapshot()?.state;
    return session?.gameId === 'com.atomicchat.reversi' ? (state as ReversiState) : undefined;
  });
  protected readonly reversiCounts = computed(() => {
    const state = this.reversiState();
    return {
      initiator: state?.board.filter((cell) => cell === 'initiator').length || 0,
      responder: state?.board.filter((cell) => cell === 'responder').length || 0,
    };
  });
  protected readonly localCanMove = computed(() => {
    const session = this.currentSession();
    const state = this.currentSnapshot()?.state as { turn?: string; status?: string } | undefined;
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
    const state = this.currentSnapshot()?.state as
      { status?: string; winner?: 'initiator' | 'responder' } | undefined;
    if (!session || !state || !['finished', 'abandoned'].includes(session.state)) return undefined;
    if (session.state === 'abandoned') return 'PARTIDA ABANDONADA';
    if (state.status === 'draw') return 'EMPATE';
    if (!state.winner) return 'PARTIDA FINALIZADA';
    return state.winner === session.localRole ? 'GANASTE' : 'PERDISTE';
  });

  protected readonly currentGameName = computed(() => {
    const session = this.currentSession();
    if (!session) return '';
    return (
      this.catalog().find(
        (entry) => entry.gameId === session.gameId && entry.version === session.gameVersion,
      )?.displayName || (session.gameId.endsWith('reversi') ? 'Reversi' : 'Tic-Tac-Toe')
    );
  });

  protected isPending(session: GameSessionDto, operation: string): boolean {
    return this.pending().has(`${session.sessionId}:${operation}`);
  }

  protected canAct(session: GameSessionDto): boolean {
    return (
      session.state !== 'paused' &&
      session.state !== 'resync-required' &&
      session.state !== 'closed'
    );
  }

  protected isBoardVisible(session: GameSessionDto): boolean {
    return ['active', 'paused', 'resync-required', 'finished', 'abandoned'].includes(session.state);
  }

  protected statusLabel(session: GameSessionDto): string {
    const labels: Record<string, string> = {
      invited: session.localRole === 'responder' ? 'INVITACIÓN RECIBIDA' : 'INVITANDO A JUGAR…',
      accepted: 'PARTIDA ACEPTADA · INICIANDO',
      active: 'EN CURSO',
      paused: 'PAUSADA · DESCONECTADA',
      'resync-required': 'SINCRONIZACIÓN REQUERIDA',
      rejected: 'INVITACIÓN RECHAZADA',
      cancelled: 'CANCELADA',
      finished: 'FINALIZADA',
      abandoned: 'ABANDONADA',
      expired: 'EXPIRADA',
      closed: 'JUEGO FINALIZADO',
    };
    return labels[session.state] || session.state.toUpperCase();
  }

  protected roleLabel(role: string | undefined): string {
    return role === 'initiator' ? 'INICIADOR' : role === 'responder' ? 'RESPONDER' : 'SIN JUGADOR';
  }

  protected cellLabel(index: number, cell: string, boardSize: number): string {
    const row = Math.floor(index / boardSize) + 1;
    const column = (index % boardSize) + 1;
    return `Fila ${row}, columna ${column}: ${cell === 'empty' ? 'vacía' : this.roleLabel(cell)}`;
  }

  protected boardRow(index: number, boardSize: number): number {
    return Math.floor(index / boardSize) + 1;
  }

  protected boardColumn(index: number, boardSize: number): number {
    return (index % boardSize) + 1;
  }

  protected reversiTabIndex(index: number): number {
    const legalMoves = this.currentSnapshot()?.legalMoves;
    const focusIndex =
      this.localCanMove() && legalMoves?.length
        ? legalMoves.includes(this.reversiFocusIndex())
          ? this.reversiFocusIndex()
          : legalMoves[0]
        : this.reversiFocusIndex();
    return index === focusIndex ? 0 : -1;
  }

  protected handleReversiKeydown(event: KeyboardEvent, index: number): void {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -8,
      ArrowDown: 8,
      Home: -index,
      End: 63 - index,
    };
    const offset = offsets[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(63, index + offset));
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
    if (!session || !this.localCanMove()) return;
    this.moveRequested.emit({
      session,
      move: { kind: 'pass', actor: session.localRole },
    });
  }
}
