import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MessagePersistenceStatus } from './core/domain';

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
  readonly persistenceStatus = input<MessagePersistenceStatus>();
}
