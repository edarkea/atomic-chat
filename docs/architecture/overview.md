# Architecture overview

Atomic Chat is an Electron desktop application with an Angular Renderer and an XMPP/Main-process backend. The runtime is organized around a restricted process boundary:

```text
Angular Renderer → Preload API → Electron Main → XMPP / persistence / operating-system services
```

The boundary is a security and ownership rule, not only a visual diagram. Renderer code must not access Node.js, SQLite, credentials, filesystem paths or the XMPP socket directly.

## Runtime layers

### Angular Renderer

The Renderer is bootstrapped from `src/main.ts` with `src/app/app.config.ts`.

- `src/app/features/` contains feature components, templates and presentation behavior.
- `src/app/core/facades/` provides Renderer-facing use-case orchestration.
- `src/app/core/coordinators/` handles cohesive flows such as session, history, workspace, scroll, roster/conversation and unread coordination.
- `src/app/core/stores/` owns reactive state for focused application concerns.
- `src/app/core/domain/` defines shared types, events, errors and domain payloads.
- `src/app/core/ports/` defines the Renderer-side boundaries used by facades and coordinators.

The port providers select Electron-backed implementations when `window.atomicChat` is available and fall back to in-memory or unavailable implementations where appropriate. This keeps components and most application logic independent from the browser runtime.

### Preload

`electron/preload.cjs` exposes the frozen `atomicChat` object through `contextBridge`.

- Requests are forwarded through `ipcRenderer.invoke`.
- The exposed API is grouped by capability: account, session, messaging, history, files, media, preferences, stickers, MUC and updates.
- Domain events are delivered through a subscription to `domain.event`.
- Update subscriptions and domain-event subscriptions return an unsubscribe function.
- File inputs are converted into guarded Main-process requests; the Renderer does not receive unrestricted filesystem access.

Preload is an allow-list boundary. New capabilities should be added as explicit typed operations, not by exposing `ipcRenderer`, Node.js or a generic IPC bridge.

### Electron Main

`electron/main.cjs` delegates startup to `electron/composition/main-composition.cjs`. The composition root wires together platform services, runtime dependencies, event sources and IPC handlers.

- `electron/application/` composes runtime behavior, event routing, history use cases and incoming-message processing.
- `electron/ipc/` registers handlers, validates senders and routes requests to use cases and runtime services.
- `electron/persistence/` owns SQLite-backed storage, migrations and account-aware persistence stores.
- `electron/security/` contains sender/security policy, certificate trust and secure-secret handling.
- `electron/xmpp/` owns transport, sessions, roster/messaging, MUC, reactions, stickers and XMPP file-transfer integration.
- `electron/files/` owns file transfers, previews, local actions, grants and media/file history.
- `electron/stickers/` owns sticker catalogs, packs, messages, grants and storage providers.
- `electron/platform/` owns the window, lifecycle, notifications, tray/background mode and update service.

`electron/application/runtime.cjs` creates the persistence, media, history, sticker, secret and XMPP services. Runtime reconciliation is started as part of this composition and its result is retained for shutdown coordination.

## Dependency direction

The intended dependency direction is:

```text
Features → facades/coordinators → ports/domain
                         ↓
                 Preload-backed adapters

Electron composition → application / IPC / platform / persistence / XMPP adapters
```

Practical rules:

1. Features should consume facades, coordinators and stores rather than calling Preload directly.
2. Renderer ports describe capabilities; Electron-backed adapters implement those ports.
3. IPC handlers validate the sender and request shape before invoking Main-process behavior.
4. Main-process services own privileged resources and return contract-shaped results.
5. Domain events cross the process boundary as versioned, typed event envelopes.
6. Persistence and XMPP implementations must not be moved into the Renderer to simplify a feature.

## Composition and lifecycle

When Electron becomes ready, the composition root initializes the runtime, attaches Main-process event sources, creates the main window and starts update handling. On shutdown it disposes background mode, stops updates, disconnects active XMPP sessions with bounded cleanup, waits for runtime reconciliation and closes persistence.

The composition root may contain wiring and lifecycle coordination. Feature behavior belongs in the specialized services, coordinators and stores it wires together.

The reasoning behind these boundaries is recorded in the [architecture decisions](decisions/README.md).
