import type {
  ContractVersion,
  DecimalByteCount,
  RequestId,
  StaticImageMimeType,
} from './domain-primitives';

/** Public profile data returned by XEP-0054. Contact data remains read-only in the UI. */
export interface UserProfile {
  readonly accountId: string;
  readonly jid: string;
  readonly source: 'vcard-temp';
  readonly displayName?: string;
  readonly givenName?: string;
  readonly middleName?: string;
  readonly familyName?: string;
  readonly company?: string;
  readonly jobTitle?: string;
  readonly homeAddress?: string;
  readonly homeCity?: string;
  readonly homeState?: string;
  readonly homePostalCode?: string;
  readonly homeCountry?: string;
  readonly phone?: string;
  readonly mobile?: string;
  readonly fax?: string;
  readonly pager?: string;
  readonly birthday?: string;
  readonly description?: string;
  readonly website?: string;
  readonly nickname?: string;
  readonly email?: string;
  /** SHA-1 from XEP-0153; it is metadata only, never image content. */
  readonly avatarHash?: string;
  readonly image?: UserProfileImageRef;
  readonly fetchedAt: string;
}

/** Opaque, short-lived reference to a validated vCard photo held in Main. */
export interface UserProfileImageRef {
  readonly referenceId: string;
  readonly mimeType: StaticImageMimeType;
  readonly sizeBytes: DecimalByteCount;
  readonly width: number;
  readonly height: number;
  readonly expiresAt: string;
}

export interface UserProfileRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly jid: string;
  /** Reads only durable Main-process profile data; it never sends a vCard IQ. */
  readonly mode?: 'remote' | 'stored';
}

export interface UserProfileUpdateInput {
  readonly displayName?: string | null;
  readonly givenName?: string | null;
  readonly middleName?: string | null;
  readonly familyName?: string | null;
  readonly company?: string | null;
  readonly jobTitle?: string | null;
  readonly homeAddress?: string | null;
  readonly homeCity?: string | null;
  readonly homeState?: string | null;
  readonly homePostalCode?: string | null;
  readonly homeCountry?: string | null;
  readonly phone?: string | null;
  readonly mobile?: string | null;
  readonly fax?: string | null;
  readonly pager?: string | null;
  readonly birthday?: string | null;
  readonly description?: string | null;
  readonly website?: string | null;
  readonly nickname?: string | null;
  readonly email?: string | null;
}

export interface UserProfileUpdateRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly profile: UserProfileUpdateInput;
}

export interface UserProfileAvatarRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
}

export type UserProfileAvatarUpdateRequest = UserProfileAvatarRequest;
export type UserProfileAvatarClearRequest = UserProfileAvatarRequest;

export interface UserProfileImageReferenceRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly referenceId: string;
}

export type UserProfileImageOpenRequest = UserProfileImageReferenceRequest;

export interface UserProfileImageReadRequest extends UserProfileImageReferenceRequest {
  readonly streamId: string;
  readonly sequence: number;
}

export interface UserProfileImageCloseRequest extends UserProfileImageReferenceRequest {
  readonly streamId: string;
}

export type UserProfileImageRevokeRequest = UserProfileImageReferenceRequest;

export interface UserProfileImageStreamRef {
  readonly referenceId: string;
  readonly streamId: string;
  readonly expiresAt: string;
  readonly chunkSize: number;
}

export interface UserProfileImageChunk {
  readonly referenceId: string;
  readonly streamId: string;
  readonly sequence: number;
  readonly bytes: ArrayBuffer;
  readonly done: boolean;
}
