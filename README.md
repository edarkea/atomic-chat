# Atomic Chat

Atomic Chat is a desktop XMPP messaging client built with Angular and Electron. It is designed for Openfire and provides a modern, controlled alternative to Spark for individual messaging, presence and roster management.

## Current capabilities

- XMPP login against an Openfire server.
- Secure credential handling through Electron Main and operating-system secure storage.
- Connection status, disconnect and recovery state reporting.
- Local and remote presence: `available` and `unavailable`.
- Real Openfire roster loading and contact search.
- One-to-one messaging with Spark/Openfire users.
- Incoming/outgoing classification, JID normalization and duplicate prevention.
- Local SQLite history for sent and received messages.
- Chronological conversation loading after restarting the application.
- P1 preferences: Atomic theme, notification preference persistence and per-account automatic login.
- Restricted Main/Preload/Renderer IPC architecture.
- MUC V1 discovery, entry/exit, participant state and in-memory groupchat messages. Room entry remains blocked unless Electron Main has operator-controlled evidence that the account cannot create rooms.

## System description

```text
Angular Renderer
       │ restricted Preload API
       ▼
Electron Main
  ├── XMPP adapter (@xmpp/client)
  ├── SQLite persistence (better-sqlite3)
  └── Secure credential storage (safeStorage)
       │
       ▼
Openfire XMPP server
```

The Renderer does not access Node.js, SQLite, credentials or the XMPP socket directly. Electron Main validates IPC requests, controls persistence and owns the XMPP connection.

## Openfire configuration

Atomic Chat expects XMPP TCP access, normally on port `5222`, with authentication, roster, presence and individual messaging enabled.

`ATOMIC_XMPP_MUC_POLICY_JSON` is an operator-provided declaration that the account cannot create rooms; it is not an automatic verification of Openfire or another XMPP server.

Copy `.env.example` to `.env` and configure it locally:

```env
ATOMIC_XMPP_SERVICE=your-openfire-host
ATOMIC_XMPP_DOMAIN=your-xmpp-domain
ATOMIC_XMPP_PORT=5222
ATOMIC_XMPP_TRANSPORT=starttls
ATOMIC_XMPP_USERNAME=your-user
ATOMIC_XMPP_PASSWORD=your-password
ATOMIC_XMPP_ALLOW_INSECURE_TLS=false
# Optional operator-controlled JSON accreditation; do not provide this from the Renderer.
# ATOMIC_XMPP_MUC_POLICY_JSON=[{"accountId":"user@your-xmpp-domain","service":"conference.your-xmpp-domain","canCreate":false,"source":"operator","evidence":"approved Openfire policy record"}]
```

Never commit `.env` or real credentials. Passwords are handled by Electron Main and `safeStorage`, not stored as regular SQLite fields.

## Running the desktop application

From the repository root:

```powershell
cd apps/atomic-chat
npm install
npm run build
npm run electron
```

The Electron window opens with the login screen. If `autoLogin` is enabled, Atomic Chat attempts to connect using the stored secure credential.

## Angular development server

```powershell
cd apps/atomic-chat
npm start
```

The Angular server runs at `http://localhost:4200/`. The complete XMPP and secure-storage flow must be tested through Electron.

## Build and validation

```powershell
cd apps/atomic-chat
npm run build
npm run test:p0
```

P0 has been validated in the observed Openfire/Spark environment for connection, session behavior, presence, roster and individual messaging. P1 preferences and local history are implemented with documented reservations.

## Known limitations

- A self-signed certificate is never accepted automatically. Electron Main performs an unauthenticated probe (direct TLS or TCP/XMPP STARTTLS), shows the certificate details in Angular, and keeps the operational connection at `rejectUnauthorized: true`. Trust is scoped to the XMPP account, endpoint, selected transport and exact SHA-256 certificate.
- Set `ATOMIC_XMPP_TRANSPORT=starttls` for the usual port `5222`, or `direct-tls` for `xmpps:`/port `5223`. The legacy `ATOMIC_XMPP_TLS` boolean is adapted when no explicit transport is present: a host-only endpoint on port `5222` maps to STARTTLS, while port `5223` maps to direct TLS; explicit `transport` always wins. The selected transport is persisted and never shares trust with the other transport.
- Migration failure/recovery testing and a complete automatic retry policy remain limited.
- Notification preference persistence exists; system notification behavior is not complete.
- MUC V1 does not create/configure/moderate rooms, invite users, handle room passwords, private MUC messages, automatic rejoin/forwarding, files or persistent MUC history.
- Interoperability evidence is specific to the tested Openfire/Spark environment.

## Certificate trust implementation references

The implementation maps the audit plan areas as follows: A1.3 (TLS transport and certificate classification) is in `electron/certificate-trust.cjs` and `electron/xmpp-adapter.cjs`; B1 (restricted Main/Preload/Renderer IPC and explicit decisions) is in `electron/main.cjs`, `electron/preload.cjs`, `src/app/core/electron-api.ts`, and `src/app/core/chat.facade.ts`; D1 (persistent, endpoint/transport-scoped trust) is in `electron/storage.cjs` and the `trusted_certificates` table migration. The Angular warning is in `src/app/app.html` and uses the existing Wasteland Terminal styles.

## Project structure

```text
electron/              Electron Main, IPC, persistence and XMPP adapter
src/app/               Angular UI and domain facade
src/app/core/          TypeScript contracts and ports
tests/                 P0 and interoperability validation tests
.env.example           Safe configuration template
```
