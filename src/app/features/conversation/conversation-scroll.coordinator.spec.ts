import { signal } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OlderMessagesRequest } from './conversation-view.models';
import {
  ConversationScrollContext,
  ConversationScrollCoordinator,
} from './conversation-scroll.coordinator';

function createHarness() {
  const accountId = signal('alice@example.invalid');
  const conversation = signal('bob@example.invalid');
  const visibleMessageKey = signal('bob@example.invalid|2|text:two|2026-11-12T00:01:00.000Z');
  const initialTimelineReady = signal(true);
  const container = signal<HTMLElement | undefined>(undefined);
  const loadOlder = vi.fn<(request: OlderMessagesRequest) => void>();
  const loadNewer = vi.fn<(value: string) => void>();
  const context: ConversationScrollContext = {
    container: () => container(),
    conversation: () => conversation(),
    accountId: () => accountId(),
    visibleMessageKey: () => visibleMessageKey(),
    initialTimelineReady: () => initialTimelineReady(),
    historyLoading: () => false,
    hasOlderMessages: () => false,
    hasNewerMessages: () => false,
    loadOlder,
    loadNewer,
  };
  return {
    accountId,
    conversation,
    visibleMessageKey,
    initialTimelineReady,
    container,
    loadOlder,
    loadNewer,
    coordinator: new ConversationScrollCoordinator(context),
  };
}

describe('ConversationScrollCoordinator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only schedules when the visible timeline key or readiness changes', () => {
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const harness = createHarness();

    harness.coordinator.observeTimeline();
    harness.coordinator.observeTimeline();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    harness.visibleMessageKey.set('bob@example.invalid|2|text:two|2026-11-12T00:01:00.000Z');
    harness.coordinator.observeTimeline();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    harness.visibleMessageKey.set('bob@example.invalid|3|text:three|2026-11-12T00:02:00.000Z');
    harness.coordinator.observeTimeline();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

    harness.initialTimelineReady.set(false);
    harness.coordinator.observeTimeline();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    harness.initialTimelineReady.set(true);
    harness.coordinator.observeTimeline();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(3);
  });

  it('restores the position from the first visible anchor and rejects another account', () => {
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const harness = createHarness();
    const element = document.createElement('div');
    const anchor = document.createElement('div');
    anchor.dataset['timelineId'] = 'text:two';
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100, bottom: 400 }),
    });
    Object.defineProperty(anchor, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 220, bottom: 260 }),
    });
    element.append(anchor);
    element.scrollTop = 50;
    harness.container.set(element);

    harness.coordinator.restoreScrollAfterPrepend({
      conversation: 'bob@example.invalid',
      accountId: 'alice@example.invalid',
      previousHeight: 700,
      anchor: { id: 'text:two', offsetTop: 80 },
    });
    expect(element.scrollTop).toBe(90);

    element.scrollTop = 50;
    harness.accountId.set('carol@example.invalid');
    harness.coordinator.restoreScrollAfterPrepend({
      conversation: 'bob@example.invalid',
      accountId: 'alice@example.invalid',
      previousHeight: 700,
      anchor: { id: 'text:two', offsetTop: 80 },
    });
    expect(element.scrollTop).toBe(50);
  });

  it('does not schedule while search navigation is pending', () => {
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const harness = createHarness();

    harness.coordinator.beginSearchNavigation();
    harness.visibleMessageKey.set('bob@example.invalid|3|text:three|2026-11-12T00:02:00.000Z');
    harness.coordinator.observeTimeline();

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('releases abandoned search navigation when the conversation changes', () => {
    const requestAnimationFrame = vi.fn(() => requestAnimationFrame.mock.calls.length);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const harness = createHarness();

    harness.coordinator.beginSearchNavigation();
    harness.conversation.set('carol@example.invalid');
    harness.visibleMessageKey.set('carol@example.invalid|3|text:three|2026-11-12T00:02:00.000Z');
    harness.coordinator.observeTimeline();

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it('releases abandoned search navigation when the account changes', () => {
    const requestAnimationFrame = vi.fn(() => requestAnimationFrame.mock.calls.length);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const harness = createHarness();

    harness.coordinator.beginSearchNavigation();
    harness.accountId.set('carol@example.invalid');
    harness.visibleMessageKey.set('carol@example.invalid|3|text:three|2026-11-12T00:02:00.000Z');
    harness.coordinator.observeTimeline();

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it('keeps intentional navigation to another conversation pending', () => {
    const requestAnimationFrame = vi.fn(() => requestAnimationFrame.mock.calls.length);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const harness = createHarness();

    harness.coordinator.beginSearchNavigation({
      accountId: 'alice@example.invalid',
      conversation: 'target@example.invalid',
    });
    harness.conversation.set('target@example.invalid');
    harness.visibleMessageKey.set('target@example.invalid|3|text:three|2026-11-12T00:02:00.000Z');
    harness.coordinator.observeTimeline();

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('keeps valid search navigation scoped to the current conversation', () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const harness = createHarness();
    const element = document.createElement('div');
    const target = document.createElement('div');
    target.dataset['messageId'] = 'message-1';
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    element.append(target);
    harness.container.set(element);

    harness.coordinator.beginSearchNavigation();
    harness.coordinator.scrollToMessage('message-1');
    callbacks[0](0);
    callbacks[1](0);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('invalidates the previous search navigation when a new one starts', () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const harness = createHarness();
    const element = document.createElement('div');
    const target = document.createElement('div');
    target.dataset['messageId'] = 'new-message';
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    element.append(target);
    harness.container.set(element);

    harness.coordinator.beginSearchNavigation();
    harness.coordinator.scrollToMessage('old-message');
    harness.coordinator.beginSearchNavigation();
    harness.coordinator.scrollToMessage('new-message');
    callbacks[0](0);
    callbacks[1](0);
    callbacks[2](0);

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('forces a fresh scroll when the account changes with the same conversation', async () => {
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return requestAnimationFrame.mock.calls.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const harness = createHarness();
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 300 });
    harness.container.set(element);

    harness.coordinator.observeTimeline();
    element.scrollTop = 0;
    harness.coordinator.onUserScrollIntent();
    await Promise.resolve();
    harness.accountId.set('carol@example.invalid');
    harness.visibleMessageKey.set('carol@example.invalid|2|text:two|2026-11-12T00:01:00.000Z');
    harness.coordinator.observeTimeline();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(element.scrollTop).toBe(500);
  });

  it('invalidates pending message navigation after destruction', () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const harness = createHarness();

    harness.coordinator.scrollToMessage('message-1');
    harness.coordinator.destroy();
    callbacks[0](0);

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });
});
