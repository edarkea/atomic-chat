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

Copy `.env.example` to `.env` and configure it locally:

```env
ATOMIC_XMPP_SERVICE=your-openfire-host
ATOMIC_XMPP_DOMAIN=your-xmpp-domain
ATOMIC_XMPP_PORT=5222
ATOMIC_XMPP_USERNAME=your-user
ATOMIC_XMPP_PASSWORD=your-password
ATOMIC_XMPP_ALLOW_INSECURE_TLS=false
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

- `ATOMIC_XMPP_ALLOW_INSECURE_TLS=true` may be required for the current self-signed Openfire certificate. This is an explicitly accepted risk and is not a secure production configuration.
- Migration failure/recovery testing and a complete automatic retry policy remain limited.
- Notification preference persistence exists; system notification behavior is not complete.
- Sounds, MUC rooms, file transfer, plugins and advanced XMPP extensions are outside the current implemented scope.
- Interoperability evidence is specific to the tested Openfire/Spark environment.

## Project structure

```text
electron/              Electron Main, IPC, persistence and XMPP adapter
src/app/               Angular UI and domain facade
src/app/core/          TypeScript contracts and ports
tests/                 P0 and interoperability validation tests
.env.example           Safe configuration template
```
