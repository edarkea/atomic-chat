import { TestBed } from '@angular/core/testing';
import { ROUTES } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { appConfig } from './app.config';
import { XMPP_PORT } from './core/ports';

describe('application bootstrap configuration', () => {
  it('does not register unused Angular routes while conversations navigate by signals', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    // Router itself has a root-level injectable factory and can be constructed
    // even without provideRouter(); the ROUTES multi-provider is the real contract.
    expect(TestBed.inject(ROUTES, null)).toBeNull();
  });

  it('preserves the XMPP port provider used by the desktop application', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    expect(TestBed.inject(XMPP_PORT)).toBeTruthy();
  });
});
