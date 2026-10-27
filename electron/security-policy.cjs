function isPackagedRuntime() {
  return process.defaultApp === false || process.env.ATOMIC_CHAT_PACKAGED === 'true';
}

function validateXmppTransport(endpoint, packaged = isPackagedRuntime()) {
  if (!endpoint || typeof endpoint.host !== 'string' || !endpoint.host.trim() || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) throw new Error('INVALID_ENDPOINT');
  if (typeof endpoint.tls !== 'boolean') throw new Error('INVALID_ENDPOINT');
  if (packaged && (!endpoint.tls || endpoint.allowInsecureTls === true)) throw new Error('TLS_POLICY');
  return { ...endpoint, tls: endpoint.tls === true, rejectUnauthorized: endpoint.allowInsecureTls !== true };
}

module.exports = { isPackagedRuntime, validateXmppTransport };
