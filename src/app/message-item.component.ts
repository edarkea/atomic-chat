import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MessageClassification, MessagePersistenceStatus } from './core/domain';
import { formatMessageDate, formatMessageDateTime, formatMessageTime } from './message-date-time';

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
  protected time(value: string | undefined): string { return formatMessageTime(value); }
  protected date(value: string | undefined): string { return formatMessageDate(value); }
  protected fullDate(value: string | undefined): string { return formatMessageDateTime(value); }
  protected accessibleDate(value: string | undefined, receivedLocally: boolean): string {
    return `${receivedLocally ? 'Hora local de recepción' : 'Hora local'}: ${this.fullDate(value)}`;
  }
}
