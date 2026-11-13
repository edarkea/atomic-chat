import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
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
  });
});
