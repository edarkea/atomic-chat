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
});
