/** @typedef {{maxSessionsPerAccount: number, maxSessionsPerPeer: number, maxPendingSessionsPerAccount: number, maxEventsPerWindow: number, eventWindowMs: number, maxPendingAcksPerSession: number, maxStateRequestsPerSession: number, maxSeenEventsPerSession: number, maxRateScopesPerAccount: number}} GameLimits */
/** @typedef {{[K in keyof GameLimits]?: unknown}} GameLimitOverrides */

const DEFAULT_GAME_LIMITS = /** @type {Readonly<GameLimits>} */ (
  Object.freeze({
    maxSessionsPerAccount: 32,
    maxSessionsPerPeer: 8,
    maxPendingSessionsPerAccount: 16,
    maxEventsPerWindow: 128,
    eventWindowMs: 1000,
    maxPendingAcksPerSession: 32,
    maxStateRequestsPerSession: 4,
    maxSeenEventsPerSession: 4096,
    maxRateScopesPerAccount: 128,
  })
);

const LIMIT_KEYS = /** @type {Array<keyof GameLimits>} */ (
  Object.freeze(Object.keys(DEFAULT_GAME_LIMITS))
);

/** @param {unknown} value @param {number} fallback @param {string} name */
function positiveLimit(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid game limit: ${name}`);
  return parsed;
}

/** @param {GameLimitOverrides} [overrides] @returns {Readonly<GameLimits>} */
function normalizeGameLimits(overrides = {}) {
  const source = overrides && typeof overrides === 'object' ? overrides : {};
  const result = /** @type {GameLimits} */ ({});
  for (const key of LIMIT_KEYS)
    result[key] = positiveLimit(source[key], DEFAULT_GAME_LIMITS[key], key);
  return Object.freeze(result);
}

/** @param {NodeJS.ProcessEnv} [environment] @returns {Readonly<GameLimits>} */
function limitsFromEnvironment(environment = process.env) {
  const names = {
    maxSessionsPerAccount: 'ATOMIC_GAMES_MAX_SESSIONS_PER_ACCOUNT',
    maxSessionsPerPeer: 'ATOMIC_GAMES_MAX_SESSIONS_PER_PEER',
    maxPendingSessionsPerAccount: 'ATOMIC_GAMES_MAX_PENDING_SESSIONS_PER_ACCOUNT',
    maxEventsPerWindow: 'ATOMIC_GAMES_MAX_EVENTS_PER_WINDOW',
    eventWindowMs: 'ATOMIC_GAMES_EVENT_WINDOW_MS',
    maxPendingAcksPerSession: 'ATOMIC_GAMES_MAX_PENDING_ACKS_PER_SESSION',
    maxStateRequestsPerSession: 'ATOMIC_GAMES_MAX_STATE_REQUESTS_PER_SESSION',
    maxSeenEventsPerSession: 'ATOMIC_GAMES_MAX_SEEN_EVENTS_PER_SESSION',
    maxRateScopesPerAccount: 'ATOMIC_GAMES_MAX_RATE_SCOPES_PER_ACCOUNT',
  };
  const values = /** @type {GameLimitOverrides} */ ({});
  for (const [key, name] of Object.entries(names))
    values[/** @type {keyof GameLimits} */ (key)] = environment[name];
  return normalizeGameLimits(values);
}

module.exports = { DEFAULT_GAME_LIMITS, normalizeGameLimits, limitsFromEnvironment };
