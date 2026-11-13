import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { UpdateStatus } from '../../core/domain';

@Component({
  selector: 'app-version-update',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="version">v{{ status().currentVersion }}</span>
    @switch (status().state) {
      @case ('available') {
        <button
          type="button"
          [disabled]="busy()"
          (click)="download.emit()"
          [title]="'Descargar versión ' + status().availableVersion"
        >
          ↑ Actualizar
        </button>
      }
      @case ('downloading') {
        <small role="status">↓ {{ status().progressPercent ?? 0 }}%</small>
      }
      @case ('downloaded') {
        <button
          type="button"
          [disabled]="busy()"
          (click)="install.emit()"
          title="Instalar la actualización y reiniciar Atomic Chat"
        >
          Reiniciar y actualizar
        </button>
      }
      @case ('error') {
        @if (status().availableVersion) {
          <button
            type="button"
            [disabled]="busy()"
            (click)="check.emit()"
            title="No se pudo actualizar. Volver a comprobar"
          >
            Reintentar
          </button>
        }
      }
    }
    @if (error()) {
      <small class="error" role="alert">{{ error() }}</small>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      font-size: 0.7rem;
    }
    .version {
      color: var(--atomic-text-secondary);
      white-space: nowrap;
    }
    button {
      font: inherit;
      color: var(--atomic-green);
      background: transparent;
      border: 1px solid var(--atomic-border);
      border-radius: 4px;
      padding: 0.15rem 0.4rem;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--atomic-focus);
      outline-offset: 2px;
    }
    button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .error {
      max-width: 24rem;
      color: var(--atomic-text);
    }
  `,
})
export class VersionUpdateComponent {
  readonly status = input<UpdateStatus>({ version: 1, state: 'idle', currentVersion: '0.0.0' });
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly download = output<void>();
  readonly install = output<void>();
  readonly check = output<void>();
}
