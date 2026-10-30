import { Injectable } from '@angular/core';
import {
  CertificateTrustDecisionInput,
  FileActiveInput,
  FileRequest,
  FileSendInput,
  FileDroppedSendInput,
  FileTransfer,
  HistoryPage,
  HistoryPageInput,
  Message,
  Preferences,
  Result,
  RoomRef,
  RoomState,
  RoomSendReceipt,
  TypedDomainEvent,
  MucDiscoverInput,
  MucJoinInput,
  MucLeaveInput,
  MucSendInput,
  XmppConnectionProfile,
} from './domain';
import {
  AccountConfig,
  AccountPort,
  CertificatePort,
  FileTransferPort,
  HistoryPort,
  MucPort,
  PreferencesPort,
} from './ports';

const unsupported = <T>(requestId: string): Result<T> => ({
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
export class UnavailableAccountPort implements AccountPort {
  isAvailable(): boolean {
    return false;
  }
  getConfig(): AccountConfig | undefined {
    return undefined;
  }
  listProfiles(_requestId?: string): Promise<Result<ReadonlyArray<XmppConnectionProfile>>> {
    return Promise.resolve(unsupported('profiles-list'));
  }
  saveProfile(
    _profile: XmppConnectionProfile,
    _requestId?: string,
  ): Promise<Result<XmppConnectionProfile>> {
    return Promise.resolve(unsupported('profiles-save'));
  }
  deleteProfile(accountId: string, _requestId?: string): Promise<Result<void>> {
    return Promise.resolve(unsupported(accountId));
  }
  forgetSecret(input: { version: 1; requestId: string; accountId: string }): Promise<Result<void>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  setSecret(input: {
    version: 1;
    requestId: string;
    credentialRef: string;
    secret: string;
    accountId?: string;
    remember?: boolean;
  }): Promise<Result<{ stored: true }>> {
    return Promise.resolve(unsupported(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class UnavailableHistoryPort implements HistoryPort {
  list(input: {
    version: 1;
    requestId: string;
    accountId: string;
    conversationId: string;
  }): Promise<Result<Message[]>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  listPage(input: HistoryPageInput): Promise<Result<HistoryPage>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  conversations(input: {
    version: 1;
    requestId: string;
    accountId: string;
  }): Promise<Result<Array<{ accountId: string; jid: string; lastActivity: string }>>> {
    return Promise.resolve(unsupported(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class UnavailablePreferencesPort implements PreferencesPort {
  get(_input: { accountId: string }): Promise<Result<Preferences>> {
    return Promise.resolve({
      ok: true,
      version: 1,
      requestId: 'preferences-get',
      value: {
        theme: 'atomic',
        notifications: true,
        autoLogin: false,
        hideClosedConversations: false,
        fileTransferTimeoutSeconds: 300,
        downloadDirectory: '',
      },
    });
  }
  update(_input: {
    accountId: string;
    changes: Partial<Preferences>;
  }): Promise<Result<Partial<Preferences>>> {
    return Promise.resolve({ ok: true, version: 1, requestId: 'preferences-update', value: {} });
  }
  reset(_input: { accountId: string }): Promise<Result<Preferences>> {
    return Promise.resolve({
      ok: true,
      version: 1,
      requestId: 'preferences-reset',
      value: {
        theme: 'atomic',
        notifications: true,
        autoLogin: false,
        hideClosedConversations: false,
        fileTransferTimeoutSeconds: 300,
        downloadDirectory: '',
      },
    });
  }

  selectDownloadDirectory(): Promise<Result<string | null>> {
    return Promise.resolve(unsupported('preferences-select-download-directory'));
  }
}

@Injectable({ providedIn: 'root' })
export class UnavailableCertificatePort implements CertificatePort {
  decide(input: CertificateTrustDecisionInput): Promise<Result<void>> {
    return Promise.resolve(unsupported(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class UnavailableFileTransferPort implements FileTransferPort {
  send(input: FileSendInput): Promise<Result<FileTransfer | null>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  sendDropped(input: FileDroppedSendInput): Promise<Result<FileTransfer | null>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  accept(input: FileRequest): Promise<Result<FileTransfer>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  reject(input: FileRequest): Promise<Result<FileTransfer>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  cancel(input: FileRequest): Promise<Result<FileTransfer>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  open(input: FileRequest): Promise<Result<void>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  reveal(input: FileRequest): Promise<Result<void>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  listActive(input: FileActiveInput): Promise<Result<ReadonlyArray<FileTransfer>>> {
    return Promise.resolve({ ok: true, version: 1, requestId: input.requestId, value: [] });
  }
  subscribe(_listener: (event: TypedDomainEvent) => void): () => void {
    return () => undefined;
  }
}

@Injectable({ providedIn: 'root' })
export class UnavailableMucPort implements MucPort {
  discover(input: MucDiscoverInput): Promise<Result<ReadonlyArray<RoomRef>>> {
    return Promise.resolve({ ok: true, version: 1, requestId: input.requestId, value: [] });
  }
  join(input: MucJoinInput): Promise<Result<RoomState>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  leave(input: MucLeaveInput): Promise<Result<RoomState>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  sendRoomMessage(input: MucSendInput): Promise<Result<RoomSendReceipt>> {
    return Promise.resolve(unsupported(input.requestId));
  }
  subscribe(_listener: (event: TypedDomainEvent) => void): () => void {
    return () => undefined;
  }
}
