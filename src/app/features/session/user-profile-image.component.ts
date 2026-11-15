import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import type { UserProfileImageRef } from '../../core/domain';
import { UserProfileImageCache } from './user-profile-image-cache.service';

@Component({
  selector: 'app-user-profile-image',
  standalone: true,
  templateUrl: './user-profile-image.component.html',
  styleUrls: ['./user-profile-image.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserProfileImageComponent {
  readonly accountId = input.required<string>();
  readonly image = input<UserProfileImageRef | undefined>(undefined);
  readonly alt = input('Avatar de perfil');
  readonly size = input<'compact' | 'small' | 'large'>('large');

  protected readonly objectUrl = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly failureMessage = signal<string | null>(null);
  private readonly visible = signal(typeof IntersectionObserver === 'undefined');

  private readonly imageCache = inject(UserProfileImageCache);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly observer: IntersectionObserver | undefined;
  private generation = 0;
  private lastLoadKey: string | null = null;

  constructor() {
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          this.visible.set(true);
          this.observer?.disconnect();
        },
        { rootMargin: '160px' },
      );
      this.observer.observe(this.host.nativeElement);
    }
    effect(() => {
      const image = this.image();
      const accountId = this.accountId();
      if (!this.visible()) {
        this.lastLoadKey = null;
        this.generation += 1;
        this.releaseObjectUrl();
        this.loading.set(false);
        return;
      }
      const loadKey = `${accountId}\u0000${image?.referenceId || ''}`;
      if (loadKey === this.lastLoadKey) return;
      this.lastLoadKey = loadKey;
      const generation = ++this.generation;
      void this.load(image, accountId, generation);
    });
    this.destroyRef.onDestroy(() => {
      this.generation += 1;
      this.observer?.disconnect();
      this.releaseObjectUrl();
    });
  }

  protected retry(): void {
    const image = this.image();
    if (!image || this.loading()) return;
    this.lastLoadKey = null;
    this.lastLoadKey = `${this.accountId()}\u0000${image.referenceId}`;
    const generation = ++this.generation;
    void this.load(image, this.accountId(), generation);
  }

  private async load(
    image: UserProfileImageRef | undefined,
    accountId: string,
    generation: number,
  ): Promise<void> {
    this.failed.set(false);
    this.failureMessage.set(null);
    if (!image) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const source = await this.imageCache.get(image, accountId);
      this.assertCurrent(generation);
      this.objectUrl.set(source);
    } catch (error) {
      if (generation === this.generation) {
        this.failed.set(true);
        this.failureMessage.set(error instanceof Error ? error.message : 'No disponible');
      }
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new Error('STALE_RESPONSE');
  }

  private releaseObjectUrl(): void {
    this.objectUrl.set(null);
  }
}
