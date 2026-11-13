import { computed, inject, Injectable, signal } from '@angular/core';
import { ChatFacade } from '../facades/chat.facade';
import { Contact, RoomState } from '../domain';
import { MucFacade } from '../facades/muc.facade';
import { ConversationVisibilityStore } from '../stores/conversation-visibility.store';
import { contactForConversationSummary, indexContactsByBareJid } from '../contacts/contact-index';
import { bareJid } from '../identity';

export type ConversationSelection =
  | { readonly kind: 'none'; readonly accountId: string }
  | { readonly kind: 'direct'; readonly accountId: string; readonly jid: string }
  | { readonly kind: 'muc'; readonly accountId: string; readonly roomJid: string };

@Injectable({ providedIn: 'root' })
export class WorkspaceCoordinator {
  private readonly chat = inject(ChatFacade);
  private readonly muc = inject(MucFacade);
  private readonly conversationVisibility = inject(ConversationVisibilityStore);

  readonly search = signal('');
  readonly conversationSelection = signal<ConversationSelection>({
    kind: 'none',
    accountId: '',
  });
  readonly selectedContact = signal<Contact | undefined>(undefined);
  readonly messageSearchConversationNames = computed<ReadonlyMap<string, string>>(
    () =>
      new Map(
        this.chat
          .contacts()
          .map((contact) => {
            const name = contact.name?.trim();
            return name ? ([bareJid(contact.jid), name] as const) : null;
          })
          .filter((entry): entry is readonly [string, string] => entry !== null),
      ),
  );

  readonly activeSelection = computed<ConversationSelection>(() => {
    const selection = this.conversationSelection();
    const accountId = this.chat.accountId();
    if (!accountId || !this.chat.isConnected() || selection.accountId !== accountId)
      return { kind: 'none', accountId };
    if (selection.kind === 'muc' && !this.joinedRoom(selection.roomJid))
      return { kind: 'none', accountId };
    return selection;
  });

  readonly selectedJid = computed(() => {
    const selection = this.activeSelection();
    return selection.kind === 'direct' ? selection.jid : '';
  });

  readonly joinedRooms = computed(() => {
    const activity = this.muc.roomActivity?.() ?? new Map<string, number>();
    return this.muc
      .states()
      .filter((state) => state.accountId === this.chat.accountId() && state.status === 'joined')
      .slice()
      .sort(
        (left, right) =>
          (activity.get(right.room.jid.toLowerCase()) || 0) -
            (activity.get(left.room.jid.toLowerCase()) || 0) ||
          left.room.jid.localeCompare(right.room.jid),
      );
  });

  readonly contactsByBareJid = computed(() => indexContactsByBareJid(this.chat.contacts()));

  readonly workspaceContacts = computed<ReadonlyArray<Contact> | undefined>(() => {
    const summariesSignal = this.chat.conversationSummaries;
    if (!summariesSignal) return undefined;
    const term = this.search().trim().toLowerCase();
    const contactsByJid = this.contactsByBareJid();
    return summariesSignal()
      .slice()
      .sort(
        (left, right) =>
          (right.lastMessageAt || 0) - (left.lastMessageAt || 0) ||
          left.jid.localeCompare(right.jid),
      )
      .filter(
        (summary) =>
          !term || summary.jid.includes(term) || summary.title.toLowerCase().includes(term),
      )
      .filter(
        (summary) =>
          !this.conversationVisibility.isHidden(summary.accountId, 'direct', summary.jid),
      )
      .map((summary) => contactForConversationSummary(summary, contactsByJid));
  });

  readonly activeRoomState = computed<RoomState | undefined>(() => {
    const selection = this.activeSelection();
    return selection.kind === 'muc' ? this.joinedRoom(selection.roomJid) : undefined;
  });

  readonly filteredContacts = computed(() => {
    const term = this.search().trim().toLowerCase();
    const accountId = this.chat.accountId();
    return this.chat
      .contacts()
      .filter(
        (contact) =>
          !this.conversationVisibility.isHidden(accountId, 'direct', contact.jid) &&
          (!term ||
            contact.jid.toLowerCase().includes(term) ||
            contact.name?.toLowerCase().includes(term)),
      );
  });

  selectDirect(jid: string, contact?: Contact): void {
    const accountId = this.chat.accountId();
    this.selectedContact.set(contact);
    this.conversationVisibility.reveal(accountId, 'direct', jid);
    this.conversationSelection.set({
      kind: 'direct',
      accountId,
      jid: bareJid(jid),
    });
  }

  selectJoinedRoom(roomJid: string): boolean {
    if (!this.joinedRoom(roomJid)) return false;
    const accountId = this.chat.accountId();
    this.muc.select(roomJid);
    this.selectedContact.set(undefined);
    this.conversationVisibility.reveal(accountId, 'muc', roomJid);
    this.conversationSelection.set({ kind: 'muc', accountId, roomJid });
    return true;
  }

  dismissConversation(hideClosedConversation: boolean): void {
    const selection = this.activeSelection();
    if (selection.kind !== 'none' && hideClosedConversation) {
      const jid = selection.kind === 'direct' ? selection.jid : selection.roomJid;
      this.conversationVisibility.hide(selection.accountId, selection.kind, jid);
    }
    this.resetSelection();
  }

  resetSelection(): void {
    if (this.activeSelection().kind === 'muc') this.muc.clearSelection();
    this.conversationSelection.set({ kind: 'none', accountId: this.chat.accountId() });
    this.selectedContact.set(undefined);
  }

  joinedRoom(roomJid: string): RoomState | undefined {
    return this.muc
      .states()
      .find(
        (state) =>
          state.room.jid === roomJid &&
          state.accountId === this.chat.accountId() &&
          state.status === 'joined',
      );
  }
}
