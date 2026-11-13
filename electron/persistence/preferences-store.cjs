class PreferencesStore {
  constructor(database) {
    this.database = database;
  }

  getPreferences(scope, scopeId) {
    const rows = this.database
      .prepare(
        'SELECT preference_key, value_json FROM preferences WHERE scope = ? AND scope_id = ?',
      )
      .all(scope, scopeId);
    return Object.fromEntries(rows.map((row) => [row.preference_key, JSON.parse(row.value_json)]));
  }

  updatePreferences(scope, scopeId, values) {
    const now = new Date().toISOString();
    const statement = this.database
      .prepare(`INSERT INTO preferences(scope, scope_id, preference_key, value_json, updated_at)
      VALUES (@scope, @scopeId, @key, @value, @updatedAt)
      ON CONFLICT(scope, scope_id, preference_key) DO UPDATE SET value_json=@value, updated_at=@updatedAt`);
    const transaction = this.database.transaction((entries) =>
      entries.forEach(([key, value]) =>
        statement.run({ scope, scopeId, key, value: JSON.stringify(value), updatedAt: now }),
      ),
    );
    transaction(Object.entries(values));
    return this.getPreferences(scope, scopeId);
  }

  resetPreferences(scope, scopeId) {
    this.database
      .prepare('DELETE FROM preferences WHERE scope = ? AND scope_id = ?')
      .run(scope, scopeId);
    return {};
  }
}

module.exports = { PreferencesStore };
