import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Contact } from '../../core/domain';
import { ConversationListComponent } from './conversation-list.component';

describe('ConversationListComponent name tooltips', () => {
  it('exposes the complete contact name and presence in the hover title', async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationListComponent],
    }).compileComponents();
    const contact: Contact = {
      jid: 'neiser@example.invalid',
      name: 'Neiser Joel Cordova Cordova',
      groups: ['CoopErco'],
      source: 'roster',
      presence: {
        jid: 'neiser@example.invalid',
        availability: 'available',
        updatedAt: '2026-11-07T00:00:00.000Z',
      },
    };
    const fixture = TestBed.createComponent(ConversationListComponent);
    fixture.componentRef.setInput('model', {
      accountId: 'operator@example.invalid',
      search: '',
      joinedRooms: [],
      filteredContacts: [contact],
      workspaceContacts: [contact],
      workspaceItems: [{ kind: 'direct', contact, lastActivity: 0 }],
      selectedJid: '',
      selectedRoomJid: '',
    });
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('.conversation-item') as HTMLButtonElement;
    expect(item.title).toBe('Neiser Joel Cordova Cordova\nCoopErco · En línea');
  });
});
