import { ChangeDetectionStrategy, Component, computed, effect, HostListener, input, output, signal } from '@angular/core';
import { MucNotice, ReactionActor, ReactionState, RoomMessage, RoomParticipant, RoomState } from './core/domain';
import { MessageComposerComponent } from './message-composer.component';
import { isProtectedMessageOverlayPointer, MessageItemComponent, MessageOverlay } from './message-item.component';
import { formatMessageDay, formatMessageTime } from './message-date-time';
import { matchesRoomMessageReference } from './core/message-reference';
import { groupMessagesForDisplay, MessageGroupingMetadata } from './message-grouping';

@Component({
  selector: 'app-muc-view',
  imports: [MessageComposerComponent, MessageItemComponent],
  templateUrl: './muc-view.component.html',
  styleUrls: ['./muc-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MucViewComponent {
  readonly roomState = input.required<RoomState>();
  readonly notices = input.required<ReadonlyArray<MucNotice>>();
  readonly participants = input.required<ReadonlyArray<RoomParticipant>>();
  readonly allParticipantCount = input.required<number>();
  readonly participantPage = input.required<number>();
  readonly hasMoreParticipants = input.required<boolean>();
  readonly messages = input.required<ReadonlyArray<RoomMessage>>();
  readonly draft = input.required<string>();
  readonly error = input<string | null>(null);
  readonly reactions = input<ReadonlyMap<string, ReactionState>>(new Map());
  readonly replyingTo = input<{ readonly id: string; readonly author: string; readonly quote: string }>();

  readonly leave = output<void>();
  readonly closeRequested = output<void>();
  readonly previousParticipantPage = output<void>();
  readonly nextParticipantPage = output<void>();
  readonly draftChange = output<string>();
  readonly send = output<void>();
  readonly replyRequested = output<RoomMessage>();
  readonly replyCancel = output<void>();
  readonly reactionChanged = output<{ readonly messageId: string; readonly emojis: ReadonlyArray<string> }>();
  protected readonly activeOverlay = signal<{ readonly messageId: string; readonly overlay: MessageOverlay } | undefined>(undefined);
  private renderedRoom = '';

  constructor() {
    effect(() => {
      const room = `${this.roomState().room.jid.toLowerCase()}|${this.roomState().sessionGeneration}`;
      if (room !== this.renderedRoom) {
        this.renderedRoom = room;
        this.activeOverlay.set(undefined);
      }
    });
  }

  protected readonly displayMessages = computed(() =>
    groupMessagesForDisplay(
      this.messages(),
      (message): MessageGroupingMetadata => ({
        senderKey: message.occupantJid.toLowerCase(),
        conversationKey: `${message.roomJid.toLowerCase()}|${message.sessionGeneration}`,
        createdAt: message.receivedAt,
      }),
      (message) => message.id,
      (message) => message.receivedAt,
    ),
  );

  protected isOutgoing(message: RoomMessage): boolean {
    const state = this.roomState();
    return (
      message.accountId === state.accountId &&
      message.roomJid === state.room.jid &&
      message.occupantJid === state.selfOccupantJid
    );
  }
  protected senderLabel(message: RoomMessage): string {
    const nickname = this.occupantNickname(message.occupantJid) || 'Participante desconocido';
    return this.isOutgoing(message) ? `Tú · ${nickname}` : nickname;
  }
  protected occupantNickname(occupantJid: string): string {
    const separator = occupantJid.indexOf('/');
    return separator >= 0 ? occupantJid.slice(separator + 1).trim() : '';
  }
  protected dayLabel(receivedAt: string): string { return formatMessageDay(receivedAt); }
  protected overlayFor(messageId: string): MessageOverlay | undefined {
    return this.activeOverlay()?.messageId === messageId ? this.activeOverlay()?.overlay : undefined;
  }
  protected setOverlay(messageId: string, overlay: MessageOverlay | undefined): void {
    this.activeOverlay.set(overlay ? { messageId, overlay } : undefined);
  }
  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerdown(event: PointerEvent): void {
    const active = this.activeOverlay();
    if (!active) return;
    if (isProtectedMessageOverlayPointer(event, active.messageId)) return;
    this.activeOverlay.set(undefined);
  }
  protected requestReply(message: RoomMessage): void {
    this.replyRequested.emit(message);
  }
  protected reactionFor(messageId: string): ReactionState | undefined {
    return this.reactions().get(`${this.roomState().room.jid.toLowerCase()}|${messageId}`);
  }
  protected ownReactionEmojis(messageId: string): ReadonlyArray<string> {
    return this.reactionFor(messageId)?.reactions
      .filter((reaction) => reaction.actors.some((actor) => actor.occupantJid === this.roomState().selfOccupantJid || actor.id === this.roomState().accountId))
      .map((reaction) => reaction.emoji) || [];
  }
  protected stableActionId(message: RoomMessage): string {
    return message.stanzaIds?.some((item) => item.by.toLowerCase() === this.roomState().room.jid.toLowerCase()) ? message.id : '';
  }
  protected actionTargetId(message: RoomMessage): string {
    return message.stanzaIds?.find((item) => item.by.toLowerCase() === this.roomState().room.jid.toLowerCase())?.id || '';
  }
  protected replyTargetId(reference: RoomMessage['replyTo']): string {
    if (!reference) return '';
    return this.messages().find((message) => matchesRoomMessageReference(message, reference, this.roomState().accountId, this.roomState().room.jid))?.id || '';
  }
  protected replyAuthor(reference: RoomMessage['replyTo']): string {
    if (!reference) return '';
    const targetId = this.replyTargetId(reference);
    const target = this.messages().find((message) => message.id === targetId);
    if (target) return this.senderLabel(target);
    const nickname = reference.authorJid.split('/').slice(1).join('/').trim();
    return nickname || 'Participante no disponible';
  }
  protected replyQuote(reference: RoomMessage['replyTo']): string {
    if (!reference) return '';
    const target = this.messages().find((message) => message.id === this.replyTargetId(reference));
    const value = target?.body.text || reference.quote || '';
    const points = Array.from(value);
    return points.length > 180 ? `${points.slice(0, 179).join('')}…` : value;
  }
  protected replyTime(reference: RoomMessage['replyTo']): string {
    if (!reference) return '';
    const target = this.messages().find((message) => message.id === this.replyTargetId(reference));
    return target ? formatMessageTime(target.receivedAt) : '';
  }
  protected readonly reactionActorLabel = (actor: ReactionActor): string => {
    const state = this.roomState();
    const occupant = actor.occupantJid?.toLowerCase() || actor.id.toLowerCase();
    if (occupant === state.selfOccupantJid?.toLowerCase() || actor.id.toLowerCase() === state.accountId.toLowerCase()) return 'Tú';
    const participant = state.participants.find((item) => item.occupantJid.toLowerCase() === occupant);
    if (participant?.nick) return participant.nick;
    const nickname = actor.occupantJid?.split('/').slice(1).join('/').trim();
    return nickname || 'Participante';
  };
  protected navigateToMessage(messageId: string): void {
    document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
