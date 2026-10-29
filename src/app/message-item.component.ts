import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-message-item',
  templateUrl: './message-item.component.html',
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageItemComponent {
  readonly sender = input.required<string>();
  readonly body = input.required<string>();
  readonly outgoing = input.required<boolean>();
  readonly metadata = input.required<string>();
}
