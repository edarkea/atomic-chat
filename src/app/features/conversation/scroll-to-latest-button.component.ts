import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-scroll-to-latest-button',
  templateUrl: './scroll-to-latest-button.component.html',
  styleUrls: ['./scroll-to-latest-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScrollToLatestButtonComponent {
  readonly visible = input(false);
  readonly requested = output<void>();
}
