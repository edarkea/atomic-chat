const {
  PROFILE_CACHE_MAX_BYTES,
  PROFILE_CACHE_MAX_ENTRIES,
  XmppProfileCache,
  avatarHash,
} = require('./xmpp-profile-cache.cjs');

/**
 * Durable, bounded application data for XEP-0054 profiles.
 *
 * It reuses the validated, content-addressed storage implementation while
 * disabling time-based expiry. XEP-0153 photo hashes are the invalidation
 * signal for avatar changes.
 */
class XmppProfileStore extends XmppProfileCache {
  /** @param {string} directory @param {object} [options] */
  constructor(directory, options = {}) {
    super(directory, { ...options, ttlMs: null });
  }
}

module.exports = {
  PROFILE_STORE_MAX_BYTES: PROFILE_CACHE_MAX_BYTES,
  PROFILE_STORE_MAX_ENTRIES: PROFILE_CACHE_MAX_ENTRIES,
  XmppProfileStore,
  avatarHash,
};
