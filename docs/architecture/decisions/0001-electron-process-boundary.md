# ADR-0001: Keep privileged operations in Electron Main

- Status: Accepted
- Scope: Renderer, Preload and Electron Main

## Context

Atomic Chat needs XMPP sockets, SQLite, filesystem operations, secure credential storage, notifications and update services. Angular components are also the most exposed part of the application because they render external and user-provided content.

## Decision

Keep the runtime boundary:

```text
Angular Renderer → Restricted Preload API → Electron Main → XMPP / persistence / OS services
```

Renderer code may use typed ports and domain contracts, but it must not access Node.js, SQLite, credentials, unrestricted filesystem paths or the XMPP socket. Preload exposes only named capabilities through `contextBridge`.

## Alternatives considered

- Exposing a generic IPC bridge to reduce boilerplate.
- Moving persistence or XMPP clients into the Renderer.
- Enabling Node.js integration for feature convenience.

These alternatives increase authority in the page and make sender validation, secret handling and lifecycle cleanup harder to reason about.

## Consequences

- New capabilities require coordinated domain, port, Preload and IPC changes.
- Main owns validation, privileged resources and cleanup.
- Renderer tests can use in-memory or unavailable ports without starting Electron.
- IPC and Preload contracts must be maintained as explicit public surfaces.

The current security settings are documented in the [security model](../../security/security-model.md).
