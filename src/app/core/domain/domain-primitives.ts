export type ContractVersion = 1;
export type RequestId = string;
export type ClientMessageId = string;

export type ContactAvailability =
  'available' | 'away' | 'extended-away' | 'dnd' | 'unavailable' | 'unknown';
export type Availability = ContactAvailability;
export type PresenceMode = 'chat' | 'away' | 'dnd' | 'xa';
export type XmppTransport = 'starttls' | 'direct-tls';
export type ConnectionMode = 'automatic' | 'manual';
export type ConnectionStatus =
  'idle' | 'connecting' | 'authenticating' | 'connected' | 'disconnecting' | 'failed';
export type MessageStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'failed';
export type MessagePersistenceStatus = 'persisted' | 'memory-only';
export type MessageClassification = 'direct' | 'broadcast';
export type DecimalByteCount = string;

export type StaticImageMimeType = 'image/png' | 'image/jpeg';
export type ChatMediaDirection = 'incoming' | 'outgoing';
export type ChatMediaAvailability = 'available' | 'missing' | 'invalid';
export type StickerAssetAvailability = 'pending' | 'available' | 'missing' | 'invalid' | 'blocked';
export type StickerMessageTransportStatus = 'queued' | 'uploading' | 'sending' | 'sent' | 'failed';
export type StickerMessageAvailability = 'available' | 'missing' | 'invalid' | 'blocked';
export type ChatFileAvailability = 'unchecked' | 'available' | 'missing' | 'changed' | 'blocked';

export type RoomId = string;
export type OccupantId = string;
export type MucRoomStatus = 'idle' | 'joining' | 'joined' | 'leaving' | 'failed';
export type MucRole = 'none' | 'visitor' | 'participant' | 'moderator';
export type MucAffiliation = 'none' | 'member' | 'admin' | 'owner';
export type ChatState = 'active' | 'composing' | 'paused' | 'inactive' | 'gone';
