import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MessageClassification, MessagePersistenceStatus } from './core/domain';
import { createOpaqueId } from './core/ids';
import { EXTERNAL_LINK_PORT, ExternalLinkPort } from './core/ports';
import { formatMessageDate, formatMessageDateTime, formatMessageTime } from './message-date-time';

export type MessageContentSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'link'; readonly value: string; readonly href: string };

const LINK_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;

export function messageContentSegments(value: string): ReadonlyArray<MessageContentSegment> {
  const segments: MessageContentSegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(LINK_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? cursor;
    let candidate = raw;
    while (/[.,!?;:]+$/u.test(candidate)) candidate = candidate.slice(0, -1);
    while (candidate.endsWith(')') &&
      (candidate.match(/\(/gu)?.length ?? 0) < (candidate.match(/\)/gu)?.length ?? 0))
      candidate = candidate.slice(0, -1);
    if (!candidate || start < cursor) continue;
    if (start > cursor) segments.push({ kind: 'text', value: value.slice(cursor, start) });
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('invalid');
      segments.push({ kind: 'link', value: candidate, href: url.href });
      cursor = start + candidate.length;
    } catch {
      segments.push({ kind: 'text', value: raw });
      cursor = start + raw.length;
    }
  }
  if (cursor < value.length) segments.push({ kind: 'text', value: value.slice(cursor) });
  return segments.length ? segments : [{ kind: 'text', value }];
}

@Component({
  selector: 'app-message-item',
  templateUrl: './message-item.component.html',
  styleUrls: ['./message-item.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageItemComponent {
  readonly sender = input.required<string>();
  readonly body = input.required<string>();
  readonly outgoing = input.required<boolean>();
  readonly classification = input<MessageClassification>();
  readonly persistenceStatus = input<MessagePersistenceStatus>();
  readonly createdAt = input<string>();
  readonly receivedLocally = input(false);
  protected readonly contentSegments = computed(() => messageContentSegments(this.body()));
  private readonly externalLinks = inject<ExternalLinkPort>(EXTERNAL_LINK_PORT, { optional: true });
  protected time(value: string | undefined): string { return formatMessageTime(value); }
  protected date(value: string | undefined): string { return formatMessageDate(value); }
  protected fullDate(value: string | undefined): string { return formatMessageDateTime(value); }
  protected accessibleDate(value: string | undefined, receivedLocally: boolean): string {
    return `${receivedLocally ? 'Hora local de recepción' : 'Hora local'}: ${this.fullDate(value)}`;
  }
  protected openLink(event: MouseEvent, href: string): void {
    event.preventDefault();
    if (!this.externalLinks || typeof window === 'undefined') return;
    const confirmed = window.confirm(
      `Este enlace se abrirá en el navegador predeterminado de tu sistema operativo:\n\n${href}\n\n¿Deseas continuar?`,
    );
    if (!confirmed) return;
    void this.externalLinks.open({ version: 1, requestId: createOpaqueId('external-link'), url: href });
  }
}
