import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FileTransfer } from './core/domain';

@Component({
  selector: 'app-file-transfer-card',
  templateUrl: './file-transfer-card.component.html',
  styleUrls: ['./file-transfer-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTransferCardComponent {
  readonly transfer = input.required<FileTransfer>();
  readonly label = input.required<string>();
  readonly accepted = output<string>();
  readonly rejected = output<string>();
  readonly cancelled = output<string>();
  readonly opened = output<string>();
  readonly revealed = output<string>();
  readonly actionBusy = input(false);

  protected isInProgress(): boolean {
    return ['accepted', 'offering', 'awaiting_acceptance', 'transferring'].includes(
      this.transfer().state,
    );
  }
  protected isTerminal(): boolean {
    return ['completed', 'failed', 'cancelled'].includes(this.transfer().state);
  }

  protected hasLocalActions(): boolean {
    const actions = this.transfer().localActions;
    return this.transfer().state === 'completed' && Boolean(actions?.open || actions?.reveal);
  }

  protected canOpenFile(): boolean {
    return this.transfer().localActions?.open === true;
  }

  protected canRevealFolder(): boolean {
    return this.transfer().localActions?.reveal === true;
  }
}
