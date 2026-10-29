import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ElectronXmppPort } from './electron-xmpp.port';
import { InMemoryXmppPort } from './in-memory-xmpp.port';
import { corePortProviders } from './port-providers';
import { XMPP_PORT } from './ports';

describe('core port providers', () => {
  beforeEach(() => {
    window.atomicChat = undefined;
  });

  it('selects the in-memory XMPP port without Electron preload', () => {
    TestBed.configureTestingModule({ providers: corePortProviders });
    expect(TestBed.inject(XMPP_PORT)).toBeInstanceOf(InMemoryXmppPort);
  });

  it('selects the Electron XMPP port when preload is available', () => {
    window.atomicChat = { config: {} } as typeof window.atomicChat;
    TestBed.configureTestingModule({ providers: corePortProviders });
    expect(TestBed.inject(XMPP_PORT)).toBeInstanceOf(ElectronXmppPort);
  });
});
