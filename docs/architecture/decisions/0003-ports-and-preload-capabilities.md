# ADR-0003: Use explicit ports and a restricted Preload API

- Status: Accepted
- Scope: Angular core, Preload and Main-process IPC

## Context

Renderer use cases need messaging, history, files, MUC, preferences, stickers, updates and attention. Direct dependency on the Electron global would couple components to a desktop runtime and make isolated tests difficult.

## Decision

Define capability interfaces in `src/app/core/ports/ports.ts`, expose the typed page contract in `src/app/core/ports/electron-api.ts`, and implement Electron adapters that call named Preload methods. `port-providers.ts` selects Electron-backed, in-memory or unavailable implementations based on runtime availability.

Preload keeps a frozen, capability-oriented object. Main registers handler groups through `ipc-use-case-registry.cjs`, validates the sender and returns the established `Result<T>` contract.

## Alternatives considered

- Injecting `window` into every component.
- Calling `ipcRenderer.invoke` from feature code.
- Creating one generic service with untyped channel names and payloads.

These options spread process-boundary knowledge through the UI and reduce the compiler's ability to detect contract drift.

## Consequences

- A capability change has an explicit implementation path and focused tests.
- The Renderer can run with in-memory or unavailable ports.
- IPC names, request versions and error codes remain visible at the boundary.
- Official games use the same least-privilege path: `GamesPort` → named Preload
  methods → account/session-scoped Main handlers; confirmed snapshots are presentation
  data and never move rule authority into Renderer.
- There is some adapter boilerplate, accepted as the cost of least privilege and testability.

The implementation procedure is described in [Add an IPC capability](../../guides/add-ipc-capability.md).
