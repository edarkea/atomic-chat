# Security model

Atomic Chat treats the Angular page as unprivileged UI code. Privileged operations stay in Electron Main and are exposed through explicit, validated capabilities.

## Process protections

The main window is created with:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true`;
- a dedicated Preload script.

`electron/preload.cjs` exposes a frozen `atomicChat` allow-list through `contextBridge`. It does not expose `ipcRenderer`, Node.js or a generic channel bridge.

## IPC sender validation

Main-process handlers use the sender guard to require:

1. a live BrowserWindow associated with the sender;
2. the sender's main frame;
3. the expected packaged `index.html` URL or directory URL, or the explicitly configured development URL.

Sensitive operations such as history, file actions and previews also use sender-scoped grants. Window destruction clears sender-specific grants and local actions.

When adding an IPC capability, preserve this validation path. Do not weaken it to accept arbitrary frames, origins or WebContents instances.

## XMPP and TLS

XMPP transport validation requires a valid host, port, TLS flag and supported transport (`starttls` or `direct-tls`). The validated configuration enables certificate verification and rejects insecure TLS opt-in in packaged builds.

Certificate handling:

- checks validity dates, server identity, chain authorization and signature algorithms;
- rejects expired, not-yet-valid and insecure certificates;
- presents an explicit trust decision for supported self-signed or identity-mismatch cases;
- binds remembered trust to account, host, port, transport and certificate fingerprint;
- verifies the expected fingerprint again during the secure connection.

Never bypass TLS verification to make a connection test pass. Use a certificate decision only when the endpoint and fingerprint have been verified through an authorized channel.

## Secret handling

Secrets are handled by `electron/security/secrets.cjs` through Electron `safeStorage`.

- Persistent values are encrypted before being written to `secrets.json`.
- Writes are atomic and use restrictive file permissions where supported.
- `secrets.json.bak` provides the explicit recovery source for a valid primary failure.
- `remember: false` keeps the value in session memory and removes a previous persistent value.
- Secrets are never returned through the public profile DTO or stored in normal SQLite records.

Do not log, commit, paste or attach `.env`, `secrets.json`, `secrets.json.bak`, certificate PEM data or real credentials.

## Files, media and previews

File paths and preview streams are Main-process concerns. Preload derives guarded file input metadata and Main validates sender, account, transfer identity, size and grant state. Preview and sticker grants are short-lived and account-scoped.

XEP-0054 profile reads follow the same boundary. Main validates the sender, account, bare JID and connected session; it applies a timeout, bounded concurrency and session-generation freshness check. vCard photos are decoded and size/dimension checked in Main; the actual PNG/JPEG bytes are authoritative when a server's `PHOTO/TYPE` metadata is stale or uses a common alias. The result is exposed only as a short-lived opaque reference with bounded ArrayBuffer streams. Profile results never contain photo Base64 or arbitrary external URLs.

Main may persist the bounded profile DTO fields and validated avatar bytes in `userData/profile-data`, never in Renderer storage or normal SQLite records. The profile store uses account/JID-derived keys, content-addressed files, restrictive permissions, entry/byte quotas and integrity checks on rehydration. It does not expire data by time: XEP-0153 SHA-1 photo hashes are the invalidation signal, and a mismatch removes the stored entry before the visible profile is reloaded. XEP-0084 is outside this capability.

Own-profile updates apply the same sender and account checks, require a bare account JID and serialize concurrent writes per account. Text updates accept only bounded textual fields. Avatar updates use a native Main-process picker, validate PNG/JPEG bytes and dimensions before publication, and publish only XEP-0054 `PHOTO/TYPE/BINVAL`; no renderer-supplied path, Base64, external URL or unbounded image payload is accepted. Contact profile data is never writable through this API.

Do not add a Renderer-side filesystem fallback or return an unrestricted local path to the page.

## MUC authorization

The client does not treat contact-group membership as room membership. Optional operator MUC policies are bound to the exact account, service and endpoint. Room creation remains outside the supported client behavior.

## Security review checklist

- Is the operation reachable only through a named Preload capability?
- Is the request validated at the Main boundary?
- Is the sender and main frame authorized?
- Are account, conversation and session-generation identities preserved?
- Could an error or log expose a secret, path, token or certificate PEM?
- Are TLS verification and certificate identity checks still enabled?
- Are grants, listeners and timers released on window/session destruction?
- Are security-sensitive tests included in the affected validation?
