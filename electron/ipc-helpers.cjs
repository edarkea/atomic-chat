const preferenceDefaults = { theme: 'atomic', notifications: true, autoLogin: false };
const preferenceKeys = ['theme', 'customTheme', 'notifications', 'autoLogin'];
const themeColorKeys = [
  'background',
  'surface',
  'surfaceRaised',
  'accent',
  'text',
  'textSecondary',
  'border',
  'incomingBubble',
  'outgoingBubble',
  'focus',
];

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function validateThemePalette(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_INPUT');
  const keys = Object.keys(value);
  if (keys.length !== themeColorKeys.length || keys.some((key) => !themeColorKeys.includes(key)))
    throw new Error('INVALID_INPUT');
  for (const key of themeColorKeys) if (!isHexColor(value[key])) throw new Error('INVALID_INPUT');
  return value;
}

function createIpcHelpers({
  assertSender,
  validateXmppTransport,
  appIsPackaged,
  getRuntime,
  fileTransfers,
  outgoingFileTransfers,
  historySecurity,
}) {
  function requestId(event, input) {
    return input?.requestId || `ipc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function validVersion(input) {
    return input?.version === 1;
  }

  function requireText(value, name) {
    if (typeof value !== 'string' || !value.trim() || value.length > 512)
      throw new Error(`INVALID_${name}`);
    return value.trim();
  }

  function validateAccountInput(input) {
    if (!validVersion(input)) throw new Error('UNSUPPORTED');
    requireText(input?.accountId, 'ACCOUNT');
    if (
      input.profileId !== undefined &&
      (typeof input.profileId !== 'string' || input.profileId !== input.accountId)
    )
      throw new Error('INVALID_INPUT');
    if (
      input.profileDomain !== undefined &&
      (typeof input.profileDomain !== 'string' ||
        !input.profileDomain.trim() ||
        input.profileDomain.length > 253)
    )
      throw new Error('INVALID_DOMAIN');
    if (!input.endpoint) return undefined;
    return validateXmppTransport(input.endpoint, appIsPackaged);
  }

  function validateConnectionProfile(profile, options = {}) {
    if (!profile || typeof profile !== 'object') throw new Error('INVALID_INPUT');
    if (
      typeof profile.accountId !== 'string' ||
      !profile.accountId.trim() ||
      profile.accountId.length > 512
    )
      throw new Error('INVALID_INPUT');
    if (typeof profile.domain !== 'string' || !profile.domain.trim() || profile.domain.length > 253)
      throw new Error('INVALID_INPUT');
    const separator = profile.accountId.indexOf('@');
    if (separator < 0 && options.allowLegacy) {
      if (/[^a-z0-9_.-]/i.test(profile.accountId)) throw new Error('INVALID_INPUT');
    } else if (
      separator <= 0 ||
      separator !== profile.accountId.lastIndexOf('@') ||
      /[\s/]/.test(profile.accountId.slice(0, separator)) ||
      profile.accountId
        .slice(separator + 1)
        .toLowerCase()
        .replace(/\.$/, '') !== profile.domain.toLowerCase().replace(/\.$/, '')
    )
      throw new Error('INVALID_INPUT');
    if (
      !['automatic', 'manual'].includes(profile.mode) ||
      typeof profile.updatedAt !== 'string' ||
      !profile.updatedAt.trim()
    )
      throw new Error('INVALID_INPUT');
    if (profile.mode === 'manual') {
      const endpoint = profile.manualEndpoint;
      if (
        !endpoint ||
        typeof endpoint.host !== 'string' ||
        !endpoint.host.trim() ||
        !Number.isInteger(endpoint.port) ||
        endpoint.port < 1 ||
        endpoint.port > 65535 ||
        !['starttls', 'direct-tls'].includes(endpoint.transport)
      )
        throw new Error('INVALID_INPUT');
    } else if (profile.manualEndpoint !== undefined) throw new Error('INVALID_INPUT');
    return profile;
  }

  function validateCertificateDecision(input) {
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      typeof input.fingerprintSha256 !== 'string' ||
      !input.fingerprintSha256.trim() ||
      !['cancel', 'trust_once', 'trust_and_remember'].includes(input.decision)
    )
      throw new Error('INVALID_INPUT');
  }

  function connectionError(error, requestIdValue) {
    const certificate = error?.verificationError;
    const knownCodes = new Set([
      'CERTIFICATE_REJECTED',
      'CERTIFICATE_DECISION_TIMEOUT',
      'CERTIFICATE_INVALID',
      'TRANSPORT_INCOMPATIBLE',
      'STARTTLS_UNAVAILABLE',
      'TLS_NEGOTIATION_FAILED',
      'SERVER_UNREACHABLE',
      'AUTH_FAILED',
      'TLS_POLICY',
      'INVALID_ENDPOINT',
      'INVALID_DOMAIN',
      'INVALID_DNS_RESPONSE',
      'SERVICE_UNAVAILABLE',
      'DNS_TIMEOUT',
      'INVALID_INPUT',
    ]);
    const rawCode = error?.code || error?.message;
    const code =
      error?.message === 'secret_unavailable' ||
      error?.message === 'certificate_storage_unavailable'
        ? 'STORAGE_FAILED'
        : rawCode === 'TLS_POLICY'
          ? 'UNSUPPORTED'
          : ['not-authorized', 'AUTH_FAILED'].includes(rawCode)
            ? 'AUTH_FAILED'
            : ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(rawCode)
              ? 'SERVER_UNREACHABLE'
              : [
                    'ERR_SSL_WRONG_VERSION_NUMBER',
                    'ERR_SSL_UNSUPPORTED_PROTOCOL',
                    'ERR_TLS_CERT_ALTNAME_INVALID',
                    'TLS_NEGOTIATION_FAILED',
                  ].includes(rawCode)
                ? 'TLS_NEGOTIATION_FAILED'
                : knownCodes.has(rawCode)
                  ? rawCode
                  : 'TRANSPORT_FAILED';
    const messages = {
      CERTIFICATE_REJECTED: 'La conexión fue cancelada porque no se aceptó el certificado.',
      CERTIFICATE_INVALID:
        certificate?.message || 'El certificado no cumple la política de seguridad.',
      TRANSPORT_INCOMPATIBLE: 'El transporte configurado no coincide con el servidor o el puerto.',
      STARTTLS_UNAVAILABLE: 'El servidor no ofrece STARTTLS.',
      TLS_NEGOTIATION_FAILED: 'Falló la negociación TLS.',
      SERVER_UNREACHABLE: 'No fue posible alcanzar el servidor XMPP.',
      AUTH_FAILED: 'El servidor rechazó la autenticación.',
      STORAGE_FAILED: 'No fue posible acceder al almacenamiento seguro.',
      UNSUPPORTED: 'La política de seguridad no permite este transporte.',
      INVALID_ENDPOINT: 'La configuración del endpoint XMPP no es válida.',
      INVALID_DOMAIN: 'El dominio XMPP no es válido.',
      INVALID_DNS_RESPONSE: 'El descubrimiento del servidor devolvió datos no válidos.',
      SERVICE_UNAVAILABLE: 'El dominio XMPP rechazó el servicio solicitado.',
      DNS_TIMEOUT: 'El descubrimiento del servidor excedió el tiempo límite.',
      INVALID_INPUT: 'La solicitud de conexión no es válida.',
    };
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: [
          'TRANSPORT_FAILED',
          'DNS_TIMEOUT',
          'SERVER_UNREACHABLE',
          'TLS_NEGOTIATION_FAILED',
        ].includes(code),
        requestId: requestIdValue,
        message: messages[code] || 'No fue posible conectar con el servidor XMPP.',
        ...(certificate ? { certificate } : {}),
      },
    };
  }

  function authorizeMucInput(event, input) {
    const { xmpp } = getRuntime();
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId))
      throw new Error('UNAUTHORIZED');
    if (
      !xmpp.sessions.has(input.accountId) ||
      xmpp.states.get(input.accountId)?.status !== 'connected'
    )
      throw new Error('NOT_CONNECTED');
  }

  function mucError(error, event, input) {
    const raw = error?.code || error?.message;
    const known = new Set([
      'INVALID_INPUT',
      'UNAUTHORIZED',
      'NOT_CONNECTED',
      'TIMEOUT',
      'TRANSPORT_FAILED',
      'CONFLICT',
      'UNSUPPORTED',
      'INTERNAL',
      'MUC_POLICY_MISSING',
      'MUC_POLICY_MISMATCH',
      'MUC_DISCOVERY_STALE',
      'MUC_SERVER_REJECTED',
    ]);
    const code = known.has(raw)
      ? raw
      : raw === 'not_connected'
        ? 'NOT_CONNECTED'
        : 'TRANSPORT_FAILED';
    const messages = {
      INVALID_INPUT: 'La solicitud MUC no es válida.',
      UNAUTHORIZED:
        'La ventana o la cuenta no están autorizadas para esta operación MUC.',
      MUC_POLICY_MISSING:
        'La entrada MUC está bloqueada: falta la acreditación administrativa requerida.',
      MUC_POLICY_MISMATCH:
        'La acreditación MUC no coincide con la cuenta, servicio o endpoint actual.',
      MUC_DISCOVERY_STALE:
        'El descubrimiento de la sala está obsoleto o la sala ya no está disponible. Vuelve a descubrirla.',
      MUC_SERVER_REJECTED: 'El servidor XMPP rechazó la entrada a la sala.',
      NOT_CONNECTED: 'La cuenta no está conectada o la sala ya no está disponible.',
      TIMEOUT: 'La operación MUC excedió el tiempo límite.',
      CONFLICT: 'La operación MUC entra en conflicto con el estado actual de la sala.',
      UNSUPPORTED: 'El servidor no ofrece la capacidad MUC solicitada.',
      INTERNAL: 'No fue posible completar la operación MUC.',
      TRANSPORT_FAILED: 'El transporte XMPP no pudo completar la operación MUC.',
    };
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: code === 'TIMEOUT' || code === 'TRANSPORT_FAILED',
        requestId: requestId(event, input),
        message: messages[code],
      },
    };
  }

  function validateMucRoomInput(input, requireBody = false) {
    if (
      typeof input.roomJid !== 'string' ||
      !input.roomJid.trim() ||
      input.roomJid.length > 512 ||
      input.roomJid.includes('/') ||
      !/^[^@\s]+@[^@\s]+$/.test(input.roomJid.trim())
    )
      throw new Error('INVALID_INPUT');
    if (
      requireBody &&
      (typeof input.clientMessageId !== 'string' ||
        !input.clientMessageId.trim() ||
        input.clientMessageId.length > 512)
    )
      throw new Error('INVALID_INPUT');
  }

  function fileRecord(transferId) {
    try {
      return fileTransfers.get(transferId);
    } catch {
      return outgoingFileTransfers.get(transferId);
    }
  }

  function authorizeFileInput(event, input) {
    assertSender(event);
    const { xmpp } = getRuntime();
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      typeof input.transferId !== 'string' ||
      !input.transferId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId))
      throw new Error('UNAUTHORIZED');
    if (
      !xmpp.sessions.has(input.accountId) ||
      xmpp.states.get(input.accountId)?.status !== 'connected'
    )
      throw new Error('NOT_CONNECTED');
    const record = fileRecord(input.transferId);
    if (record.offer.accountId !== input.accountId || record.ownerSenderId !== event.sender.id)
      throw new Error('UNAUTHORIZED');
    return record;
  }

  function fileResultError(error, event, input) {
    const raw = error?.code || error?.message;
    const known = new Set([
      'INVALID_INPUT',
      'UNAUTHORIZED',
      'NOT_CONNECTED',
      'TIMEOUT',
      'CONFLICT',
      'STORAGE_FAILED',
      'TRANSPORT_FAILED',
      'UNSUPPORTED',
      'INTERNAL',
    ]);
    const code = known.has(raw)
      ? raw
      : raw === 'RESOURCE_CONSTRAINT'
        ? 'CONFLICT'
        : raw === 'UNSUPPORTED_METHOD'
          ? 'UNSUPPORTED'
          : raw === 'RECIPIENT_UNAVAILABLE'
            ? 'NOT_CONNECTED'
            : raw === 'REMOTE_REJECTED'
              ? 'CONFLICT'
              : 'INTERNAL';
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: code === 'TIMEOUT' || code === 'TRANSPORT_FAILED' || code === 'NOT_CONNECTED',
        requestId: requestId(event, input),
        message:
          code === 'STORAGE_FAILED'
            ? 'No fue posible acceder al archivo.'
            : code === 'UNSUPPORTED'
              ? 'Esta acción no está disponible para este archivo.'
              : code === 'NOT_CONNECTED'
                ? 'El destinatario ya no está disponible.'
                : 'No fue posible completar la transferencia.',
      },
    };
  }

  function authorizeHistoryInput(event, input) {
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId))
      throw new Error('UNAUTHORIZED');
  }

  function historyError(error, event, input) {
    const code =
      error.message === 'INVALID_INPUT'
        ? 'INVALID_INPUT'
        : error.message === 'UNAUTHORIZED'
          ? 'UNAUTHORIZED'
          : 'STORAGE_FAILED';
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: false,
        requestId: requestId(event, input),
        message:
          code === 'INVALID_INPUT'
            ? 'La solicitud de historial no es válida.'
            : code === 'UNAUTHORIZED'
              ? 'La cuenta no está autorizada para esta ventana.'
              : 'No fue posible consultar el historial.',
      },
    };
  }

  function preferenceScope(key, accountId) {
    return key === 'autoLogin'
      ? { scope: 'account', scopeId: accountId }
      : { scope: 'global', scopeId: 'app' };
  }

  function validatePreferences(changes) {
    const allowed = {
      theme: (value) =>
        value === 'atomic' || value === 'dark' || value === 'light' || value === 'custom',
      customTheme: validateThemePalette,
      notifications: (value) => typeof value === 'boolean',
      autoLogin: (value) => typeof value === 'boolean',
    };
    for (const [key, value] of Object.entries(changes || {}))
      if (!allowed[key] || !allowed[key](value)) throw new Error('INVALID_INPUT');
    if (
      changes?.theme === 'custom' &&
      Object.hasOwn(changes, 'customTheme') &&
      !changes.customTheme
    )
      throw new Error('INVALID_INPUT');
  }

  return {
    requestId,
    validVersion,
    requireText,
    validateAccountInput,
    validateConnectionProfile,
    validateCertificateDecision,
    connectionError,
    authorizeMucInput,
    mucError,
    validateMucRoomInput,
    authorizeFileInput,
    fileResultError,
    authorizeHistoryInput,
    historyError,
    preferenceScope,
    validatePreferences,
    preferenceKeys,
    validateThemePalette,
  };
}

module.exports = { createIpcHelpers, preferenceDefaults };
