# System context and trust boundaries

## Context diagram

```text
┌──────────────────────────────┐
│ User                         │
└──────────────┬───────────────┘
               │ UI events and rendered state
┌──────────────▼───────────────┐
│ Angular Renderer             │
│ features, facades, stores    │
└──────────────┬───────────────┘
               │ typed calls and domain-event subscription
┌──────────────▼───────────────┐
│ Restricted Preload API       │
│ contextBridge allow-list     │
└──────────────┬───────────────┘
               │ validated IPC
┌──────────────▼───────────────┐
│ Electron Main                │
│ IPC, application, platform   │
└───────┬───────────┬──────────┘
        │           │
        │           ├──────────────────────┐
        │           │                      │
┌───────▼──────┐ ┌──▼────────────────┐ ┌──▼────────────────────┐
│ XMPP/Openfire│ │ Local persistence │ │ OS services            │
│ sessions     │ │ SQLite/media      │ │ secure storage, files, │
│ and protocol │ │ and migrations    │ │ notifications, updates │
└──────────────┘ └───────────────────┘ └────────────────────────┘
```

## Trust boundaries

### Renderer boundary

Renderer code is treated as unprivileged UI code. It may hold presentation state and user-entered values, but it must not receive secret-storage handles, SQLite connections, XMPP clients or unrestricted filesystem APIs.

### Preload boundary

Preload is the only exposed bridge between the page and Electron capabilities. Its API is explicit and frozen. Every new operation should have a named capability, a request contract and a result contract.

### IPC boundary

Main-process IPC handlers verify the sender and route requests through the registered use-case surface. Sender-specific grants are used for sensitive file, preview and history operations. Errors are converted into the established result/error contracts instead of leaking internal objects.

### External-service boundary

XMPP transport is configured in Main and is subject to the existing transport and TLS policy. Credentials are handled through Main-process secret services. Do not copy credentials into Renderer state, logs, tests or documentation.

## External systems

| System                          | Integration owner                          | Notes                                                                               |
| ------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| XMPP/Openfire                   | `electron/xmpp/`                           | Authentication, sessions, roster, messages, presence, MUC and protocol extensions.  |
| SQLite/local data               | `electron/persistence/`                    | History, accounts, preferences, media metadata, stickers and migrations.            |
| Operating-system secure storage | `electron/security/secrets.cjs`            | Credential protection through Electron `safeStorage` and the application data path. |
| Filesystem                      | `electron/files/` and `electron/stickers/` | Guarded transfer, preview, download and sticker operations.                         |
| Windows/Linux desktop           | `electron/platform/` and `electron/tray/`  | Window lifecycle, notifications, background mode, tray and update behavior.         |
| GitHub Releases                 | `electron/platform/update-service.cjs`     | Public release checks and user-controlled update actions.                           |

## Change impact guide

- UI-only changes usually stay in `src/app/features/` and their focused tests.
- Renderer behavior changes normally involve a facade, coordinator, store or port test.
- New privileged behavior requires coordinated changes across Preload, IPC and the relevant Main-process service.
- Persistence changes require migration, account-isolation and recovery characterization.
- XMPP changes require session-generation, account identity and late-event characterization.

When the change crosses a boundary, document the contract and validate both sides of that boundary.
