const MAX_EVENT_JSON_BYTES = 65536;
const MAX_SNAPSHOT_JSON_BYTES = 262144;
const MAX_RESULT_JSON_BYTES = 65536;

function storageError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredText(value, name) {
  if (typeof value !== 'string' || value.length === 0)
    throw storageError('GAME_STORAGE_INVALID_INPUT', `${name} is required`);
  return value;
}

function jsonValue(value, name, maxBytes) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    throw storageError('GAME_STORAGE_INVALID_JSON', `${name} is not serializable`);
  }
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > maxBytes)
    throw storageError('GAME_STORAGE_SIZE_LIMIT', `${name} exceeds its size limit`);
  return json;
}

function parseJson(json, name) {
  try {
    return JSON.parse(json);
  } catch {
    throw storageError('GAME_STORAGE_CORRUPT_JSON', `${name} contains malformed JSON`);
  }
}

function mapSession(row) {
  return row
    ? {
        accountId: row.account_id,
        conversationId: row.conversation_id,
        peerBareJid: row.peer_bare_jid,
        sessionId: row.session_id,
        gameId: row.game_id,
        gameVersion: row.game_version,
        apiVersion: row.api_version,
        localRole: row.local_role,
        state: row.state,
        revision: row.revision,
        stateHash: row.state_hash,
        sessionGeneration: row.session_generation,
        lastEventId: row.last_event_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : undefined;
}

function mapSnapshot(row) {
  return row
    ? {
        sessionId: row.session_id,
        state: parseJson(row.state_json, 'snapshot'),
        revision: row.revision,
        stateHash: row.state_hash,
        createdAt: row.created_at,
      }
    : undefined;
}

class GameStorage {
  constructor(database) {
    if (
      !database ||
      typeof database.prepare !== 'function' ||
      typeof database.transaction !== 'function'
    )
      throw storageError('GAME_STORAGE_INVALID_DATABASE', 'A better-sqlite3 database is required');
    this.database = database;
    this.selectSession = database.prepare(
      'SELECT * FROM game_sessions WHERE account_id = ? AND session_id = ?',
    );
    this.selectSnapshot = database.prepare(
      'SELECT * FROM game_snapshots WHERE account_id = ? AND session_id = ? AND revision = ?',
    );
    this.selectLatestSnapshot = database.prepare(
      'SELECT * FROM game_snapshots WHERE account_id = ? AND session_id = ? ORDER BY revision DESC LIMIT 1',
    );
  }

  createSession(session, snapshot) {
    const sessionJson = jsonValue(snapshot.state, 'snapshot', MAX_SNAPSHOT_JSON_BYTES);
    const insert = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO game_sessions
           (account_id, conversation_id, peer_bare_jid, session_id, game_id, game_version, api_version,
            local_role, state, revision, state_hash, session_generation, last_event_id, created_at, updated_at)
           VALUES (@accountId, @conversationId, @peerBareJid, @sessionId, @gameId, @gameVersion, @apiVersion,
            @localRole, @state, @revision, @stateHash, @sessionGeneration, @lastEventId, @createdAt, @updatedAt)`,
        )
        .run(session);
      this.database
        .prepare(
          `INSERT INTO game_snapshots
           (account_id, session_id, revision, state_hash, state_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          session.accountId,
          session.sessionId,
          snapshot.revision,
          snapshot.stateHash,
          sessionJson,
          snapshot.createdAt,
        );
    });
    try {
      insert();
    } catch (error) {
      if (error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')
        throw storageError('GAME_STORAGE_DUPLICATE_SESSION', 'Session already exists');
      throw error;
    }
    return this.getSession(session.accountId, session.sessionId);
  }

  getSession(accountId, sessionId) {
    requiredText(accountId, 'accountId');
    requiredText(sessionId, 'sessionId');
    return mapSession(this.selectSession.get(accountId, sessionId));
  }

  getSnapshot(accountId, sessionId, revision) {
    const row =
      revision === undefined
        ? this.selectLatestSnapshot.get(accountId, sessionId)
        : this.selectSnapshot.get(accountId, sessionId, revision);
    return mapSnapshot(row);
  }

  getAppliedEventIds(accountId, sessionId) {
    return this.database
      .prepare(
        'SELECT event_id FROM game_events WHERE account_id = ? AND session_id = ? ORDER BY revision',
      )
      .all(accountId, sessionId)
      .map((row) => row.event_id);
  }

  nextActorSeq(accountId, sessionId, actor) {
    const row = this.database
      .prepare(
        'SELECT COALESCE(MAX(actor_seq), 0) + 1 AS next_seq FROM game_events WHERE account_id = ? AND session_id = ? AND actor = ?',
      )
      .get(accountId, sessionId, actor);
    return row.next_seq;
  }

  listSessions(accountId, conversationId) {
    requiredText(accountId, 'accountId');
    const rows =
      conversationId === undefined
        ? this.database
            .prepare(
              'SELECT * FROM game_sessions WHERE account_id = ? ORDER BY updated_at, session_id',
            )
            .all(accountId)
        : this.database
            .prepare(
              'SELECT * FROM game_sessions WHERE account_id = ? AND conversation_id = ? ORDER BY updated_at, session_id',
            )
            .all(accountId, conversationId);
    return rows.map(mapSession);
  }

  getStats(accountId) {
    const filter = accountId === undefined ? '' : ' WHERE account_id = ?';
    const args = accountId === undefined ? [] : [accountId];
    const sessions = this.database
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(MAX(revision), 0) AS max_revision
         FROM game_sessions${filter}`,
      )
      .get(...args);
    const events = this.database
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(length(move_json)), 0) AS json_bytes
         FROM game_events${filter}`,
      )
      .get(...args);
    const snapshots = this.database
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(length(state_json)), 0) AS json_bytes
         FROM game_snapshots${filter}`,
      )
      .get(...args);
    const results = this.database
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(length(result_json)), 0) AS json_bytes
         FROM game_results${filter}`,
      )
      .get(...args);
    return Object.freeze({
      sessions: sessions.count,
      maxRevision: sessions.max_revision,
      events: events.count,
      eventJsonBytes: events.json_bytes,
      snapshots: snapshots.count,
      snapshotJsonBytes: snapshots.json_bytes,
      results: results.count,
      resultJsonBytes: results.json_bytes,
    });
  }

  transitionSession({ accountId, sessionId, fromStates, toState, sessionGeneration, updatedAt }) {
    const allowed = Array.isArray(fromStates) ? fromStates : [];
    if (!allowed.length) throw storageError('GAME_STORAGE_INVALID_INPUT', 'fromStates is required');
    const placeholders = allowed.map(() => '?').join(', ');
    const result = this.database
      .prepare(
        `UPDATE game_sessions SET state = ?, updated_at = ?
         WHERE account_id = ? AND session_id = ? AND session_generation = ? AND state IN (${placeholders})`,
      )
      .run(toState, updatedAt, accountId, sessionId, sessionGeneration, ...allowed);
    if (result.changes !== 1)
      throw storageError('GAME_STORAGE_STATE_CONFLICT', 'Session state or generation changed');
    return this.getSession(accountId, sessionId);
  }

  persistAcceptedEvent({
    accountId,
    sessionId,
    event,
    snapshot,
    result,
    nextState = 'active',
    updatedAt,
  }) {
    const moveJson = jsonValue(event.move, 'event move', MAX_EVENT_JSON_BYTES);
    const stateJson = jsonValue(snapshot.state, 'snapshot', MAX_SNAPSHOT_JSON_BYTES);
    const resultJson =
      result === undefined ? undefined : jsonValue(result, 'result', MAX_RESULT_JSON_BYTES);
    const transaction = this.database.transaction(() => {
      const current = this.getSession(accountId, sessionId);
      if (!current) throw storageError('GAME_STORAGE_SESSION_NOT_FOUND', 'Session does not exist');
      const existing = this.database
        .prepare(
          'SELECT * FROM game_events WHERE account_id = ? AND session_id = ? AND event_id = ?',
        )
        .get(accountId, sessionId, event.eventId);
      if (existing) {
        if (
          existing.revision === event.revision &&
          existing.resulting_state_hash === event.resultingStateHash
        )
          return { kind: 'duplicate' };
        throw storageError(
          'GAME_STORAGE_EVENT_CONFLICT',
          'Event ID was already used with different content',
        );
      }
      const existingActorSequence = this.database
        .prepare(
          'SELECT event_id FROM game_events WHERE account_id = ? AND session_id = ? AND actor = ? AND actor_seq = ?',
        )
        .get(accountId, sessionId, event.actor, event.actorSeq);
      if (existingActorSequence)
        throw storageError(
          'GAME_STORAGE_EVENT_CONFLICT',
          'Actor sequence was already used with another event',
        );
      const existingRevision = this.database
        .prepare(
          'SELECT event_id FROM game_events WHERE account_id = ? AND session_id = ? AND revision = ?',
        )
        .get(accountId, sessionId, event.revision);
      if (existingRevision)
        throw storageError(
          'GAME_STORAGE_EVENT_CONFLICT',
          'Revision was already used with another event',
        );
      if (
        current.revision !== event.expectedRevision ||
        current.stateHash !== event.previousStateHash
      )
        throw storageError(
          'GAME_STORAGE_REVISION_CONFLICT',
          'Stored snapshot no longer matches the event',
        );
      if (event.revision !== current.revision + 1 || snapshot.revision !== event.revision)
        throw storageError(
          'GAME_STORAGE_REVISION_GAP',
          'Accepted event must advance exactly one revision',
        );
      this.database
        .prepare(
          `INSERT INTO game_events
           (account_id, session_id, event_id, actor, actor_seq, expected_revision, revision,
            previous_state_hash, resulting_state_hash, move_json, accepted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          accountId,
          sessionId,
          event.eventId,
          event.actor,
          event.actorSeq,
          event.expectedRevision,
          event.revision,
          event.previousStateHash,
          event.resultingStateHash,
          moveJson,
          updatedAt,
        );
      this.database
        .prepare(
          `INSERT INTO game_snapshots
           (account_id, session_id, revision, state_hash, state_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(accountId, sessionId, snapshot.revision, snapshot.stateHash, stateJson, updatedAt);
      if (resultJson !== undefined)
        this.database
          .prepare(
            'INSERT INTO game_results (account_id, session_id, result_json, recorded_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, session_id) DO UPDATE SET result_json = excluded.result_json, recorded_at = excluded.recorded_at',
          )
          .run(accountId, sessionId, resultJson, updatedAt);
      const update = this.database
        .prepare(
          `UPDATE game_sessions SET state = ?, revision = ?, state_hash = ?, last_event_id = ?, updated_at = ?
           WHERE account_id = ? AND session_id = ? AND revision = ? AND state_hash = ?`,
        )
        .run(
          nextState,
          snapshot.revision,
          snapshot.stateHash,
          event.eventId,
          updatedAt,
          accountId,
          sessionId,
          current.revision,
          current.stateHash,
        );
      if (update.changes !== 1)
        throw storageError(
          'GAME_STORAGE_REVISION_CONFLICT',
          'Session changed during event acceptance',
        );
      return { kind: 'applied' };
    });
    const outcome = transaction();
    return {
      ...outcome,
      session: this.getSession(accountId, sessionId),
      snapshot: this.getSnapshot(accountId, sessionId),
    };
  }

  getResult(accountId, sessionId) {
    const row = this.database
      .prepare(
        'SELECT result_json, recorded_at FROM game_results WHERE account_id = ? AND session_id = ?',
      )
      .get(accountId, sessionId);
    return row
      ? { result: parseJson(row.result_json, 'result'), recordedAt: row.recorded_at }
      : undefined;
  }
}

module.exports = {
  GameStorage,
  MAX_EVENT_JSON_BYTES,
  MAX_SNAPSHOT_JSON_BYTES,
  MAX_RESULT_JSON_BYTES,
};
