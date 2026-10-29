const { normalizeXmppDomain } = require('./xmpp-discovery.cjs');

function isPackagedRuntime(appIsPackaged = false) {
  return appIsPackaged === true;
}

function validateXmppTransport(endpoint, packaged = false) {
  if (
    !endpoint ||
    typeof endpoint.host !== 'string' ||
    !endpoint.host.trim() ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535
  )
    throw new Error('INVALID_ENDPOINT');
  if (/\s|[/?#]/.test(endpoint.host) || endpoint.host.length > 253)
    throw new Error('INVALID_ENDPOINT');
  if (typeof endpoint.tls !== 'boolean') throw new Error('INVALID_ENDPOINT');
  const domain = endpoint.domain ? normalizeXmppDomain(endpoint.domain) : undefined;
  const transport =
    endpoint.transport || (endpoint.tls && endpoint.port === 5223 ? 'direct-tls' : 'starttls');
  if (!['starttls', 'direct-tls'].includes(transport)) throw new Error('TRANSPORT_INCOMPATIBLE');
  if (packaged && endpoint.allowInsecureTls === true) throw new Error('TLS_POLICY');
  return {
    ...endpoint,
    ...(domain ? { domain } : {}),
    tls: true,
    transport,
    rejectUnauthorized: true,
  };
}

module.exports = { isPackagedRuntime, validateXmppTransport };
