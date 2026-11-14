import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  createReversiState,
  createTicTacToeState,
  hashReversiState,
  hashTicTacToeState,
  REVERSI_GAME_ID,
  REVERSI_GAME_VERSION,
  TIC_TAC_TOE_GAME_ID,
  TIC_TAC_TOE_GAME_VERSION,
} from '../../core/domain';
import type { GameSessionDto, GameSnapshotDto } from '../../core/domain';
import { GamesPanelComponent } from './games-panel.component';

const catalog = [
  {
    gameId: TIC_TAC_TOE_GAME_ID,
    displayName: 'Tic-Tac-Toe',
    version: TIC_TAC_TOE_GAME_VERSION,
    apiVersion: 1 as const,
    players: { min: 2 as const, max: 2 as const },
    capabilities: ['invites'] as const,
    distribution: 'official' as const,
    source: 'built-in' as const,
    enabled: true,
  },
];

const sessionBase: GameSessionDto = {
  accountId: 'alice@example.invalid',
  conversationId: 'bob@example.invalid',
  peerBareJid: 'bob@example.invalid',
  sessionId: 'panel-session',
  gameId: REVERSI_GAME_ID,
  gameVersion: REVERSI_GAME_VERSION,
  apiVersion: 1,
  localRole: 'initiator',
  state: 'active',
  revision: 0,
  stateHash: 'state-hash',
  sessionGeneration: 1,
  connectionGeneration: 1,
  createdAt: '2026-11-14T00:00:00.000Z',
  updatedAt: '2026-11-14T00:00:00.000Z',
};

function snapshotForReversi(passAllowed: boolean): GameSnapshotDto {
  const state = createReversiState();
  return {
    sessionId: sessionBase.sessionId,
    state,
    revision: 0,
    stateHash: hashReversiState(state),
    legalMoves: [19, 26, 37, 44],
    passAllowed,
  };
}

describe('GamesPanelComponent', () => {
  let fixture: ComponentFixture<GamesPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [GamesPanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(GamesPanelComponent);
  });

  it('renders the compact catalog and emits an invitation when a game is selected', () => {
    let invitation: { gameId: string; gameVersion: string } | undefined;
    fixture.componentInstance.inviteRequested.subscribe((value) => (invitation = value));
    fixture.componentRef.setInput('catalog', catalog);
    fixture.componentRef.setInput('menuOpen', true);
    fixture.componentRef.setInput('menuOnly', true);
    fixture.detectChanges();

    const gameButton = fixture.nativeElement.querySelector(
      '.games-catalog__item',
    ) as HTMLButtonElement;
    expect(fixture.nativeElement.querySelector('.games-menu')).not.toBeNull();
    gameButton.click();

    expect(invitation).toEqual({
      gameId: TIC_TAC_TOE_GAME_ID,
      gameVersion: TIC_TAC_TOE_GAME_VERSION,
    });
  });

  it('keeps an incoming invitation as a bubble until it is accepted', () => {
    fixture.componentRef.setInput('currentSession', {
      ...sessionBase,
      localRole: 'responder',
      state: 'invited',
    });
    fixture.componentRef.setInput('currentSnapshot', snapshotForReversi(false));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.games-message')?.textContent).toContain(
      'Te han invitado a jugar',
    );
    expect(fixture.nativeElement.querySelector('.ttt-board')).toBeNull();
    expect(fixture.nativeElement.querySelector('.reversi-board')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Aceptar');
    expect(fixture.nativeElement.textContent).toContain('Rechazar');
  });

  it('renders confirmed Reversi metadata with accessible grid navigation and mandatory pass', () => {
    fixture.componentRef.setInput('catalog', []);
    fixture.componentRef.setInput('currentSession', sessionBase);
    fixture.componentRef.setInput('currentSnapshot', snapshotForReversi(false));
    fixture.detectChanges();

    const grid = fixture.nativeElement.querySelector('[role="grid"]') as HTMLElement;
    const cells = fixture.nativeElement.querySelectorAll('[role="gridcell"]');
    expect(grid.getAttribute('aria-rowcount')).toBe('8');
    expect(grid.getAttribute('aria-colcount')).toBe('8');
    expect(cells).toHaveLength(64);
    expect(fixture.nativeElement.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(cells[0].getAttribute('aria-label')).toContain('Fila 1, columna 1');
    expect(fixture.nativeElement.querySelector('.games-pass')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Reversi');

    fixture.componentRef.setInput('currentSnapshot', snapshotForReversi(true));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.games-pass')?.textContent).toContain(
      'Pasar turno (obligatorio)',
    );
  });

  it('shows one finished result with a rematch action and without session history', () => {
    const state = {
      ...createTicTacToeState(),
      board: [
        'initiator',
        'initiator',
        'initiator',
        'empty',
        'responder',
        'empty',
        'empty',
        'empty',
        'responder',
      ] as const,
      turn: null,
      status: 'won' as const,
      winner: 'initiator' as const,
      moveCount: 5,
    };
    const session: GameSessionDto = {
      ...sessionBase,
      gameId: TIC_TAC_TOE_GAME_ID,
      gameVersion: TIC_TAC_TOE_GAME_VERSION,
      state: 'finished',
      revision: 5,
    };
    fixture.componentRef.setInput('currentSession', session);
    fixture.componentRef.setInput('currentSnapshot', {
      sessionId: session.sessionId,
      state,
      revision: 5,
      stateHash: hashTicTacToeState(state),
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.games-result')?.textContent).toContain('GANASTE');
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'GANASTE',
    );
    expect(fixture.nativeElement.querySelector('.games-sessions')).toBeNull();
    expect(fixture.nativeElement.querySelector('.games-close')?.textContent).toContain(
      'Finalizar juego',
    );
    expect(fixture.nativeElement.querySelector('.games-rematch')?.textContent).toContain(
      'Solicitar revancha',
    );

    fixture.componentRef.setInput('currentSession', { ...session, state: 'abandoned' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.games-result')?.textContent).toContain(
      'PARTIDA ABANDONADA',
    );
    expect(fixture.nativeElement.querySelector('.games-rematch')).toBeNull();

    fixture.componentRef.setInput('currentSession', { ...session, state: 'closed' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('JUEGO FINALIZADO');
    expect(fixture.nativeElement.querySelector('.games-close')).toBeNull();
    expect(fixture.nativeElement.querySelector('.games-rematch')).toBeNull();
    expect(fixture.nativeElement.querySelector('.ttt-board')).toBeNull();
  });
});
