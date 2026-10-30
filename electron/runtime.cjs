function loadMucPolicies(environment = process.env) {
  try {
    const parsed = JSON.parse(environment.ATOMIC_XMPP_MUC_POLICY_JSON || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (policy) =>
            policy &&
            typeof policy.accountId === 'string' &&
            typeof policy.service === 'string' &&
            policy.canCreate === false &&
            policy.source === 'operator' &&
            typeof policy.evidence === 'string' &&
            policy.evidence.trim() &&
            policy.endpoint &&
            typeof policy.endpoint.host === 'string' &&
            policy.endpoint.host.trim() &&
            Number.isInteger(policy.endpoint.port) &&
            ['starttls', 'direct-tls'].includes(policy.endpoint.transport),
        )
      : [];
  } catch {
    return [];
  }
}

function createRuntime({
  app,
  safeStorage,
  PersistenceStore,
  SecretStore,
  XmppAdapter,
  MediaStore,
  FileHistoryStore,
  nativeImage,
  fileTransfers,
  outgoingFileTransfers,
  shell,
  environment = process.env,
}) {
  const persistence = new PersistenceStore(app.getPath('userData'));
  const media = new MediaStore(app.getPath('userData'), persistence, nativeImage);
  const fileHistory = new FileHistoryStore(persistence, shell);
  void media.reconcile();
  const secrets = new SecretStore(safeStorage, app.getPath('userData'));
  const xmpp = new XmppAdapter(
    app.isPackaged,
    persistence,
    loadMucPolicies(environment),
    fileTransfers,
    outgoingFileTransfers,
  );
  return { persistence, media, fileHistory, secrets, xmpp };
}

module.exports = { createRuntime, loadMucPolicies };
