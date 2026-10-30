import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StickerPickerComponent } from './sticker-picker.component';

@Component({
  selector: 'app-message-composer',
  imports: [FormsModule, StickerPickerComponent],
  templateUrl: './message-composer.component.html',
  styleUrls: ['./message-composer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageComposerComponent {
  readonly inputName = input.required<string>();
  readonly placeholder = input.required<string>();
  readonly draft = input.required<string>();
  readonly disabled = input(false);
  readonly showAttach = input(false);
  readonly showEmoji = input(false);
  readonly stickersAccountId = input('');
  readonly draftChange = output<string>();
  readonly inputFocus = output<void>();
  readonly inputBlur = output<void>();
  readonly messageSubmitted = output<void>();
  readonly stickerSend = output<string>();
  readonly attach = output<void>();
}
