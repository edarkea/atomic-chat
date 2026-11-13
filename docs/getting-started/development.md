# Development workflow

Atomic Chat is a desktop XMPP client with a strict runtime boundary:

```text
Angular Renderer → Restricted Preload API → Electron Main → XMPP / SQLite / secure storage
```

The Renderer owns presentation and user interaction. Preload exposes a constrained API. Electron Main owns privileged operations, persistence and the XMPP connection. Keep secrets, SQLite handles and sockets outside the Renderer.

## Repository map

| Area                        | Responsibility                                                                 |
| --------------------------- | ------------------------------------------------------------------------------ |
| `src/app/core/domain`       | Domain types, events and shared invariants.                                    |
| `src/app/core/ports`        | Explicit boundaries used by application services and adapters.                 |
| `src/app/core/facades`      | Renderer-facing orchestration and compatible public APIs.                      |
| `src/app/core/coordinators` | Cohesive coordination of session, history, workspace, scroll and unread flows. |
| `src/app/core/stores`       | Reactive state ownership for focused UI/application concerns.                  |
| `src/app/features`          | Feature components, templates and feature-local presentation logic.            |
| `electron/application`      | Main-process composition and application use cases.                            |
| `electron/ipc`              | IPC handlers and request validation at the process boundary.                   |
| `electron/persistence`      | SQLite-backed persistence and migrations.                                      |
| `electron/security`         | Secure storage and security-sensitive Main-process operations.                 |
| `electron/xmpp`             | XMPP transport, adapters and protocol-specific behavior.                       |
| `tests`                     | Node/Electron-facing characterization and integration tests.                   |

## Before changing code

1. Identify the layer that owns the behavior.
2. Read the related public types, signals, events and tests.
3. Check whether the change crosses the Preload boundary or changes an IPC contract.
4. Preserve account identity, conversation identity and session-generation checks.
5. Prefer a small, reversible change with a focused characterization test.
6. Run the validations appropriate to the touched layer and report their actual results.

## Renderer changes

Keep components focused on presentation. Put use-case coordination in facades or existing coordinators, and keep state in the store that already owns it. Avoid duplicate subscriptions, expensive template computations and direct access to Node.js or Electron internals.

When changing navigation, scroll or asynchronous callbacks, invalidate work tied to the previous account or conversation before accepting new work.

## Electron changes

Keep validation at the IPC boundary, preserve sender checks and maintain the existing security posture. Do not move credentials, SQLite access or XMPP sockets into Preload or Renderer code. Changes to persistence must preserve migrations, account isolation and recovery behavior.

## Standard validation

See [Testing and validation](testing.md) for the available commands. Do not report a build, test or performance result unless it was executed for the current change.
