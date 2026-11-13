export const SCROLL_TO_LATEST_SHOW_DISTANCE = 200;
export const SCROLL_TO_LATEST_HIDE_DISTANCE = 80;

export function distanceToBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

export function shouldShowScrollToLatest(current: boolean, distance: number): boolean {
  if (distance > SCROLL_TO_LATEST_SHOW_DISTANCE) return true;
  if (distance < SCROLL_TO_LATEST_HIDE_DISTANCE) return false;
  return current;
}

export function scrollToLatest(element: HTMLElement): void {
  const top = Math.max(0, element.scrollHeight - element.clientHeight);
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (typeof element.scrollTo === 'function') {
    element.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
  } else {
    element.scrollTop = top;
  }
}
