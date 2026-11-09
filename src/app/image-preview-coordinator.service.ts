import { Injectable } from '@angular/core';

export type PreviewVisibilityPriority = 'visible' | 'prefetch';

interface VisibilityRegistration {
  readonly observer: IntersectionObserver;
  readonly callbacks: Map<
    HTMLElement,
    (active: boolean, priority: PreviewVisibilityPriority) => void
  >;
}

interface PreviewJob {
  readonly key: string;
  readonly run: () => Promise<void>;
  priority: PreviewVisibilityPriority;
  cancelled: boolean;
}

@Injectable({ providedIn: 'root' })
export class ImagePreviewCoordinator {
  private readonly registrations = new Map<HTMLElement, VisibilityRegistration>();
  private readonly jobs = new Map<string, PreviewJob>();
  private readonly activeKeys = new Set<string>();
  private readonly runningJobs = new Set<PreviewJob>();
  private readonly maxConcurrent = 2;
  private pumpScheduled = false;

  observe(
    target: HTMLElement,
    root: HTMLElement,
    callback: (active: boolean, priority: PreviewVisibilityPriority) => void,
  ): () => void {
    let registration = this.registrations.get(root);
    if (!registration) {
      const callbacks = new Map<
        HTMLElement,
        (active: boolean, priority: PreviewVisibilityPriority) => void
      >();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const notify = callbacks.get(entry.target as HTMLElement);
            if (!notify) continue;
            if (!entry.isIntersecting || entry.intersectionRatio <= 0) {
              notify(false, 'prefetch');
              continue;
            }
            notify(true, 'visible');
          }
        },
        { root, rootMargin: '0px' },
      );
      registration = { observer, callbacks };
      this.registrations.set(root, registration);
    }

    registration.callbacks.set(target, callback);
    registration.observer.observe(target);
    return () => {
      const current = this.registrations.get(root);
      if (!current) return;
      current.observer.unobserve(target);
      current.callbacks.delete(target);
      callback(false, 'prefetch');
      if (current.callbacks.size === 0) {
        current.observer.disconnect();
        this.registrations.delete(root);
      }
    };
  }

  enqueue(key: string, priority: PreviewVisibilityPriority, run: () => Promise<void>): () => void {
    if (this.activeKeys.has(key)) return () => undefined;
    const existing = this.jobs.get(key);
    if (existing) {
      existing.priority = priority;
      this.pump();
      return () => this.cancel(key);
    }
    const job: PreviewJob = { key, priority, run, cancelled: false };
    this.jobs.set(key, job);
    this.pump();
    return () => this.cancel(key);
  }

  reprioritize(key: string, priority: PreviewVisibilityPriority): void {
    const job = this.jobs.get(key);
    if (job) {
      job.priority = priority;
      this.pump();
    }
  }

  private cancel(key: string): void {
    const job = this.jobs.get(key);
    if (!job) return;
    job.cancelled = true;
    this.jobs.delete(key);
    this.pump();
  }

  private pump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.startPendingJobs();
    });
  }

  private startPendingJobs(): void {
    while (this.runningJobs.size < this.maxConcurrent) {
      const next = [...this.jobs.values()]
        .filter((job) => !job.cancelled && !this.activeKeys.has(job.key))
        .sort((left, right) => {
          if (left.priority !== right.priority) return left.priority === 'visible' ? -1 : 1;
          return 0;
        })[0];
      if (!next) return;
      this.jobs.delete(next.key);
      this.activeKeys.add(next.key);
      this.runningJobs.add(next);
      void next
        .run()
        .catch(() => undefined)
        .finally(() => {
          this.activeKeys.delete(next.key);
          this.runningJobs.delete(next);
          this.pump();
        });
    }
  }
}
