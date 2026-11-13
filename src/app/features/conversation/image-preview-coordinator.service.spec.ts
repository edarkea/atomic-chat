import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImagePreviewCoordinator } from './image-preview-coordinator.service';

class FakeIntersectionObserver implements IntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number> = [0];
  readonly targets = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '0px';
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.targets.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(target: Element, isIntersecting: boolean, top: number, bottom: number): void {
    const entry = {
      target,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: { top, bottom },
    } as IntersectionObserverEntry;
    this.callback([entry], this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeIntersectionObserver.instances = [];
});

describe('ImagePreviewCoordinator', () => {
  it('limits active work to two and starts visible queued work before prefetch work', async () => {
    const coordinator = new ImagePreviewCoordinator();
    const started: string[] = [];
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    let finishVisible: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    const visible = new Promise<void>((resolve) => {
      finishVisible = resolve;
    });

    coordinator.enqueue('first', 'prefetch', async () => {
      started.push('first');
      await first;
    });
    coordinator.enqueue('second', 'prefetch', async () => {
      started.push('second');
      await second;
    });
    coordinator.enqueue('old-nearby', 'prefetch', async () => {
      started.push('old-nearby');
    });
    coordinator.enqueue('recent-visible', 'visible', async () => {
      started.push('recent-visible');
      await visible;
    });

    await Promise.resolve();
    expect(started).toEqual(['recent-visible', 'first']);
    finishFirst?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['recent-visible', 'first', 'second']);

    finishVisible?.();
    finishSecond?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['recent-visible', 'first', 'second', 'old-nearby']);
  });

  it('observes against the chat container, activates only intersections and disconnects when removed', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const coordinator = new ImagePreviewCoordinator();
    const root = document.createElement('div');
    const target = document.createElement('article');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 500 } as DOMRect);
    const states: Array<[boolean, string]> = [];

    const stop = coordinator.observe(target, root, (active, priority) =>
      states.push([active, priority]),
    );
    const observer = FakeIntersectionObserver.instances[0];
    expect(observer.root).toBe(root);
    expect(observer.rootMargin).toBe('0px');
    observer.emit(target, false, 20, 80);
    observer.emit(target, true, 120, 180);
    expect(states).toEqual([
      [false, 'prefetch'],
      [true, 'visible'],
    ]);

    stop();
    expect(observer.targets.size).toBe(0);
    expect(states.at(-1)).toEqual([false, 'prefetch']);
  });

  it('drops queued work when its visibility registration is cancelled', async () => {
    const coordinator = new ImagePreviewCoordinator();
    let releaseActive: (() => void) | undefined;
    const active = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const started: string[] = [];
    coordinator.enqueue('active', 'visible', async () => {
      started.push('active');
      await active;
    });
    coordinator.enqueue('active-two', 'visible', async () => {
      started.push('active-two');
      await active;
    });
    const cancel = coordinator.enqueue('offscreen', 'prefetch', async () => {
      started.push('offscreen');
    });

    await Promise.resolve();
    cancel();
    releaseActive?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(started).toEqual(['active', 'active-two']);
  });

  it('ignores duplicate active work while allowing an explicit follow-up after it', async () => {
    const coordinator = new ImagePreviewCoordinator();
    let finishActive: (() => void) | undefined;
    const active = new Promise<void>((resolve) => {
      finishActive = resolve;
    });
    const started: string[] = [];
    coordinator.enqueue('same-key', 'visible', async () => {
      started.push('first');
      await active;
    });
    await Promise.resolve();
    coordinator.enqueue('same-key', 'visible', async () => {
      started.push('duplicate');
    });
    coordinator.enqueueAfterActive('same-key', 'visible', async () => {
      started.push('follow-up');
    });

    finishActive?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['first', 'follow-up']);
  });
});
