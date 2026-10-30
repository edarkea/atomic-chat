import { Injectable } from '@angular/core';
import {
  AttentionClearRequest,
  AttentionRequest,
  BroadcastSendInput,
  BroadcastSendResult,
  CertificateTrustDecisionInput,
  FileActiveInput,
  FileRequest,
  FileSendInput,
  FileDroppedSendInput,
  FileTransfer,
  ImagePreviewRequest,
  ImagePreviewRef,
  ImagePreviewRevokeRequest,
  HistoryPage,
  HistoryPageInput,
  Message,
  Preferences,
  PreviewChunk,
  PreviewCloseRequest,
  PreviewOpenRequest,
  PreviewReadRequest,
  PreviewStreamRef,
  Result,
  TypedDomainEvent,
  XmppConnectionProfile,
} from './domain';
import { subscribeToDomainEvents } from './domain-event.validation';
import { getAtomicChatApi } from './electron-api';
import {
  AccountConfig,
  AccountPort,
  AttentionPort,
  BroadcastPort,
  CertificatePort,
  FileTransferPort,
  HistoryPort,
  PreferencesPort,
  PreviewPort,
} from './ports';

const unavailable = <T>(requestId: string): Result<T> => ({
  ok: false,
  version: 1,
  error: {
    code: 'UNSUPPORTED',
    retryable: false,
    requestId,
    message: 'La API de Electron no está disponible.',
  },
});

@Injectable({ providedIn: 'root' })
export class ElectronAccountPort implements AccountPort {
  isAvailable(): boolean {
    return getAtomicChatApi() !== undefined;
  }
  getConfig(): AccountConfig | undefined {
    return getAtomicChatApi()?.config;
  }

  listProfiles(requestId = 'profiles-list'): Promise<Result<ReadonlyArray<XmppConnectionProfile>>> {
    const api = getAtomicChatApi();
    return api
      ? api.connectionProfiles.list({ version: 1, requestId })
      : Promise.resolve(unavailable(requestId));
  }

  saveProfile(
    profile: XmppConnectionProfile,
    requestId = 'profiles-save',
  ): Promise<Result<XmppConnectionProfile>> {
    const api = getAtomicChatApi();
    return api
      ? api.connectionProfiles.save({ version: 1, requestId, profile })
      : Promise.resolve(unavailable(requestId));
  }

  deleteProfile(accountId: string, requestId = 'profiles-delete'): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api
      ? api.connectionProfiles.delete({ version: 1, requestId, accountId })
      : Promise.resolve(unavailable(requestId));
  }

  forgetSecret(input: { version: 1; requestId: string; accountId: string }): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.account.forgetSecret(input) : Promise.resolve(unavailable(input.requestId));
  }

  setSecret(input: {
    version: 1;
    requestId: string;
    credentialRef: string;
    secret: string;
    accountId?: string;
    remember?: boolean;
  }): Promise<Result<{ stored: true }>> {
    const api = getAtomicChatApi();
    return api ? api.account.setSecret(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronHistoryPort implements HistoryPort {
  list(input: {
    version: 1;
    requestId: string;
    accountId: string;
    conversationId: string;
  }): Promise<Result<Message[]>> {
    const api = getAtomicChatApi();
    return api ? api.history.list(input) : Promise.resolve(unavailable(input.requestId));
  }

  listPage(input: HistoryPageInput): Promise<Result<HistoryPage>> {
    const api = getAtomicChatApi();
    return api ? api.history.listPage(input) : Promise.resolve(unavailable(input.requestId));
  }

  conversations(input: {
    version: 1;
    requestId: string;
    accountId: string;
  }): Promise<Result<Array<{ accountId: string; jid: string; lastActivity: string }>>> {
    const api = getAtomicChatApi();
    return api ? api.history.conversations(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronPreferencesPort implements PreferencesPort {
  get(input: { accountId: string }): Promise<Result<Preferences>> {
    const api = getAtomicChatApi();
    return api ? api.preferences.get(input) : Promise.resolve(unavailable('preferences-get'));
  }

  update(input: {
    accountId: string;
    changes: Partial<Preferences>;
  }): Promise<Result<Partial<Preferences>>> {
    const api = getAtomicChatApi();
    return api ? api.preferences.update(input) : Promise.resolve(unavailable('preferences-update'));
  }

  reset(input: { accountId: string }): Promise<Result<Preferences>> {
    const api = getAtomicChatApi();
    return api ? api.preferences.reset(input) : Promise.resolve(unavailable('preferences-reset'));
  }

  selectDownloadDirectory(): Promise<Result<string | null>> {
    const api = getAtomicChatApi();
    return api
      ? api.preferences.selectDownloadDirectory()
      : Promise.resolve(unavailable('preferences-select-download-directory'));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronCertificatePort implements CertificatePort {
  decide(input: CertificateTrustDecisionInput): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.certificate.decide(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronAttentionPort implements AttentionPort {
  request(input: AttentionRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.attention.request(input) : Promise.resolve(unavailable(input.requestId));
  }

  clear(input: AttentionClearRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.attention.clear(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronBroadcastPort implements BroadcastPort {
  send(input: BroadcastSendInput): Promise<Result<BroadcastSendResult>> {
    const api = getAtomicChatApi();
    return api ? api.broadcast.send(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronFileTransferPort implements FileTransferPort {
  send(input: FileSendInput): Promise<Result<FileTransfer | null>> {
    const api = getAtomicChatApi();
    return api ? api.file.send(input) : Promise.resolve(unavailable(input.requestId));
  }

  sendDropped(input: FileDroppedSendInput): Promise<Result<FileTransfer | null>> {
    const api = getAtomicChatApi();
    return api ? api.file.sendDropped(input) : Promise.resolve(unavailable(input.requestId));
  }

  accept(input: FileRequest): Promise<Result<FileTransfer>> {
    const api = getAtomicChatApi();
    return api ? api.file.accept(input) : Promise.resolve(unavailable(input.requestId));
  }

  reject(input: FileRequest): Promise<Result<FileTransfer>> {
    const api = getAtomicChatApi();
    return api ? api.file.reject(input) : Promise.resolve(unavailable(input.requestId));
  }

  cancel(input: FileRequest): Promise<Result<FileTransfer>> {
    const api = getAtomicChatApi();
    return api ? api.file.cancel(input) : Promise.resolve(unavailable(input.requestId));
  }

  open(input: FileRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.file.open(input) : Promise.resolve(unavailable(input.requestId));
  }

  reveal(input: FileRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.file.reveal(input) : Promise.resolve(unavailable(input.requestId));
  }

  listActive(input: FileActiveInput): Promise<Result<ReadonlyArray<FileTransfer>>> {
    const api = getAtomicChatApi();
    return api ? api.file.listActive(input) : Promise.resolve(unavailable(input.requestId));
  }

  subscribe(listener: (event: TypedDomainEvent) => void): () => void {
    const subscribe = getAtomicChatApi()?.subscribe;
    return subscribe ? subscribeToDomainEvents(subscribe, listener) : () => undefined;
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronPreviewPort implements PreviewPort {
  get(input: ImagePreviewRequest): Promise<Result<ImagePreviewRef>> {
    const api = getAtomicChatApi();
    return api ? api.preview.get(input) : Promise.resolve(unavailable(input.requestId));
  }
  open(input: PreviewOpenRequest): Promise<Result<PreviewStreamRef>> {
    const api = getAtomicChatApi();
    return api ? api.preview.open(input) : Promise.resolve(unavailable(input.requestId));
  }
  read(input: PreviewReadRequest): Promise<Result<PreviewChunk>> {
    const api = getAtomicChatApi();
    return api ? api.preview.read(input) : Promise.resolve(unavailable(input.requestId));
  }
  close(input: PreviewCloseRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.preview.close(input) : Promise.resolve(unavailable(input.requestId));
  }
  revoke(input: ImagePreviewRevokeRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.preview.revoke(input) : Promise.resolve(unavailable(input.requestId));
  }
}
