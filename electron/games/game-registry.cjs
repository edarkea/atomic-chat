const SUPPORTED_API_VERSION = 1;
const SUPPORTED_CAPABILITIES = new Set(['invites', 'replay', 'resync', 'score']);

function registryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function publicDescriptor(descriptor) {
  return Object.freeze({
    ...descriptor,
    players: Object.freeze({ ...descriptor.players }),
    capabilities: Object.freeze([...descriptor.capabilities]),
  });
}

function validateOfficialDescriptor(descriptor, rules) {
  if (!descriptor || typeof descriptor !== 'object')
    throw registryError('GAME_REGISTRY_INVALID_DESCRIPTOR', 'Game descriptor must be an object');
  if (descriptor.distribution !== 'official' || descriptor.source !== 'built-in')
    throw registryError(
      'GAME_REGISTRY_UNSUPPORTED_DISTRIBUTION',
      'Only built-in official games are supported',
    );
  if (typeof descriptor.gameId !== 'string' || descriptor.gameId.length === 0)
    throw registryError('GAME_REGISTRY_INVALID_ID', 'Game ID is required');
  if (typeof descriptor.displayName !== 'string' || descriptor.displayName.length === 0)
    throw registryError('GAME_REGISTRY_INVALID_DESCRIPTOR', 'Game display name is required');
  if (descriptor.apiVersion !== SUPPORTED_API_VERSION)
    throw registryError('GAME_REGISTRY_UNSUPPORTED_VERSION', 'Game API version is not supported');
  if (typeof descriptor.version !== 'string' || descriptor.version.length === 0)
    throw registryError('GAME_REGISTRY_UNSUPPORTED_VERSION', 'Game version is required');
  if (descriptor.players?.min !== 2 || descriptor.players?.max !== 2)
    throw registryError('GAME_REGISTRY_UNSUPPORTED_PLAYERS', 'Only two-player games are supported');
  if (
    !Array.isArray(descriptor.capabilities) ||
    descriptor.capabilities.some((capability) => !SUPPORTED_CAPABILITIES.has(capability))
  )
    throw registryError('GAME_REGISTRY_UNSUPPORTED_CAPABILITY', 'Game capability is not supported');
  if (!rules || typeof rules !== 'object' || typeof rules.applyMove !== 'function')
    throw registryError('GAME_REGISTRY_INVALID_RULES', 'Game rules are not executable');
  if (rules.gameId !== descriptor.gameId || rules.gameVersion !== descriptor.version)
    throw registryError(
      'GAME_REGISTRY_RULE_MISMATCH',
      'Descriptor and rules identity do not match',
    );
}

class GameRegistry {
  constructor() {
    this.records = new Map();
  }

  registerOfficial(descriptor, rules) {
    validateOfficialDescriptor(descriptor, rules);
    if (this.records.has(descriptor.gameId))
      throw registryError(
        'GAME_REGISTRY_DUPLICATE_ID',
        `Game ID already registered: ${descriptor.gameId}`,
      );
    const publicValue = publicDescriptor(descriptor);
    this.records.set(descriptor.gameId, Object.freeze({ descriptor: publicValue, rules }));
    return publicValue;
  }

  has(gameId) {
    return this.records.has(gameId);
  }

  getDescriptor(gameId, version) {
    const record = this.records.get(gameId);
    if (!record || (version !== undefined && record.descriptor.version !== version))
      return undefined;
    return record.descriptor;
  }

  getRules(gameId, version) {
    const record = this.records.get(gameId);
    if (!record || record.descriptor.version !== version) return undefined;
    return record.rules;
  }

  catalog() {
    return Object.freeze([...this.records.values()].map((record) => record.descriptor));
  }
}

module.exports = { GameRegistry, SUPPORTED_API_VERSION };
