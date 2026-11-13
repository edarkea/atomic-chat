/**
 * @typedef {Error & {code: string, phase: string}} TaggedError
 * @typedef {'starttls' | 'direct-tls'} MucTransport
 * @typedef {{host: string, port: number, transport: MucTransport}} MucEndpoint
 * @typedef {{accountId: string, service: string, canCreate: false, source: 'operator', evidence: string, endpoint: MucEndpoint}} MucPolicy
 * @typedef {{accountId?: unknown, service?: unknown, canCreate?: unknown, source?: unknown, evidence?: unknown, endpoint?: unknown}} MucPolicyInput
 * @typedef {{host?: unknown, port?: unknown, transport?: unknown}} MucEndpointInput
 * @typedef {{version?: unknown, requestId?: unknown, accountId?: unknown}} MucRequestInput
 * @typedef {'none' | 'visitor' | 'participant' | 'moderator'} MucRole
 * @typedef {'none' | 'member' | 'admin' | 'owner'} MucAffiliation
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

/**
 * @param {unknown} value
 * @returns {value is MucTransport}
 */
function isMucTransport(value) {
  return value === 'starttls' || value === 'direct-tls';
}

/**
 * @param {string} code
 * @param {string} message
 * @param {string} phase
 * @returns {TaggedError}
 */
function taggedError(code, message, phase) {
  const error = new Error(message);
  return Object.assign(error, { code, phase });
}

/**
 * @param {unknown} policy
 * @returns {MucPolicy | undefined}
 */
function normalizeMucPolicy(policy) {
  if (!isRecord(policy)) return undefined;

  const candidate = /** @type {MucPolicyInput} */ (policy);
  const endpointValue = candidate.endpoint;
  const endpoint = isRecord(endpointValue)
    ? /** @type {MucEndpointInput} */ (endpointValue)
    : undefined;
  if (
    typeof candidate.accountId !== 'string' ||
    typeof candidate.service !== 'string' ||
    candidate.canCreate !== false ||
    candidate.source !== 'operator' ||
    typeof candidate.evidence !== 'string' ||
    !candidate.evidence.trim() ||
    !endpoint ||
    typeof endpoint.host !== 'string' ||
    !endpoint.host.trim() ||
    !Number.isInteger(endpoint.port) ||
    !isMucTransport(endpoint.transport)
  )
    return undefined;
  return {
    accountId: candidate.accountId,
    service: candidate.service,
    canCreate: false,
    source: 'operator',
    evidence: candidate.evidence,
    endpoint: {
      host: endpoint.host,
      port: /** @type {number} */ (endpoint.port),
      transport: endpoint.transport,
    },
  };
}

/**
 * @param {string} accountId
 * @param {string} service
 * @param {MucEndpoint | null | undefined} endpoint
 * @returns {string}
 */
function mucPolicyKey(accountId, service, endpoint) {
  return `${accountId.toLowerCase()}|${service.toLowerCase()}|${endpoint?.host?.toLowerCase() || ''}:${endpoint?.port || ''}|${endpoint?.transport || ''}`;
}

/**
 * @param {unknown} input
 * @returns {void}
 */
function assertMucRequest(input) {
  const candidate = isRecord(input) ? /** @type {MucRequestInput} */ (input) : undefined;
  if (
    !candidate ||
    candidate.version !== 1 ||
    typeof candidate.requestId !== 'string' ||
    !candidate.requestId.trim() ||
    typeof candidate.accountId !== 'string' ||
    !candidate.accountId.trim()
  )
    throw taggedError('INVALID_INPUT', 'La solicitud MUC no es válida.', 'muc.input');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function validateRoomJid(value) {
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    value.includes('/') ||
    !/^[^@\s]+@[^@\s]+$/.test(value.trim())
  )
    throw taggedError('INVALID_INPUT', 'El JID de sala no es válido.', 'muc.input');
  return value.trim().toLowerCase();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function validateNickname(value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 128 ||
    /[\s/@<>:&"']/.test(value)
  )
    throw taggedError('INVALID_INPUT', 'El nickname no es válido.', 'muc.input');
  return value.trim();
}

/**
 * @param {unknown} value
 * @returns {MucRole}
 */
function mucRole(value) {
  return value === 'visitor' || value === 'participant' || value === 'moderator' ? value : 'none';
}

/**
 * @param {unknown} value
 * @returns {MucAffiliation}
 */
function mucAffiliation(value) {
  return value === 'member' || value === 'admin' || value === 'owner' ? value : 'none';
}

/**
 * @param {unknown} condition
 * @returns {'CONFLICT' | 'UNAUTHORIZED' | 'NOT_CONNECTED' | 'TRANSPORT_FAILED'}
 */
function mucConditionCode(condition) {
  const value = typeof condition === 'string' ? condition : '';
  return ['conflict', 'not-acceptable'].includes(value)
    ? 'CONFLICT'
    : ['forbidden', 'not-authorized', 'registration-required', 'membership-required'].includes(
          value,
        )
      ? 'UNAUTHORIZED'
      : [
            'service-unavailable',
            'item-not-found',
            'remote-server-not-found',
            'recipient-unavailable',
          ].includes(value)
        ? 'NOT_CONNECTED'
        : value === 'resource-constraint'
          ? 'CONFLICT'
          : 'TRANSPORT_FAILED';
}

module.exports = {
  assertMucRequest,
  mucAffiliation,
  mucConditionCode,
  mucPolicyKey,
  mucRole,
  normalizeMucPolicy,
  validateNickname,
  validateRoomJid,
};
