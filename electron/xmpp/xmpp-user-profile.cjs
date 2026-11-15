const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const xmppClient = require('@xmpp/client');
const { inspectStaticImage, PREVIEW_CHUNK_SIZE } = require('../files/preview-image.cjs');
const {
  profileDisplayName,
  profileText,
  requestVCard,
  updateVCard,
} = require('./xmpp-display-name.cjs');
const { avatarHash } = require('./xmpp-profile-store.cjs');

const VCARD_NAMESPACE = 'vcard-temp';
const PROFILE_TIMEOUT_MS = 5000;
const MAX_PROFILE_TEXT = 160;
const MAX_PROFILE_EMAIL = 320;
const MAX_PROFILE_PHONE = 64;
const MAX_PROFILE_DESCRIPTION = 1000;
const MAX_PROFILE_URL = 2048;
const MAX_PROFILE_IMAGE_BYTES = 512 * 1024;
const MAX_PROFILE_IMAGE_DIMENSION = 1024;
const PROFILE_IMAGE_TTL_MS = 5 * 60 * 1000;
const MAX_PROFILE_IMAGE_REFERENCES = 32;
const MAX_PROFILE_IMAGE_REFERENCES_PER_SENDER = 8;
const MAX_PROFILE_IMAGE_STREAMS_PER_REFERENCE = 4;
const MAX_PROFILE_REQUESTS_PER_ACCOUNT = 4;

const xml =
  /** @type {(name: string, ...children: Array<Record<string, string | undefined> | XmlNode | string | undefined>) => XmlNode} */ (
    xmppClient.xml
  );

/**
 * @typedef {{name?: string, attrs?: {[key: string]: string | undefined}, children?: Array<XmlNode | string>, getName?: () => string, getChild: (name: string, namespace?: string) => XmlNode | undefined, getChildren?: (name?: string, namespace?: string) => XmlNode[], getChildText: (name: string, namespace?: string) => string | undefined, getText?: () => string | undefined}} XmlNode
 * @typedef {{iqCaller: {request: (stanza: XmlNode, timeoutMs?: number) => Promise<XmlNode>}}} ProfileSession
 * @typedef {{sessions: Map<string, ProfileSession>, states: Map<string, {status?: string}>, sessionGenerations: Map<string, number | undefined>, requireConnected: (accountId: string) => ProfileSession}} ProfileAdapter
 * @typedef {{accountId: string, jid: string, source: 'vcard-temp', displayName?: string, givenName?: string, middleName?: string, familyName?: string, company?: string, jobTitle?: string, homeAddress?: string, homeCity?: string, homeState?: string, homePostalCode?: string, homeCountry?: string, phone?: string, mobile?: string, fax?: string, pager?: string, birthday?: string, description?: string, website?: string, nickname?: string, email?: string, avatarHash?: string, image?: UserProfileImageReference, fetchedAt: string}} UserProfileValue
 * @typedef {{get: (accountId: string, jid: string) => Promise<{profile: Record<string, unknown>, avatarHash?: string, data?: Buffer} | undefined>, put: (accountId: string, jid: string, profile: Record<string, unknown>, data?: Buffer) => Promise<void>, invalidateIfChanged: (accountId: string, jid: string, avatarHash?: string) => Promise<boolean>}} ProfileStore
 * @typedef {{referenceId: string, mimeType: 'image/png' | 'image/jpeg', sizeBytes: string, width: number, height: number, expiresAt: string}} UserProfileImageReference
 * @typedef {{referenceId: string, senderId: number, accountId: string, jid: string, data: Buffer, mimeType: 'image/png' | 'image/jpeg', sizeBytes: string, width: number, height: number, expiresAtMs: number, expiryTimer?: ReturnType<typeof setTimeout>, streams: Map<string, {offset: number, sequence: number, done: boolean}>}} ProfileImageRecord
 * @typedef {{createFromBuffer: (data: Buffer) => {isEmpty: () => boolean, getSize: () => {width: number, height: number}}}} ImageDecoder
 */

/** @param {string} code @param {string} message @returns {Error & {code: string}} */
function profileError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** @param {unknown} error @returns {boolean} */
function isProfileUnavailable(error) {
  const candidate = error && typeof error === 'object' ? error : undefined;
  const raw =
    (candidate && 'condition' in candidate && candidate.condition) ||
    (candidate && 'code' in candidate && candidate.code) ||
    (candidate && 'message' in candidate && candidate.message);
  if (typeof raw !== 'string') return false;
  const normalized = raw.toLowerCase();
  return [
    'service-unavailable',
    'item-not-found',
    'feature-not-implemented',
    'not-authorized',
    'service_unavailable',
  ].includes(normalized);
}

/** @param {unknown} value @returns {string} */
function requireBareJid(value) {
  if (typeof value !== 'string') throw profileError('INVALID_JID', 'El JID no es válido.');
  const jid = value.trim();
  const separator = jid.indexOf('@');
  if (
    jid.length > 512 ||
    separator <= 0 ||
    separator !== jid.lastIndexOf('@') ||
    jid.includes('/') ||
    /[\s\u0000-\u001f\u007f-\u009f]/u.test(jid) ||
    jid.slice(separator + 1).length > 253
  )
    throw profileError('INVALID_JID', 'El JID debe ser una dirección bare válida.');
  return jid;
}

/** @param {string} accountId @param {string} jid @returns {boolean} */
function isAccountJid(accountId, jid) {
  return accountId.toLocaleLowerCase() === jid.toLocaleLowerCase();
}

/** @param {string | undefined} value @param {number} maxLength @returns {string | undefined} */
function clean(value, maxLength) {
  return profileText(value, maxLength);
}

/** @param {string} value @returns {boolean} */
function isValidBirthday(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** @param {string} value @returns {boolean} */
function isValidWebsite(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** @param {XmlNode} card @returns {{data: Buffer, declaredMimeType?: string} | undefined} */
function decodePhoto(card) {
  const photo = card.getChild('PHOTO');
  const encoded = photo?.getChildText('BINVAL');
  if (!encoded) return undefined;
  const compact = encoded.replace(/\s+/gu, '');
  if (
    compact.length > Math.ceil((MAX_PROFILE_IMAGE_BYTES * 4) / 3) + 4 ||
    compact.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)
  )
    throw profileError('MEDIA_SIZE_EXCEEDED', 'La imagen del perfil supera el tamaño permitido.');
  const data = Buffer.from(compact, 'base64');
  if (!data.length || data.length > MAX_PROFILE_IMAGE_BYTES)
    throw profileError('MEDIA_SIZE_EXCEEDED', 'La imagen del perfil supera el tamaño permitido.');
  return { data, declaredMimeType: clean(photo?.getChildText('TYPE'), 64) };
}

/** @param {XmlNode | undefined} card @param {string} name @param {number} maxLength @returns {string | undefined} */
function cardText(card, name, maxLength) {
  return clean(card?.getChildText(name), maxLength);
}

/** @param {XmlNode | undefined} card @param {string} name @param {number} maxLength @returns {string | undefined} */
function cardNestedText(card, name, maxLength) {
  return clean(card?.getChild('N')?.getChildText(name), maxLength);
}

/** @param {XmlNode | undefined} card @param {string} section @param {string} name @param {number} maxLength @returns {string | undefined} */
function cardSectionText(card, section, name, maxLength) {
  const sections = card?.getChildren?.(section) || [];
  const candidate =
    sections.find((item) => item.getChild('HOME')) ||
    sections.find((item) => !item.getChild('WORK')) ||
    card?.getChild(section);
  return clean(candidate?.getChildText(name), maxLength);
}

/** @param {XmlNode | undefined} card @param {'phone' | 'mobile' | 'fax' | 'pager'} kind @returns {string | undefined} */
function cardPhone(card, kind) {
  const entries = card?.getChildren?.('TEL') || [];
  const marker = { phone: 'VOICE', mobile: 'CELL', fax: 'FAX', pager: 'PAGER' }[kind];
  const entry =
    entries.find((item) => item.getChild('HOME') && item.getChild(marker)) ||
    entries.find((item) => item.getChild(marker));
  return clean(entry?.getChildText('NUMBER'), MAX_PROFILE_PHONE);
}

/** @param {XmlNode | undefined} card @param {string} name @param {number} maxLength @returns {string | undefined} */
function cardEmail(card, name, maxLength) {
  return clean(card?.getChild(name)?.getChildText('USERID') || card?.getChildText(name), maxLength);
}

/** @param {XmlNode | undefined} card @param {string} key @param {number} maxLength @param {Record<string, string | null | undefined>} input @param {string | undefined} fallback @returns {string | undefined} */
function updateText(card, key, maxLength, input, fallback) {
  if (Object.hasOwn(input, key)) {
    const value = input[key];
    if (value === null || value === undefined) return undefined;
    return clean(value, maxLength);
  }
  return fallback;
}

/** @param {XmlNode | undefined} card @param {Record<string, string | null | undefined>} input @returns {XmlNode} */
function buildEditableCard(card, input) {
  const displayName = updateText(
    card,
    'displayName',
    MAX_PROFILE_TEXT,
    input,
    cardText(card, 'FN', MAX_PROFILE_TEXT),
  );
  const givenName = updateText(
    card,
    'givenName',
    MAX_PROFILE_TEXT,
    input,
    cardNestedText(card, 'GIVEN', MAX_PROFILE_TEXT),
  );
  const familyName = updateText(
    card,
    'familyName',
    MAX_PROFILE_TEXT,
    input,
    cardNestedText(card, 'FAMILY', MAX_PROFILE_TEXT),
  );
  const middleName = updateText(
    card,
    'middleName',
    MAX_PROFILE_TEXT,
    input,
    cardNestedText(card, 'MIDDLE', MAX_PROFILE_TEXT),
  );
  const company = updateText(
    card,
    'company',
    MAX_PROFILE_TEXT,
    input,
    cardSectionText(card, 'ORG', 'ORGNAME', MAX_PROFILE_TEXT),
  );
  const jobTitle = updateText(
    card,
    'jobTitle',
    MAX_PROFILE_TEXT,
    input,
    cardText(card, 'TITLE', MAX_PROFILE_TEXT),
  );
  const homeAddress = updateText(
    card,
    'homeAddress',
    MAX_PROFILE_TEXT,
    input,
    cardSectionText(card, 'ADR', 'STREET', MAX_PROFILE_TEXT),
  );
  const homeCity = updateText(
    card,
    'homeCity',
    MAX_PROFILE_TEXT,
    input,
    cardSectionText(card, 'ADR', 'LOCALITY', MAX_PROFILE_TEXT),
  );
  const homeState = updateText(
    card,
    'homeState',
    MAX_PROFILE_TEXT,
    input,
    cardSectionText(card, 'ADR', 'REGION', MAX_PROFILE_TEXT),
  );
  const homePostalCode = updateText(
    card,
    'homePostalCode',
    MAX_PROFILE_TEXT,
    input,
    cardSectionText(card, 'ADR', 'PCODE', MAX_PROFILE_TEXT),
  );
  const homeCountry = updateText(
    card,
    'homeCountry',
    MAX_PROFILE_TEXT,
    input,
    cardSectionText(card, 'ADR', 'CTRY', MAX_PROFILE_TEXT),
  );
  const phone = updateText(card, 'phone', MAX_PROFILE_PHONE, input, cardPhone(card, 'phone'));
  const mobile = updateText(card, 'mobile', MAX_PROFILE_PHONE, input, cardPhone(card, 'mobile'));
  const fax = updateText(card, 'fax', MAX_PROFILE_PHONE, input, cardPhone(card, 'fax'));
  const pager = updateText(card, 'pager', MAX_PROFILE_PHONE, input, cardPhone(card, 'pager'));
  const birthday = updateText(card, 'birthday', 10, input, cardText(card, 'BDAY', 10));
  const description = updateText(
    card,
    'description',
    MAX_PROFILE_DESCRIPTION,
    input,
    cardText(card, 'DESC', MAX_PROFILE_DESCRIPTION),
  );
  const website = updateText(
    card,
    'website',
    MAX_PROFILE_URL,
    input,
    cardText(card, 'URL', MAX_PROFILE_URL),
  );
  const nickname = updateText(
    card,
    'nickname',
    MAX_PROFILE_TEXT,
    input,
    cardText(card, 'NICKNAME', MAX_PROFILE_TEXT),
  );
  const email = updateText(
    card,
    'email',
    MAX_PROFILE_EMAIL,
    input,
    cardEmail(card, 'EMAIL', MAX_PROFILE_EMAIL),
  );
  const children = [];
  const editableNames = new Set([
    'FN',
    'N',
    'ORG',
    'TITLE',
    'ADR',
    'TEL',
    'BDAY',
    'DESC',
    'URL',
    'NICKNAME',
    'EMAIL',
  ]);
  const preservedChildren = (card?.children || []).filter((child) => {
    if (typeof child === 'string') return true;
    const name = typeof child.getName === 'function' ? child.getName() : child.name;
    if (name === 'ADR') return Boolean(child.getChild('WORK'));
    if (name === 'TEL') return Boolean(child.getChild('WORK'));
    return !editableNames.has(name || '');
  });
  if (displayName) children.push(xml('FN', {}, displayName));
  if (givenName || middleName || familyName)
    children.push(
      xml(
        'N',
        {},
        givenName ? xml('GIVEN', {}, givenName) : undefined,
        middleName ? xml('MIDDLE', {}, middleName) : undefined,
        familyName ? xml('FAMILY', {}, familyName) : undefined,
      ),
    );
  if (company) children.push(xml('ORG', {}, xml('ORGNAME', {}, company)));
  if (jobTitle) children.push(xml('TITLE', {}, jobTitle));
  if (homeAddress || homeCity || homeState || homePostalCode || homeCountry)
    children.push(
      xml(
        'ADR',
        {},
        xml('HOME', {}),
        homeAddress ? xml('STREET', {}, homeAddress) : undefined,
        homeCity ? xml('LOCALITY', {}, homeCity) : undefined,
        homeState ? xml('REGION', {}, homeState) : undefined,
        homePostalCode ? xml('PCODE', {}, homePostalCode) : undefined,
        homeCountry ? xml('CTRY', {}, homeCountry) : undefined,
      ),
    );
  if (phone)
    children.push(xml('TEL', {}, xml('HOME', {}), xml('VOICE', {}), xml('NUMBER', {}, phone)));
  if (mobile)
    children.push(xml('TEL', {}, xml('HOME', {}), xml('CELL', {}), xml('NUMBER', {}, mobile)));
  if (fax) children.push(xml('TEL', {}, xml('HOME', {}), xml('FAX', {}), xml('NUMBER', {}, fax)));
  if (pager)
    children.push(xml('TEL', {}, xml('HOME', {}), xml('PAGER', {}), xml('NUMBER', {}, pager)));
  if (birthday) children.push(xml('BDAY', {}, birthday));
  if (description) children.push(xml('DESC', {}, description));
  if (website) children.push(xml('URL', {}, website));
  if (nickname) children.push(xml('NICKNAME', {}, nickname));
  if (email) children.push(xml('EMAIL', {}, xml('INTERNET', {}), xml('USERID', {}, email)));
  return xml('vCard', { xmlns: VCARD_NAMESPACE }, ...preservedChildren, ...children);
}

/** @param {XmlNode | undefined} card @param {{data: Buffer, mimeType: 'image/png' | 'image/jpeg'} | undefined} photo @returns {XmlNode} */
function buildAvatarCard(card, photo) {
  const preservedChildren = (card?.children || []).filter((child) => {
    if (typeof child === 'string') return true;
    const name = typeof child.getName === 'function' ? child.getName() : child.name;
    return name !== 'PHOTO';
  });
  if (photo)
    preservedChildren.push(
      xml(
        'PHOTO',
        {},
        xml('TYPE', {}, photo.mimeType),
        xml('BINVAL', {}, photo.data.toString('base64')),
      ),
    );
  return xml('vCard', { xmlns: VCARD_NAMESPACE }, ...preservedChildren);
}

/** @param {string} accountId @param {XmlNode} card @param {string} [jid] @returns {UserProfileValue} */
function profileFromCard(accountId, card, jid = accountId) {
  return /** @type {UserProfileValue} */ ({
    accountId,
    jid,
    source: 'vcard-temp',
    displayName: profileDisplayName(card),
    givenName: cardNestedText(card, 'GIVEN', MAX_PROFILE_TEXT),
    middleName: cardNestedText(card, 'MIDDLE', MAX_PROFILE_TEXT),
    familyName: cardNestedText(card, 'FAMILY', MAX_PROFILE_TEXT),
    company: cardSectionText(card, 'ORG', 'ORGNAME', MAX_PROFILE_TEXT),
    jobTitle: cardText(card, 'TITLE', MAX_PROFILE_TEXT),
    homeAddress: cardSectionText(card, 'ADR', 'STREET', MAX_PROFILE_TEXT),
    homeCity: cardSectionText(card, 'ADR', 'LOCALITY', MAX_PROFILE_TEXT),
    homeState: cardSectionText(card, 'ADR', 'REGION', MAX_PROFILE_TEXT),
    homePostalCode: cardSectionText(card, 'ADR', 'PCODE', MAX_PROFILE_TEXT),
    homeCountry: cardSectionText(card, 'ADR', 'CTRY', MAX_PROFILE_TEXT),
    phone: cardPhone(card, 'phone'),
    mobile: cardPhone(card, 'mobile'),
    fax: cardPhone(card, 'fax'),
    pager: cardPhone(card, 'pager'),
    birthday: cardText(card, 'BDAY', 10),
    description: cardText(card, 'DESC', MAX_PROFILE_DESCRIPTION),
    website: cardText(card, 'URL', MAX_PROFILE_URL),
    nickname: cardText(card, 'NICKNAME', MAX_PROFILE_TEXT),
    email: cardEmail(card, 'EMAIL', MAX_PROFILE_EMAIL),
    fetchedAt: new Date().toISOString(),
  });
}

class ProfileImageRegistry {
  /** @param {{nativeImage?: ImageDecoder}} [options] */
  constructor(options = {}) {
    this.nativeImage = options.nativeImage;
    this.references = new Map();
  }

  /** @param {number} senderId @param {string} accountId @param {string} jid @param {Buffer} data @returns {UserProfileImageReference} */
  create(senderId, accountId, jid, data) {
    this.prune();
    const senderCount = [...this.references.values()].filter(
      (item) => item.senderId === senderId,
    ).length;
    if (
      this.references.size >= MAX_PROFILE_IMAGE_REFERENCES ||
      senderCount >= MAX_PROFILE_IMAGE_REFERENCES_PER_SENDER
    )
      throw profileError('RESOURCE_CONSTRAINT', 'Se alcanzó el límite de referencias de perfiles.');
    const image = inspectStaticImage(data, this.nativeImage);
    const referenceId = crypto.randomUUID();
    const expiresAtMs = Date.now() + PROFILE_IMAGE_TTL_MS;
    const record = /** @type {ProfileImageRecord} */ ({
      referenceId,
      senderId,
      accountId,
      jid,
      data,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
      expiresAtMs,
      streams: new Map(),
    });
    this.references.set(referenceId, record);
    record.expiryTimer = setTimeout(() => this.revoke(referenceId), PROFILE_IMAGE_TTL_MS);
    record.expiryTimer.unref?.();
    return this.publicReference(record);
  }

  /** @param {number} senderId @param {{accountId: string, referenceId: string}} input */
  open(senderId, input) {
    const record = this.authorize(senderId, input);
    if (record.streams.size >= MAX_PROFILE_IMAGE_STREAMS_PER_REFERENCE)
      throw profileError('RESOURCE_CONSTRAINT', 'Se alcanzó el límite de lecturas de la imagen.');
    const streamId = crypto.randomUUID();
    record.streams.set(streamId, { offset: 0, sequence: 0, done: false });
    return {
      referenceId: record.referenceId,
      streamId,
      expiresAt: new Date(record.expiresAtMs).toISOString(),
      chunkSize: PREVIEW_CHUNK_SIZE,
    };
  }

  /** @param {number} senderId @param {{accountId: string, referenceId: string, streamId: string, sequence: number}} input */
  read(senderId, input) {
    const record = this.authorize(senderId, input);
    const stream = record.streams.get(input.streamId);
    if (!stream) throw profileError('UNAUTHORIZED', 'El stream del perfil no está autorizado.');
    if (input.sequence !== stream.sequence || stream.done)
      throw profileError('CONFLICT', 'La secuencia del perfil no es válida.');
    const remaining = record.data.length - stream.offset;
    if (remaining <= 0) throw profileError('CONFLICT', 'La imagen del perfil ya terminó.');
    const end = Math.min(stream.offset + PREVIEW_CHUNK_SIZE, record.data.length);
    const bytes = record.data.subarray(stream.offset, end);
    stream.offset = end;
    stream.sequence += 1;
    stream.done = stream.offset >= record.data.length;
    return {
      referenceId: record.referenceId,
      streamId: input.streamId,
      sequence: input.sequence,
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      done: stream.done,
    };
  }

  /** @param {number} senderId @param {{accountId: string, referenceId: string, streamId: string}} input */
  close(senderId, input) {
    const record = this.authorize(senderId, input);
    record.streams.delete(input.streamId);
  }

  /** @param {number} senderId @param {{accountId: string, referenceId: string}} input */
  revokeForSender(senderId, input) {
    const record = this.authorize(senderId, input);
    this.revoke(record.referenceId);
  }

  /** @param {string} accountId */
  clearAccount(accountId) {
    for (const record of [...this.references.values()])
      if (record.accountId === accountId) this.revoke(record.referenceId);
  }

  /** @param {number} senderId */
  clearSender(senderId) {
    for (const record of [...this.references.values()])
      if (record.senderId === senderId) this.revoke(record.referenceId);
  }

  /** @param {string} referenceId */
  revoke(referenceId) {
    const record = this.references.get(referenceId);
    if (!record) return;
    if (record.expiryTimer) clearTimeout(record.expiryTimer);
    record.streams.clear();
    this.references.delete(referenceId);
  }

  /** @param {number} senderId @param {{accountId: string, referenceId: string}} input */
  authorize(senderId, input) {
    this.prune();
    const record = this.references.get(input.referenceId);
    if (!record)
      throw profileError(
        'MEDIA_REFERENCE_REVOKED',
        'La referencia de imagen expiró o fue revocada.',
      );
    if (
      record.senderId !== senderId ||
      record.accountId.toLocaleLowerCase() !== input.accountId.trim().toLocaleLowerCase()
    )
      throw profileError('UNAUTHORIZED', 'La referencia de imagen no está autorizada.');
    return record;
  }

  /** @param {ProfileImageRecord} record @returns {UserProfileImageReference} */
  publicReference(record) {
    return {
      referenceId: record.referenceId,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      width: record.width,
      height: record.height,
      expiresAt: new Date(record.expiresAtMs).toISOString(),
    };
  }

  prune() {
    const now = Date.now();
    for (const record of [...this.references.values()])
      if (record.expiresAtMs <= now) this.revoke(record.referenceId);
  }
}

/** @param {ProfileAdapter} adapter @param {{nativeImage?: ImageDecoder, timeoutMs?: number, stat?: typeof fsp.lstat, readFile?: typeof fsp.readFile, profileStore?: ProfileStore, profileCache?: ProfileStore}} [options] */
function createXmppUserProfileService(adapter, options = {}) {
  const profileStore = options.profileStore || options.profileCache;
  const imageRegistry = new ProfileImageRegistry(options);
  const inFlight = new Map();
  const updateInFlight = new Map();
  const activeByAccount = new Map();
  const timeoutMs = options.timeoutMs || PROFILE_TIMEOUT_MS;
  const stat = options.stat || fsp.lstat;
  const readFile = options.readFile || fsp.readFile;
  const avatarRevisions = new Map();
  const observedAvatarHashes = new Map();

  /** @param {string} accountId @param {string} jid @returns {string} */
  function avatarRevisionKey(accountId, jid) {
    return `${accountId.toLocaleLowerCase()}\0${jid.toLocaleLowerCase()}`;
  }

  /** @param {string} accountId @param {string} jid @returns {number} */
  function avatarRevision(accountId, jid) {
    return avatarRevisions.get(avatarRevisionKey(accountId, jid)) || 0;
  }

  /** @param {string} accountId @param {string} jid @param {number} revision */
  function assertAvatarCurrent(accountId, jid, revision) {
    if (avatarRevision(accountId, jid) !== revision)
      throw profileError('STALE_RESPONSE', `La respuesta del perfil ${jid} quedó obsoleta.`);
  }

  /** @param {UserProfileValue} profile @param {Buffer | undefined} data */
  async function persistProfile(profile, data) {
    if (!profileStore) return;
    await profileStore.put(profile.accountId, profile.jid, profile, data).catch(() => undefined);
  }

  /** @param {string} accountId @param {string} jid @param {*} session @param {number | undefined} generation */
  function assertCurrent(accountId, jid, session, generation) {
    if (
      adapter.sessions.get(accountId) !== session ||
      adapter.states.get(accountId)?.status !== 'connected' ||
      adapter.sessionGenerations.get(accountId) !== generation
    )
      throw profileError('STALE_RESPONSE', `La respuesta del perfil ${jid} quedó obsoleta.`);
  }

  /** @param {number} senderId @param {string} accountId @param {string} jid @param {XmlNode} card @returns {UserProfileValue} */
  function profileWithImage(senderId, accountId, jid, card) {
    const value = profileFromCard(accountId, card, jid);
    const photo = decodePhoto(card);
    if (photo) {
      const image = inspectStaticImage(photo.data, options.nativeImage);
      if (
        (image.width || 0) > MAX_PROFILE_IMAGE_DIMENSION ||
        (image.height || 0) > MAX_PROFILE_IMAGE_DIMENSION
      )
        throw profileError(
          'MEDIA_DIMENSIONS_INVALID',
          'Las dimensiones de la foto del perfil son demasiado grandes.',
        );
      value.avatarHash = avatarHash(photo.data);
      value.image = imageRegistry.create(senderId, accountId, jid, photo.data);
    }
    observedAvatarHashes.set(avatarRevisionKey(accountId, jid), value.avatarHash);
    return value;
  }

  /** @param {number} senderId @param {string} accountId @param {string} jid @param {{profile: Record<string, unknown>, avatarHash?: string, data?: Buffer}} stored */
  function profileFromStore(senderId, accountId, jid, stored) {
    const value = /** @type {UserProfileValue} */ ({
      ...stored.profile,
      accountId,
      jid,
      source: 'vcard-temp',
      fetchedAt: new Date().toISOString(),
      ...(stored.avatarHash ? { avatarHash: stored.avatarHash } : {}),
    });
    if (stored.data) value.image = imageRegistry.create(senderId, accountId, jid, stored.data);
    observedAvatarHashes.set(avatarRevisionKey(accountId, jid), value.avatarHash);
    return value;
  }

  /** @param {number} senderId @param {string} accountId @param {string} jid @param {number} revision */
  async function fetch(senderId, accountId, jid, revision) {
    const session = adapter.requireConnected(accountId);
    const generation = adapter.sessionGenerations.get(accountId);
    if (profileStore) {
      const cached = await profileStore.get(accountId, jid);
      assertCurrent(accountId, jid, session, generation);
      assertAvatarCurrent(accountId, jid, revision);
      if (cached) return profileFromStore(senderId, accountId, jid, cached);
    }
    const response = await requestVCard(
      session,
      isAccountJid(accountId, jid) ? undefined : jid,
      timeoutMs,
    );
    assertCurrent(accountId, jid, session, generation);
    const card = response.getChild('vCard', VCARD_NAMESPACE);
    if (!card)
      throw profileError('PROFILE_UNAVAILABLE', 'El servidor no devolvió un vCard compatible.');
    assertCurrent(accountId, jid, session, generation);
    assertAvatarCurrent(accountId, jid, revision);
    const profile = profileWithImage(senderId, accountId, jid, card);
    await persistProfile(profile, decodePhoto(card)?.data);
    return profile;
  }

  /** @param {number} senderId @param {string} accountId @param {string} jid @param {number} revision */
  async function fetchStored(senderId, accountId, jid, revision) {
    const session = adapter.requireConnected(accountId);
    const generation = adapter.sessionGenerations.get(accountId);
    if (!profileStore)
      throw profileError('PROFILE_UNAVAILABLE', 'El perfil XMPP no está disponible.');
    const stored = await profileStore.get(accountId, jid);
    assertCurrent(accountId, jid, session, generation);
    assertAvatarCurrent(accountId, jid, revision);
    if (!stored) throw profileError('PROFILE_UNAVAILABLE', 'El perfil XMPP no está disponible.');
    return profileFromStore(senderId, accountId, jid, stored);
  }

  /** @param {string} filePath @returns {Promise<{data: Buffer, mimeType: 'image/png' | 'image/jpeg'}>} */
  async function readAvatarFile(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim())
      throw profileError('INVALID_INPUT', 'La ruta del avatar no es válida.');
    let information;
    try {
      information = await stat(filePath);
    } catch {
      throw profileError('MEDIA_DECODE_FAILED', 'No fue posible leer el archivo del avatar.');
    }
    if (
      !information.isFile?.() ||
      information.isSymbolicLink?.() ||
      information.size > MAX_PROFILE_IMAGE_BYTES
    )
      throw profileError('MEDIA_SIZE_EXCEEDED', 'La foto del perfil supera el tamaño permitido.');
    let data;
    try {
      data = await readFile(filePath);
    } catch {
      throw profileError('MEDIA_DECODE_FAILED', 'No fue posible leer el archivo del avatar.');
    }
    if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_PROFILE_IMAGE_BYTES)
      throw profileError('MEDIA_SIZE_EXCEEDED', 'La foto del perfil supera el tamaño permitido.');
    const image = inspectStaticImage(data, options.nativeImage);
    if (
      (image.width || 0) > MAX_PROFILE_IMAGE_DIMENSION ||
      (image.height || 0) > MAX_PROFILE_IMAGE_DIMENSION
    )
      throw profileError(
        'MEDIA_DIMENSIONS_INVALID',
        'Las dimensiones de la foto del perfil son demasiado grandes.',
      );
    return {
      data,
      mimeType: /** @type {'image/png' | 'image/jpeg'} */ (image.mimeType),
    };
  }

  /** @param {unknown} error @param {string} action @returns {never} */
  function profileWriteError(error, action) {
    if (isProfileUnavailable(error))
      throw profileError('PROFILE_UNAVAILABLE', 'El perfil XMPP no está disponible.');
    const candidate =
      error && typeof error === 'object'
        ? /** @type {{code?: unknown, message?: unknown}} */ (error)
        : undefined;
    const raw = candidate?.code || candidate?.message;
    if (
      raw === 'ERR_TIMED_OUT' ||
      raw === 'ETIMEDOUT' ||
      (typeof raw === 'string' && raw.toLowerCase().includes('timeout'))
    )
      throw profileError('TIMEOUT', `La ${action} del perfil agotó el tiempo permitido.`);
    throw error;
  }

  /** @param {number} senderId @param {string} accountId @param {Record<string, string | null | undefined>} input */
  async function update(senderId, accountId, input) {
    if (!Number.isInteger(senderId))
      throw profileError('UNAUTHORIZED', 'La ventana no está autorizada.');
    const account = requireBareJid(accountId);
    if (account !== accountId.trim())
      throw profileError('INVALID_ACCOUNT', 'La cuenta no es válida.');
    if (!input || typeof input !== 'object')
      throw profileError('INVALID_INPUT', 'Los datos de la vCard no son válidos.');
    const allowed = new Set([
      'displayName',
      'givenName',
      'middleName',
      'familyName',
      'company',
      'jobTitle',
      'homeAddress',
      'homeCity',
      'homeState',
      'homePostalCode',
      'homeCountry',
      'phone',
      'mobile',
      'fax',
      'pager',
      'birthday',
      'description',
      'website',
      'nickname',
      'email',
    ]);
    for (const key of Object.keys(input))
      if (!allowed.has(key))
        throw profileError('INVALID_INPUT', 'El campo de la vCard no es válido.');
    for (const [key, value] of Object.entries(input)) {
      if (value !== null && typeof value !== 'string')
        throw profileError('INVALID_INPUT', `El campo ${key} de la vCard no es válido.`);
      if (typeof value === 'string') {
        if (key === 'birthday' && !isValidBirthday(value))
          throw profileError('INVALID_INPUT', 'El cumpleaños debe usar formato AAAA-MM-DD.');
        if (key === 'website' && !isValidWebsite(value))
          throw profileError('INVALID_INPUT', 'La página web debe ser una URL HTTP o HTTPS.');
        const limit =
          key === 'email'
            ? MAX_PROFILE_EMAIL
            : key === 'birthday'
              ? 10
              : key === 'description'
                ? MAX_PROFILE_DESCRIPTION
                : key === 'website'
                  ? MAX_PROFILE_URL
                  : ['phone', 'mobile', 'fax', 'pager'].includes(key)
                    ? MAX_PROFILE_PHONE
                    : MAX_PROFILE_TEXT;
        if (value.length > limit * 4 || /[\u0000-\u001f\u007f-\u009f]/u.test(value))
          throw profileError('INVALID_INPUT', `El campo ${key} de la vCard no es válido.`);
      }
    }
    if (updateInFlight.has(account))
      throw profileError('RESOURCE_CONSTRAINT', 'Ya hay una actualización de perfil en curso.');
    const session = adapter.requireConnected(account);
    const generation = adapter.sessionGenerations.get(account);
    const operation = (async () => {
      const currentResponse = await requestVCard(session, undefined, timeoutMs);
      assertCurrent(account, account, session, generation);
      const currentCard = currentResponse.getChild('vCard', VCARD_NAMESPACE);
      const nextCard = buildEditableCard(currentCard, input);
      await updateVCard(session, nextCard, timeoutMs);
      assertCurrent(account, account, session, generation);
      const profile = profileWithImage(senderId, account, account, nextCard);
      await persistProfile(profile, decodePhoto(nextCard)?.data);
      return profile;
    })()
      .catch((error) => {
        return profileWriteError(error, 'actualización');
      })
      .finally(() => updateInFlight.delete(account));
    updateInFlight.set(account, operation);
    return operation;
  }

  /** @param {number} senderId @param {string} accountId @param {string | null} filePath @returns {Promise<UserProfileValue>} */
  async function updateAvatar(senderId, accountId, filePath) {
    if (!Number.isInteger(senderId))
      throw profileError('UNAUTHORIZED', 'La ventana no está autorizada.');
    const account = requireBareJid(accountId);
    if (account !== accountId.trim())
      throw profileError('INVALID_ACCOUNT', 'La cuenta no es válida.');
    if (updateInFlight.has(account))
      throw profileError('RESOURCE_CONSTRAINT', 'Ya hay una actualización de perfil en curso.');
    const session = adapter.requireConnected(account);
    const generation = adapter.sessionGenerations.get(account);
    const operation = (async () => {
      const photo = filePath === null ? undefined : await readAvatarFile(filePath);
      const currentResponse = await requestVCard(session, undefined, timeoutMs);
      assertCurrent(account, account, session, generation);
      const currentCard = currentResponse.getChild('vCard', VCARD_NAMESPACE);
      const nextCard = buildAvatarCard(currentCard, photo);
      await updateVCard(session, nextCard, timeoutMs);
      assertCurrent(account, account, session, generation);
      const profile = profileWithImage(senderId, account, account, nextCard);
      await persistProfile(profile, decodePhoto(nextCard)?.data);
      return profile;
    })()
      .catch((error) => profileWriteError(error, 'actualización'))
      .finally(() => updateInFlight.delete(account));
    updateInFlight.set(account, operation);
    return operation;
  }

  /** @param {number} senderId @param {string} accountId @param {string} jid @param {'remote' | 'stored'} [mode] */
  async function get(senderId, accountId, jid, mode = 'remote') {
    if (!Number.isInteger(senderId))
      throw profileError('UNAUTHORIZED', 'La ventana no está autorizada.');
    const account = requireBareJid(accountId);
    const target = requireBareJid(jid);
    if (account !== accountId.trim())
      throw profileError('INVALID_ACCOUNT', 'La cuenta no es válida.');
    const revision = avatarRevision(account, target);
    if (mode !== 'remote' && mode !== 'stored')
      throw profileError('INVALID_INPUT', 'El modo de lectura del perfil no es válido.');
    const key = `${senderId}:${mode}:${account.toLocaleLowerCase()}\0${target.toLocaleLowerCase()}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const active = activeByAccount.get(account) || 0;
    if (active >= MAX_PROFILE_REQUESTS_PER_ACCOUNT)
      return Promise.reject(
        profileError('RESOURCE_CONSTRAINT', 'Se alcanzó el límite de consultas de perfiles.'),
      );
    activeByAccount.set(account, active + 1);
    const operation = (
      mode === 'stored'
        ? fetchStored(senderId, account, target, revision)
        : fetch(senderId, account, target, revision)
    )
      .catch((error) => {
        if (isProfileUnavailable(error))
          throw profileError('PROFILE_UNAVAILABLE', 'El perfil XMPP no está disponible.');
        const raw = error?.code || error?.message;
        if (
          raw === 'ERR_TIMED_OUT' ||
          raw === 'ETIMEDOUT' ||
          (typeof raw === 'string' && raw.toLowerCase().includes('timeout'))
        )
          throw profileError('TIMEOUT', 'La consulta del perfil agotó el tiempo permitido.');
        throw error;
      })
      .finally(() => {
        if (inFlight.get(key) === operation) inFlight.delete(key);
        const current = activeByAccount.get(account) || 1;
        if (current <= 1) activeByAccount.delete(account);
        else activeByAccount.set(account, current - 1);
      });
    inFlight.set(key, operation);
    return operation;
  }

  return {
    get,
    update,
    updateAvatar,
    /** @param {number} senderId @param {string} accountId */
    clearAvatar: (senderId, accountId) => updateAvatar(senderId, accountId, null),
    /** @param {number} senderId @param {{accountId: string, referenceId: string}} input */
    openImage: (senderId, input) => imageRegistry.open(senderId, input),
    /** @param {number} senderId @param {{accountId: string, referenceId: string, streamId: string, sequence: number}} input */
    readImage: (senderId, input) => imageRegistry.read(senderId, input),
    /** @param {number} senderId @param {{accountId: string, referenceId: string, streamId: string}} input */
    closeImage: (senderId, input) => imageRegistry.close(senderId, input),
    /** @param {number} senderId @param {{accountId: string, referenceId: string}} input */
    revokeImage: (senderId, input) => imageRegistry.revokeForSender(senderId, input),
    /** @param {string} accountId */
    clearAccount: (accountId) => imageRegistry.clearAccount(accountId),
    /** @param {number} senderId */
    clearSender: (senderId) => imageRegistry.clearSender(senderId),
    /** @param {string} accountId @param {string} jid @param {string | undefined} nextHash */
    async handleAvatarHashChanged(accountId, jid, nextHash) {
      const account = requireBareJid(accountId);
      const target = requireBareJid(jid);
      const key = avatarRevisionKey(account, target);
      if (observedAvatarHashes.has(key) && observedAvatarHashes.get(key) === nextHash) return false;
      observedAvatarHashes.set(key, nextHash);
      avatarRevisions.set(key, avatarRevision(account, target) + 1);
      for (const [requestKey] of inFlight) {
        if (requestKey.endsWith(`:${account.toLocaleLowerCase()}\0${target.toLocaleLowerCase()}`))
          inFlight.delete(requestKey);
      }
      return profileStore ? profileStore.invalidateIfChanged(account, target, nextHash) : true;
    },
  };
}

module.exports = {
  MAX_PROFILE_IMAGE_BYTES,
  MAX_PROFILE_IMAGE_DIMENSION,
  MAX_PROFILE_REQUESTS_PER_ACCOUNT,
  PROFILE_TIMEOUT_MS,
  ProfileImageRegistry,
  createXmppUserProfileService,
  requireBareJid,
};
