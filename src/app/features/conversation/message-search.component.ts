import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageSearchHit } from '../../core/domain';
import { bareJid } from '../../core/identity';
import { formatMessageDateTime, formatMessageTime } from './message-date-time';

@Component({
  selector: 'app-message-search',
  imports: [FormsModule],
  templateUrl: './message-search.component.html',
  styleUrls: ['./message-search.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageSearchComponent {
  readonly query = input.required<string>();
  readonly scope = input.required<'all' | 'conversation'>();
  readonly conversationId = input('');
  readonly conversationNames = input<ReadonlyMap<string, string>>(new Map());
  readonly results = input.required<ReadonlyArray<MessageSearchHit>>();
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly hasMore = input(false);
  readonly queryChange = output<string>();
  readonly scopeChange = output<'all' | 'conversation'>();
  readonly resultSelected = output<MessageSearchHit>();
  readonly loadMore = output<void>();

  protected time(value: string): string {
    return formatMessageTime(value);
  }
  protected fullDate(value: string): string {
    return formatMessageDateTime(value);
  }
  protected conversationLabel(hit: MessageSearchHit): string {
    const key = bareJid(hit.conversationId);
    const name = this.conversationNames().get(key);
    return name ? `${name} · ${hit.conversationId}` : hit.conversationId;
  }
  protected previewParts(
    hit: MessageSearchHit,
  ): ReadonlyArray<{ readonly text: string; readonly match: boolean }> {
    const query = this.query().trim();
    if (!query) return [{ text: hit.bodyPreview, match: false }];
    const parts: Array<{ text: string; match: boolean }> = [];
    let offset = 0;
    const lowerBody = hit.bodyPreview.toLocaleLowerCase();
    const lowerQuery = query.toLocaleLowerCase();
    while (offset < hit.bodyPreview.length) {
      const matchAt = lowerBody.indexOf(lowerQuery, offset);
      if (matchAt < 0) {
        parts.push({ text: hit.bodyPreview.slice(offset), match: false });
        break;
      }
      if (matchAt > offset)
        parts.push({ text: hit.bodyPreview.slice(offset, matchAt), match: false });
      parts.push({ text: hit.bodyPreview.slice(matchAt, matchAt + query.length), match: true });
      offset = matchAt + query.length;
    }
    return parts;
  }
}
