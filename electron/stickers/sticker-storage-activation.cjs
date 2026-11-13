function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStickerStorageConfiguration(environment = process.env) {
  const providerId = normalizeText(environment.ATOMIC_STICKER_STORAGE_PROVIDER_ID);
  const baseUrl = normalizeText(environment.ATOMIC_STICKER_STORAGE_BASE_URL);
  const origins = String(environment.ATOMIC_STICKER_STORAGE_ORIGINS || '')
    .split(',')
    .map((value) => normalizeText(value))
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const hasAny = Boolean(providerId || baseUrl || origins.length);
  const complete = Boolean(providerId && baseUrl && origins.length);
  return {
    transportMode: 'HTTP_UPLOAD_XEP0363',
    alternativeAvailable: false,
    ...(providerId ? { providerId } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(origins.length ? { storageOrigins: origins } : {}),
    ...(hasAny && !complete
      ? { configurationError: 'INVALID_INPUT' }
      : { configurationError: 'UNSUPPORTED' }),
    configured: complete,
  };
}

function activateStickerStorage({ environment = process.env, providerFactory } = {}) {
  const configuration = readStickerStorageConfiguration(environment);
  if (!configuration.configured || typeof providerFactory !== 'function')
    return { provider: null, configuration };
  const provider = providerFactory({
    providerId: configuration.providerId,
    baseUrl: configuration.baseUrl,
    origins: configuration.storageOrigins,
  });
  if (!provider)
    return {
      provider: null,
      configuration: { ...configuration, configurationError: 'UNSUPPORTED' },
    };
  return {
    provider,
    configuration: {
      ...configuration,
      transportMode: 'PERSISTENT_HTTPS',
      alternativeAvailable: true,
      configurationError: undefined,
    },
  };
}

module.exports = { activateStickerStorage, readStickerStorageConfiguration };
