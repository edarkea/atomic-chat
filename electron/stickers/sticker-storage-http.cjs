const dns = require('node:dns').promises;
const https = require('node:https');
const {
  isPrivateAddress,
  validateHttpsUrl,
  MAX_STICKER_BYTES,
} = require('../xmpp/xmpp-stickers.cjs');
const { createStickerStorageProvider, storageError } = require('./sticker-storage-provider.cjs');

const KNOWN_CODES = new Set([
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'TIMEOUT',
  'TRANSPORT_FAILED',
  'UNSUPPORTED',
  'MEDIA_PREVIEW_UNAVAILABLE',
  'MEDIA_SIZE_EXCEEDED',
  'MEDIA_DECODE_FAILED',
  'RESOURCE_CONSTRAINT',
]);

function transportError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw storageError('INVALID_INPUT', 'la URL del proveedor no es válida');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw storageError('INVALID_INPUT', 'la URL del proveedor debe ser un origen HTTPS');
  if (isPrivateAddress(url.hostname))
    throw storageError('UNSUPPORTED', 'el proveedor no puede usar una red privada');
  return url;
}

function parseErrorBody(body) {
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (KNOWN_CODES.has(parsed?.code))
      return transportError(parsed.code, 'el proveedor rechazó la operación');
  } catch {
    /* Do not expose response content. */
  }
  return transportError('TRANSPORT_FAILED', 'el proveedor rechazó la operación');
}

function createStickerStorageHttpTransport(options) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const origins = new Set(
    (options.origins || [baseUrl.origin]).map((origin) => new URL(origin).origin),
  );
  if (!origins.has(baseUrl.origin))
    throw storageError('INVALID_INPUT', 'la URL no pertenece a un origen autorizado');
  const lookup = options.lookup || dns.lookup;
  const requestFactory = options.request || https.request;
  const getAuthorizationHeader = options.getAuthorizationHeader;
  if (typeof getAuthorizationHeader !== 'function')
    throw storageError('INVALID_INPUT', 'falta la autorización del adaptador');
  const timeoutMs =
    Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 15000;

  async function destination(value) {
    let target;
    try {
      target = new URL(validateHttpsUrl(value));
    } catch {
      throw transportError('UNSUPPORTED', 'el destino del proveedor no es seguro');
    }
    if (target.origin !== baseUrl.origin || !origins.has(target.origin))
      throw transportError('UNSUPPORTED', 'el destino no pertenece al proveedor');
    const addresses = await lookup(target.hostname, { all: true });
    if (!addresses?.length || addresses.some((entry) => isPrivateAddress(entry.address)))
      throw transportError('UNSUPPORTED', 'el destino del proveedor no está permitido');
    return { target, address: addresses[0].address, family: addresses[0].family };
  }

  async function request(
    accountId,
    method,
    targetUrl,
    headers = {},
    body,
    maxResponseBytes = 256 * 1024,
  ) {
    const auth = await getAuthorizationHeader(accountId);
    if (!auth)
      throw transportError('UNAUTHORIZED', 'la cuenta no tiene credenciales de almacenamiento');
    const target = await destination(targetUrl);
    const requestHeaders = { ...headers, Authorization: auth, Host: target.target.host };
    if (body) requestHeaders['Content-Length'] = String(body.length);
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const clientRequest = requestFactory(
        target.target,
        {
          method,
          headers: requestHeaders,
          rejectUnauthorized: true,
          servername: target.target.hostname,
          lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
        },
        (response) => {
          const status = response.statusCode || 0;
          if (status >= 300 && status < 400) {
            response.resume();
            finish(transportError('UNSUPPORTED', 'el proveedor no permite redirecciones'));
            return;
          }
          const chunks = [];
          let total = 0;
          response.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxResponseBytes) {
              finish(
                transportError('MEDIA_SIZE_EXCEEDED', 'la respuesta supera el límite permitido'),
              );
              response.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.once('aborted', () =>
            finish(transportError('TRANSPORT_FAILED', 'la respuesta fue cancelada')),
          );
          response.once('error', (error) => finish(error));
          response.once('end', () => {
            const result = { status, headers: response.headers, body: Buffer.concat(chunks) };
            if (status < 200 || status >= 300) finish(parseErrorBody(result.body));
            else finish(null, result);
          });
        },
      );
      timer = setTimeout(() => {
        clientRequest.destroy();
        finish(transportError('TIMEOUT', 'la operación HTTPS expiró'));
      }, timeoutMs);
      clientRequest.once('error', (error) =>
        finish(
          error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
            ? transportError('TRANSPORT_FAILED', 'falló la validación TLS')
            : error,
        ),
      );
      clientRequest.end(body);
    });
  }

  function assetUrl(assetId) {
    if (typeof assetId !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(assetId))
      throw transportError('INVALID_INPUT', 'el identificador del asset no es válido');
    return `${baseUrl.origin}/v1/assets/${assetId}`;
  }

  return {
    async getCapabilities({ accountId }) {
      const result = await request(accountId, 'GET', `${baseUrl.origin}/v1/capabilities`);
      return JSON.parse(result.body.toString('utf8'));
    },
    async uploadSticker(input) {
      const result = await request(
        input.accountId,
        'POST',
        `${baseUrl.origin}/v1/assets`,
        {
          'Content-Type': input.metadata.mimeType,
          'X-Atomic-Client-Message-Id': input.idempotencyKey,
          'X-Atomic-Mime-Type': input.metadata.mimeType,
          'X-Atomic-Size-Bytes': String(input.metadata.sizeBytes),
          'X-Atomic-Width': String(input.metadata.width),
          'X-Atomic-Height': String(input.metadata.height),
          'X-Atomic-Sha256': input.metadata.hashValue,
        },
        Buffer.from(input.bytes),
        128 * 1024,
      );
      return JSON.parse(result.body.toString('utf8'));
    },
    async resolveSticker(input) {
      const result = await request(
        input.accountId,
        'HEAD',
        input.remoteUrl,
        {},
        undefined,
        16 * 1024,
      );
      const headers = result.headers;
      return {
        providerId: headers['x-atomic-provider-id'],
        storageOrigin: headers['x-atomic-storage-origin'],
        assetId: headers['x-atomic-asset-id'],
        remoteUrl: input.remoteUrl,
        mimeType: headers['content-type'],
        sizeBytes: headers['content-length'],
        width: Number(headers['x-atomic-width']),
        height: Number(headers['x-atomic-height']),
        hashAlgorithm: 'sha-256',
        hashValue: headers['x-atomic-sha256'],
        availability: 'available',
        expiresAt: headers['x-atomic-expires-at'],
      };
    },
    async downloadSticker(input) {
      const maxBytes = Number(input.maxBytes);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_STICKER_BYTES)
        throw transportError('MEDIA_SIZE_EXCEEDED', 'el límite de descarga no es válido');
      const result = await request(
        input.accountId,
        'GET',
        input.remoteUrl,
        {},
        undefined,
        maxBytes,
      );
      return result.body;
    },
  };
}

function parseTokenMap(environment) {
  try {
    const value = JSON.parse(environment.ATOMIC_STICKER_STORAGE_AUTH_TOKENS_JSON || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
    return new Map(
      Object.entries(value).filter(
        ([accountId, token]) =>
          typeof accountId === 'string' && typeof token === 'string' && token.length > 0,
      ),
    );
  } catch {
    return new Map();
  }
}

function createConfiguredStickerStorageProvider({ environment = process.env, configuration }) {
  const baseUrl = environment.ATOMIC_STICKER_STORAGE_BASE_URL;
  const tokenMap = parseTokenMap(environment);
  if (
    !baseUrl ||
    !configuration?.providerId ||
    !configuration.storageOrigins?.length ||
    !tokenMap.size
  )
    return null;
  const tokenFor = async (accountId) => tokenMap.get(accountId);
  const transport = createStickerStorageHttpTransport({
    baseUrl,
    origins: configuration.storageOrigins,
    getAuthorizationHeader: async (accountId) => {
      const token = await tokenFor(accountId);
      return token ? `Bearer ${token}` : undefined;
    },
  });
  return createStickerStorageProvider(transport, {
    providerId: configuration.providerId,
    origins: configuration.storageOrigins,
    authorizeAccount: async (accountId) => Boolean(await tokenFor(accountId)),
  });
}

module.exports = {
  createConfiguredStickerStorageProvider,
  createStickerStorageHttpTransport,
  normalizeBaseUrl,
};
