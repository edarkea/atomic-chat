import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { OperatorPresenceComponent } from './operator-presence.component';

describe('OperatorPresenceComponent name tooltip', () => {
  it('exposes the complete logged-in name and state in the hover title', async () => {
    await TestBed.configureTestingModule({
      imports: [OperatorPresenceComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OperatorPresenceComponent);
    fixture.componentRef.setInput('model', {
      displayName: 'Juan Muñoz Operador Principal',
      accountId: 'juan@example.invalid',
      connectionLabel: 'Conectado',
      presenceLabel: 'En línea',
      presenceDot: 'online',
      presenceOpen: false,
      presenceOptions: [],
      presenceOptionId: '',
      presenceStatus: '',
    });
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.operator-card') as HTMLElement;
    expect(card.title).toBe('Juan Muñoz Operador Principal\nConectado · En línea');
    const trigger = card.querySelector('.presence-trigger') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('Cambiar estado: En línea');
    expect(trigger.querySelector('.presence-trigger-label')?.textContent?.trim()).toBe('En línea');
  });

  it('closes the presence menu when a pointer lands outside the operator card', async () => {
    await TestBed.configureTestingModule({
      imports: [OperatorPresenceComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OperatorPresenceComponent);
    fixture.componentRef.setInput('model', {
      accountId: 'juan@example.invalid',
      connectionLabel: 'Conectado',
      presenceLabel: 'En línea',
      presenceDot: 'online',
      presenceOpen: true,
      presenceOptions: [],
      presenceOptionId: 'online',
      presenceStatus: '',
    });
    const closed = vi.fn();
    fixture.componentInstance.presenceClose.subscribe(closed);
    fixture.detectChanges();

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(closed).toHaveBeenCalledOnce();
    outside.remove();
  });

  it('keeps the profile edit trigger attached to the avatar and disables it offline', async () => {
    await TestBed.configureTestingModule({
      imports: [OperatorPresenceComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OperatorPresenceComponent);
    fixture.componentRef.setInput('model', {
      accountId: 'juan@example.invalid',
      connectionLabel: 'Desconectado',
      presenceLabel: 'Fuera de línea',
      presenceDot: 'offline',
      presenceOpen: false,
      presenceOptions: [],
      presenceOptionId: '',
      presenceStatus: '',
    });
    fixture.detectChanges();

    const avatarWrap = fixture.nativeElement.querySelector('.operator-avatar-wrap');
    const editTrigger = avatarWrap.querySelector('.profile-edit-trigger') as HTMLButtonElement;
    expect(avatarWrap.querySelector('.operator-avatar')).toBeTruthy();
    expect(editTrigger.disabled).toBe(true);
    expect(editTrigger.getAttribute('aria-label')).toBe('Editar mi perfil');
  });

  it('renders the safe profile image reference when the own profile has an avatar', async () => {
    await TestBed.configureTestingModule({
      imports: [OperatorPresenceComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OperatorPresenceComponent);
    fixture.componentRef.setInput('model', {
      accountId: 'juan@example.invalid',
      connectionLabel: 'Conectado',
      presenceLabel: 'En línea',
      presenceDot: 'online',
      presenceOpen: false,
      presenceOptions: [],
      presenceOptionId: 'online',
      presenceStatus: '',
      profileImage: {
        referenceId: 'profile-image-1',
        mimeType: 'image/png',
        sizeBytes: 64,
        width: 64,
        height: 64,
        expiresAt: '2026-01-01T01:00:00.000Z',
      },
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-user-profile-image')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.operator-avatar')).toBeNull();
  });
});
