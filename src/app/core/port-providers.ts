import { Provider } from '@angular/core';
import { hasAtomicChatApi } from './electron-api';
import {
  ElectronAccountPort,
  ElectronAttentionPort,
  ElectronBroadcastPort,
  ElectronCertificatePort,
  ElectronFileTransferPort,
  ElectronHistoryPort,
  ElectronPreferencesPort,
} from './electron-application.ports';
import { ElectronXmppPort } from './electron-xmpp.port';
import { InMemoryXmppPort } from './in-memory-xmpp.port';
import {
  ACCOUNT_PORT,
  ATTENTION_PORT,
  BROADCAST_PORT,
  CERTIFICATE_PORT,
  FILE_TRANSFER_PORT,
  HISTORY_PORT,
  MUC_PORT,
  PREFERENCES_PORT,
  XMPP_PORT,
} from './ports';
import {
  UnavailableAccountPort,
  UnavailableBroadcastPort,
  UnavailableCertificatePort,
  UnavailableFileTransferPort,
  UnavailableHistoryPort,
  UnavailableMucPort,
  UnavailablePreferencesPort,
} from './unavailable.ports';

export const corePortProviders: Provider[] = [
  ElectronXmppPort,
  InMemoryXmppPort,
  ElectronAccountPort,
  ElectronAttentionPort,
  ElectronHistoryPort,
  ElectronPreferencesPort,
  ElectronCertificatePort,
  ElectronFileTransferPort,
  UnavailableAccountPort,
  UnavailableHistoryPort,
  UnavailablePreferencesPort,
  UnavailableCertificatePort,
  UnavailableFileTransferPort,
  UnavailableMucPort,
  {
    provide: XMPP_PORT,
    useFactory: (inMemory: InMemoryXmppPort, electron: ElectronXmppPort) =>
      hasAtomicChatApi() ? electron : inMemory,
    deps: [InMemoryXmppPort, ElectronXmppPort],
  },
  {
    provide: MUC_PORT,
    useFactory: (electron: ElectronXmppPort, unavailable: UnavailableMucPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronXmppPort, UnavailableMucPort],
  },
  {
    provide: ACCOUNT_PORT,
    useFactory: (electron: ElectronAccountPort, unavailable: UnavailableAccountPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronAccountPort, UnavailableAccountPort],
  },
  {
    provide: HISTORY_PORT,
    useFactory: (electron: ElectronHistoryPort, unavailable: UnavailableHistoryPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronHistoryPort, UnavailableHistoryPort],
  },
  {
    provide: PREFERENCES_PORT,
    useFactory: (electron: ElectronPreferencesPort, unavailable: UnavailablePreferencesPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronPreferencesPort, UnavailablePreferencesPort],
  },
  {
    provide: CERTIFICATE_PORT,
    useFactory: (electron: ElectronCertificatePort, unavailable: UnavailableCertificatePort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronCertificatePort, UnavailableCertificatePort],
  },
  {
    provide: FILE_TRANSFER_PORT,
    useFactory: (electron: ElectronFileTransferPort, unavailable: UnavailableFileTransferPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronFileTransferPort, UnavailableFileTransferPort],
  },
  { provide: ATTENTION_PORT, useExisting: ElectronAttentionPort },
  {
    provide: BROADCAST_PORT,
    useFactory: (electron: ElectronBroadcastPort, unavailable: UnavailableBroadcastPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronBroadcastPort, UnavailableBroadcastPort],
  },
];
