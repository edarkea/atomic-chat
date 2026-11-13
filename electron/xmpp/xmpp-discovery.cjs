const dns = require('node:dns/promises');

const MAX_RECORDS = 32;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * @typedef {Error & {code: string}} DiscoveryError
 * @typedef {'starttls' | 'direct-tls'} XmppTransport
 * @typedef {{name?: unknown, port?: unknown, priority?: unknown, weight?: unknown}} RawSrvRecord
 * @typedef {{host: string, port: number, priority: number, weight: number, transport: XmppTransport}} SrvRecord
 * @typedef {{negative: true}} NegativeSrvRecord
 * @typedef {{resolveSrv?: (service: string) => Promise<RawSrvRecord[]>, timeoutMs?: number, random?: () => number}} DiscoveryOptions
 * @typedef {{records: SrvRecord[], negative: boolean}} ServiceResult
 * @typedef {{domain: string, candidates: SrvRecord[], fallback: boolean}} DiscoveryResult
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

/**
 * @param {string} code
 * @returns {DiscoveryError}
 */
function typedError(code) {
  const error = new Error(code);
  return Object.assign(error, { code });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeXmppDomain(value) {
  if (typeof value !== 'string') throw typedError('INVALID_DOMAIN');
  const domain = value.trim().replace(/\.$/, '').toLowerCase();
  if (!domain || domain.length > 253 || /[^a-z0-9.:-]/i.test(domain) || domain.includes('..'))
    throw typedError('INVALID_DOMAIN');
  if (
    domain !== 'localhost' &&
    !/^\[[0-9a-f:]+\]$/i.test(domain) &&
    !/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)
  ) {
    const labels = domain.split('.');
    if (
      labels.some(
        (label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
      )
    )
      throw typedError('INVALID_DOMAIN');
  }
  return domain;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error('DNS_TIMEOUT'), { code: 'DNS_TIMEOUT' })),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingDnsRecord(error) {
  const code = isRecord(error) ? error['code'] : undefined;
  return typeof code === 'string' && ['ENODATA', 'ENOTFOUND'].includes(code);
}

/**
 * @param {unknown} record
 * @param {XmppTransport} transport
 * @returns {SrvRecord | NegativeSrvRecord}
 */
function validateRecord(record, transport) {
  const candidate = isRecord(record) ? /** @type {RawSrvRecord} */ (record) : undefined;
  if (!candidate || typeof candidate.name !== 'string' || !candidate.name.trim())
    throw typedError('INVALID_DNS_RESPONSE');
  if (candidate.name.trim() === '.') return { negative: true };
  const host = candidate.name.trim().replace(/\.$/, '').toLowerCase();
  const port = candidate.port;
  const priority = candidate.priority;
  const weight = candidate.weight;
  if (!host || host.includes('..') || /[^a-z0-9.:[\]-]/i.test(host) || host.length > 253)
    throw typedError('INVALID_DNS_RESPONSE');
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
    throw typedError('INVALID_DNS_RESPONSE');
  if (
    typeof priority !== 'number' ||
    !Number.isInteger(priority) ||
    priority < 0 ||
    priority > 65535
  )
    throw typedError('INVALID_DNS_RESPONSE');
  if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 0 || weight > 65535)
    throw typedError('INVALID_DNS_RESPONSE');
  return {
    host,
    port,
    priority,
    weight,
    transport,
  };
}

/**
 * @param {SrvRecord | NegativeSrvRecord} record
 * @returns {record is SrvRecord}
 */
function isSrvRecord(record) {
  return !('negative' in record);
}

/**
 * @param {ReadonlyArray<SrvRecord>} records
 * @param {() => number} random
 * @returns {SrvRecord[]}
 */
function weightedOrder(records, random) {
  const result = [];
  const priorities = [...new Set(records.map((record) => record.priority))].sort((a, b) => a - b);
  for (const priority of priorities) {
    let remaining = records.filter((record) => record.priority === priority).slice();
    while (remaining.length) {
      const total = remaining.reduce((sum, record) => sum + record.weight, 0);
      const value = Math.min(0.999999999, Math.max(0, Number(random())));
      let target = value * (total || remaining.length);
      let selected = remaining[remaining.length - 1];
      for (const record of remaining) {
        target -= total ? record.weight : 1;
        if (target < 0) {
          selected = record;
          break;
        }
      }
      result.push(selected);
      remaining = remaining.filter((record) => record !== selected);
    }
  }
  return result;
}

/**
 * @param {string} domain
 * @param {XmppTransport} transport
 * @param {(service: string) => Promise<RawSrvRecord[]>} resolveSrv
 * @param {number} timeoutMs
 * @returns {Promise<ServiceResult>}
 */
async function queryService(domain, transport, resolveSrv, timeoutMs) {
  const service = `${transport === 'direct-tls' ? '_xmpps-client._tcp.' : '_xmpp-client._tcp.'}${domain}`;
  try {
    const records = await withTimeout(resolveSrv(service), timeoutMs);
    if (!Array.isArray(records) || records.length > MAX_RECORDS)
      throw typedError('INVALID_DNS_RESPONSE');
    const validated = records.map((record) => validateRecord(record, transport));
    if (validated.some((record) => 'negative' in record && record.negative))
      return { records: [], negative: true };
    const validRecords = validated.filter(isSrvRecord);
    const deduplicated = new Map(
      validRecords.map((record) => [
        `${record.host}|${record.port}|${record.priority}|${record.weight}|${record.transport}`,
        record,
      ]),
    );
    return { records: [...deduplicated.values()], negative: false };
  } catch (error) {
    if (isMissingDnsRecord(error)) return { records: [], negative: false };
    throw error;
  }
}

/**
 * @param {unknown} domainInput
 * @param {DiscoveryOptions} [options={}]
 * @returns {Promise<DiscoveryResult>}
 */
async function resolveXmppEndpoints(domainInput, options = {}) {
  const domain = normalizeXmppDomain(domainInput);
  const resolveSrv = options.resolveSrv || dns.resolveSrv;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const random = options.random || Math.random;
  const results = await Promise.all([
    queryService(domain, 'starttls', resolveSrv, timeoutMs),
    queryService(domain, 'direct-tls', resolveSrv, timeoutMs),
  ]);
  const records = results.flatMap((result) => result.records);
  if (records.length)
    return { domain, candidates: weightedOrder(records, random), fallback: false };
  if (results.some((result) => result.negative)) throw typedError('SERVICE_UNAVAILABLE');
  return {
    domain,
    fallback: true,
    candidates: [{ host: domain, port: 5222, priority: 0, weight: 0, transport: 'starttls' }],
  };
}

module.exports = { normalizeXmppDomain, resolveXmppEndpoints, weightedOrder };
