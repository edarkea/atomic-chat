class AccountConnectionStore {
  constructor(database) {
    this.database = database;
  }

  upsertAccount(account) {
    const value = {
      ...account,
      transport: account.transport || (account.tls ? 'direct-tls' : 'starttls'),
    };
    this.database
      .prepare(
        `INSERT INTO accounts(account_id, endpoint_host, endpoint_port, tls, transport, credential_ref, created_at)
      VALUES (@accountId, @host, @port, @tls, @transport, @credentialRef, @createdAt)
      ON CONFLICT(account_id) DO UPDATE SET endpoint_host=@host, endpoint_port=@port, tls=@tls, transport=@transport, credential_ref=@credentialRef`,
      )
      .run(value);
  }

  saveConnectionProfile(profile) {
    const manual = profile.mode === 'manual' ? profile.manualEndpoint : undefined;
    this.database
      .prepare('DELETE FROM deleted_connection_profiles WHERE account_id = ?')
      .run(profile.accountId);
    this.database
      .prepare(
        `INSERT INTO connection_profiles(account_id, domain, mode, manual_host, manual_port, manual_transport, updated_at)
      VALUES (@accountId, @domain, @mode, @host, @port, @transport, @updatedAt)
      ON CONFLICT(account_id) DO UPDATE SET domain=@domain, mode=@mode, manual_host=@host,
      manual_port=@port, manual_transport=@transport, updated_at=@updatedAt`,
      )
      .run({
        accountId: profile.accountId,
        domain: profile.domain,
        mode: profile.mode,
        host: manual?.host || null,
        port: manual?.port || null,
        transport: manual?.transport || null,
        updatedAt: profile.updatedAt,
      });
    return this.getConnectionProfile(profile.accountId);
  }

  getConnectionProfile(accountId) {
    if (
      this.database
        .prepare('SELECT 1 FROM deleted_connection_profiles WHERE account_id = ?')
        .get(accountId)
    )
      return null;
    const row = this.database
      .prepare(
        `SELECT account_id AS accountId, domain, mode,
      manual_host AS host, manual_port AS port, manual_transport AS transport, updated_at AS updatedAt
      FROM connection_profiles WHERE account_id = ?`,
      )
      .get(accountId);
    if (row) return this.profileFromRow(row);
    const legacy = this.database
      .prepare(
        `SELECT account_id AS accountId, endpoint_host AS host,
      endpoint_port AS port, transport, created_at AS updatedAt FROM accounts WHERE account_id = ?`,
      )
      .get(accountId);
    if (!legacy) return null;
    return this.legacyProfile(legacy);
  }

  listConnectionProfiles() {
    const rows = this.database
      .prepare(
        `SELECT account_id AS accountId, domain, mode,
      manual_host AS host, manual_port AS port, manual_transport AS transport, updated_at AS updatedAt
      FROM connection_profiles ORDER BY updated_at DESC, account_id ASC`,
      )
      .all();
    const known = new Set(rows.map((row) => row.accountId));
    const deleted = new Set(
      this.database
        .prepare('SELECT account_id AS accountId FROM deleted_connection_profiles')
        .all()
        .map((row) => row.accountId),
    );
    const legacy = this.database
      .prepare(
        `SELECT account_id AS accountId, endpoint_host AS host,
      endpoint_port AS port, transport, created_at AS updatedAt FROM accounts ORDER BY created_at DESC, account_id ASC`,
      )
      .all();
    return rows
      .map((row) => this.profileFromRow(row))
      .concat(
        legacy
          .filter((row) => !known.has(row.accountId) && !deleted.has(row.accountId))
          .map((row) => this.legacyProfile(row)),
      );
  }

  deleteConnectionProfile(accountId) {
    this.database.prepare('DELETE FROM connection_profiles WHERE account_id = ?').run(accountId);
    this.database
      .prepare(
        'INSERT INTO deleted_connection_profiles(account_id, deleted_at) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET deleted_at=excluded.deleted_at',
      )
      .run(accountId, new Date().toISOString());
  }

  profileFromRow(row) {
    return {
      accountId: row.accountId,
      domain: row.domain,
      mode: row.mode,
      ...(row.mode === 'manual'
        ? { manualEndpoint: { host: row.host, port: row.port, transport: row.transport } }
        : {}),
      updatedAt: row.updatedAt,
    };
  }

  legacyProfile(row) {
    return {
      accountId: row.accountId,
      domain: row.accountId.includes('@')
        ? row.accountId.slice(row.accountId.lastIndexOf('@') + 1)
        : '',
      mode: 'manual',
      manualEndpoint: { host: row.host, port: row.port, transport: row.transport || 'starttls' },
      updatedAt: row.updatedAt,
    };
  }

  getTrustedCertificate(accountId, host, port, transport) {
    const row = this.database
      .prepare(
        `SELECT account_id AS accountId, endpoint_host AS host, endpoint_port AS port,
      transport, fingerprint_sha256 AS fingerprintSha256, certificate_pem AS certificatePem,
      identity_mismatch AS identityMismatchAuthorized, approved_at AS approvedAt
      FROM trusted_certificates WHERE account_id = ? AND endpoint_host = ? AND endpoint_port = ? AND transport = ?`,
      )
      .get(accountId, host, port, transport);
    return row
      ? { ...row, identityMismatchAuthorized: Boolean(row.identityMismatchAuthorized) }
      : null;
  }

  upsertTrustedCertificate(record) {
    this.database
      .prepare(
        `INSERT INTO trusted_certificates(account_id, endpoint_host, endpoint_port, transport, fingerprint_sha256, certificate_pem, identity_mismatch, approved_at)
      VALUES (@accountId, @host, @port, @transport, @fingerprintSha256, @certificatePem, @identityMismatchAuthorized, @approvedAt)
      ON CONFLICT(account_id, endpoint_host, endpoint_port, transport) DO UPDATE SET
        fingerprint_sha256=@fingerprintSha256, certificate_pem=@certificatePem,
        identity_mismatch=@identityMismatchAuthorized, approved_at=@approvedAt`,
      )
      .run({ ...record, identityMismatchAuthorized: record.identityMismatchAuthorized ? 1 : 0 });
  }
}

module.exports = { AccountConnectionStore };
