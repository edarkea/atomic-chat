import { computed, type Signal } from '@angular/core';
import type { Contact, ConversationSummary, RoomState } from '../../core/domain';
import { contactForConversationSummary } from '../../core/contacts/contact-index';
import type { WorkspaceConversationItem } from './conversation-list.component';

type ConversationKind = 'direct' | 'muc';

export interface WorkspaceConversationViewInputs {
  readonly conversationSummaries: Signal<ReadonlyArray<ConversationSummary>> | undefined;
  readonly joinedRooms: Signal<ReadonlyArray<RoomState>>;
  readonly search: Signal<string>;
  readonly roomActivity: Signal<ReadonlyMap<string, number>> | undefined;
  readonly contactsByBareJid: Signal<ReadonlyMap<string, Contact>>;
  readonly isHidden: (accountId: string, kind: ConversationKind, jid: string) => boolean;
}

/** Composes the filtered, ordered conversation rows without owning workspace state. */
export class WorkspaceConversationViewCoordinator {
  readonly items = computed<ReadonlyArray<WorkspaceConversationItem> | undefined>(() => {
    const summariesSignal = this.inputs.conversationSummaries;
    if (!summariesSignal) return undefined;

    const term = this.inputs.search().trim().toLowerCase();
    const activity = this.inputs.roomActivity?.() ?? new Map<string, number>();
    const contactsByJid = this.inputs.contactsByBareJid();
    const directItems: WorkspaceConversationItem[] = summariesSignal()
      .filter(
        (summary) =>
          !this.inputs.isHidden(summary.accountId, 'direct', summary.jid) &&
          (!term || summary.jid.includes(term) || summary.title.toLowerCase().includes(term)),
      )
      .map((summary) => ({
        kind: 'direct' as const,
        contact: contactForConversationSummary(summary, contactsByJid),
        lastActivity: summary.lastMessageAt || 0,
      }));

    const roomItems: WorkspaceConversationItem[] = this.inputs
      .joinedRooms()
      .filter(
        (state) =>
          !this.inputs.isHidden(state.accountId, 'muc', state.room.jid) &&
          (!term ||
            state.room.jid.toLowerCase().includes(term) ||
            state.room.room.toLowerCase().includes(term) ||
            state.room.service.toLowerCase().includes(term)),
      )
      .map((roomState) => ({
        kind: 'muc' as const,
        roomState,
        lastActivity: activity.get(roomState.room.jid.toLowerCase()) || 0,
      }));

    return [...directItems, ...roomItems].sort(
      (left, right) =>
        right.lastActivity - left.lastActivity ||
        `${left.kind}:${left.kind === 'muc' ? left.roomState.room.jid : left.contact.jid}`.localeCompare(
          `${right.kind}:${right.kind === 'muc' ? right.roomState.room.jid : right.contact.jid}`,
        ),
    );
  });

  constructor(private readonly inputs: WorkspaceConversationViewInputs) {}
}
