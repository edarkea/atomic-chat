const dns = require('node:dns/promises');

const MAX_RECORDS = 32;
const DEFAULT_TIMEOUT_MS = 5000;

function normalizeXmppDomain(value) {
  if (typeof value !== 'string') throw new Error('INVALID_DOMAIN');
  const domain = value.trim().replace(/\.$/, '').toLowerCase();
  if (!domain || domain.length > 253 || /[^a-z0-9.:-]/i.test(domain) || domain.includes('..'))
    throw new Error('INVALID_DOMAIN');
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
      throw new Error('INVALID_DOMAIN');
  }
  return domain;
}

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

function isMissingDnsRecord(error) {
  return ['ENODATA', 'ENOTFOUND'].includes(error?.code);
}

function validateRecord(record, transport) {
  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.name !== 'string' ||
    !record.name.trim()
  )
    throw new Error('INVALID_DNS_RESPONSE');
  if (record.name.trim() === '.') return { negative: true };
  const host = record.name.trim().replace(/\.$/, '').toLowerCase();
  if (!host || host.includes('..') || /[^a-z0-9.:[\]-]/i.test(host) || host.length > 253)
    throw new Error('INVALID_DNS_RESPONSE');
  if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535)
    throw new Error('INVALID_DNS_RESPONSE');
  if (!Number.isInteger(record.priority) || record.priority < 0 || record.priority > 65535)
    throw new Error('INVALID_DNS_RESPONSE');
  if (!Number.isInteger(record.weight) || record.weight < 0 || record.weight > 65535)
    throw new Error('INVALID_DNS_RESPONSE');
  return { host, port: record.port, priority: record.priority, weight: record.weight, transport };
}

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

async function queryService(domain, transport, resolveSrv, timeoutMs) {
  const service = `${transport === 'direct-tls' ? '_xmpps-client._tcp.' : '_xmpp-client._tcp.'}${domain}`;
  try {
    const records = await withTimeout(resolveSrv(service), timeoutMs);
    if (!Array.isArray(records) || records.length > MAX_RECORDS)
      throw new Error('INVALID_DNS_RESPONSE');
    const validated = records.map((record) => validateRecord(record, transport));
    if (validated.some((record) => record.negative)) return { records: [], negative: true };
    const deduplicated = new Map(
      validated.map((record) => [
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
  if (results.some((result) => result.negative))
    throw Object.assign(new Error('SERVICE_UNAVAILABLE'), { code: 'SERVICE_UNAVAILABLE' });
  return {
    domain,
    fallback: true,
    candidates: [{ host: domain, port: 5222, priority: 0, weight: 0, transport: 'starttls' }],
  };
}

module.exports = { normalizeXmppDomain, resolveXmppEndpoints, weightedOrder };
