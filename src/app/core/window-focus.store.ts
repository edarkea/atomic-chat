import { DestroyRef, Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class WindowFocusStore {
  readonly isFocused = signal(this.initialFocusState());

  constructor(destroyRef: DestroyRef) {
    if (typeof window === 'undefined') return;

    const onFocus = (): void => this.isFocused.set(true);
    const onBlur = (): void => this.isFocused.set(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    destroyRef.onDestroy(() => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    });
  }

  private initialFocusState(): boolean {
    if (typeof document === 'undefined' || typeof document.hasFocus !== 'function') return true;
    return document.hasFocus();
  }
}
