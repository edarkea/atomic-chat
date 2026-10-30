import { Provider } from '@angular/core';
import { hasAtomicChatApi } from './electron-api';
import {
  ElectronAccountPort,
  ElectronAttentionPort,
  ElectronBroadcastPort,
  ElectronCertificatePort,
  ElectronFileTransferPort,
  ElectronFileHistoryPort,
  ElectronHistoryPort,
  ElectronMediaPort,
  ElectronPreferencesPort,
  ElectronPreviewPort,
  ElectronStickerLibraryPort,
  ElectronStickerPackPort,
  ElectronStickerPreviewPort,
  ElectronStickerMessagePort,
} from './electron-application.ports';
import { ElectronXmppPort } from './electron-xmpp.port';
import { InMemoryXmppPort } from './in-memory-xmpp.port';
import {
  ACCOUNT_PORT,
  ATTENTION_PORT,
  BROADCAST_PORT,
  CERTIFICATE_PORT,
  FILE_TRANSFER_PORT,
  FILE_HISTORY_PORT,
  PREVIEW_PORT,
  STICKER_LIBRARY_PORT,
  STICKER_PACK_PORT,
  STICKER_PREVIEW_PORT,
  STICKER_MESSAGE_PORT,
  MEDIA_PORT,
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
  UnavailableFileHistoryPort,
  UnavailableHistoryPort,
  UnavailableMediaPort,
  UnavailableMucPort,
  UnavailablePreferencesPort,
  UnavailablePreviewPort,
  UnavailableStickerLibraryPort,
  UnavailableStickerPackPort,
  UnavailableStickerPreviewPort,
  UnavailableStickerMessagePort,
} from './unavailable.ports';

export const corePortProviders: Provider[] = [
  ElectronXmppPort,
  InMemoryXmppPort,
  ElectronAccountPort,
  ElectronAttentionPort,
  ElectronHistoryPort,
  ElectronMediaPort,
  ElectronPreferencesPort,
  ElectronCertificatePort,
  ElectronFileTransferPort,
  ElectronFileHistoryPort,
  UnavailableAccountPort,
  UnavailableHistoryPort,
  UnavailablePreferencesPort,
  UnavailableCertificatePort,
  UnavailableFileTransferPort,
  UnavailableFileHistoryPort,
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
    provide: MEDIA_PORT,
    useFactory: (electron: ElectronMediaPort, unavailable: UnavailableMediaPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronMediaPort, UnavailableMediaPort],
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
  {
    provide: FILE_HISTORY_PORT,
    useFactory: (
      electron: ElectronFileHistoryPort,
      unavailable: UnavailableFileHistoryPort,
    ) => (hasAtomicChatApi() ? electron : unavailable),
    deps: [ElectronFileHistoryPort, UnavailableFileHistoryPort],
  },
  {
    provide: PREVIEW_PORT,
    useFactory: (electron: ElectronPreviewPort, unavailable: UnavailablePreviewPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronPreviewPort, UnavailablePreviewPort],
  },
  {
    provide: STICKER_LIBRARY_PORT,
    useFactory: (electron: ElectronStickerLibraryPort, unavailable: UnavailableStickerLibraryPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronStickerLibraryPort, UnavailableStickerLibraryPort],
  },
  {
    provide: STICKER_PACK_PORT,
    useFactory: (electron: ElectronStickerPackPort, unavailable: UnavailableStickerPackPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronStickerPackPort, UnavailableStickerPackPort],
  },
  {
    provide: STICKER_PREVIEW_PORT,
    useFactory: (electron: ElectronStickerPreviewPort, unavailable: UnavailableStickerPreviewPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronStickerPreviewPort, UnavailableStickerPreviewPort],
  },
  {
    provide: STICKER_MESSAGE_PORT,
    useFactory: (electron: ElectronStickerMessagePort, unavailable: UnavailableStickerMessagePort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronStickerMessagePort, UnavailableStickerMessagePort],
  },
  { provide: ATTENTION_PORT, useExisting: ElectronAttentionPort },
  {
    provide: BROADCAST_PORT,
    useFactory: (electron: ElectronBroadcastPort, unavailable: UnavailableBroadcastPort) =>
      hasAtomicChatApi() ? electron : unavailable,
    deps: [ElectronBroadcastPort, UnavailableBroadcastPort],
  },
];
