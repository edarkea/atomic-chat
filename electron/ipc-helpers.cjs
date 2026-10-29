const preferenceDefaults = { theme: 'atomic', notifications: true, autoLogin: false };

function createIpcHelpers({
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
    requireText(input.accountId, 'ACCOUNT');
    return validateXmppTransport(input.endpoint, appIsPackaged);
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
    ]);
    const rawCode = error?.code;
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
    };
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: code === 'TRANSPORT_FAILED',
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
    ]);
    const code = known.has(raw)
      ? raw
      : raw === 'not_connected'
        ? 'NOT_CONNECTED'
        : 'TRANSPORT_FAILED';
    const messages = {
      INVALID_INPUT: 'La solicitud MUC no es válida.',
      UNAUTHORIZED:
        'La operación MUC no está autorizada o requiere configuración del administrador.',
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
      theme: (value) => value === 'atomic',
      notifications: (value) => typeof value === 'boolean',
      autoLogin: (value) => typeof value === 'boolean',
    };
    for (const [key, value] of Object.entries(changes || {}))
      if (!allowed[key] || !allowed[key](value)) throw new Error('INVALID_INPUT');
  }

  return {
    requestId,
    validVersion,
    requireText,
    validateAccountInput,
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
  };
}

module.exports = { createIpcHelpers, preferenceDefaults };
