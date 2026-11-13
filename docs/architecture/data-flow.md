# Core data flows

This page describes the current high-level flows. It is intentionally focused on ownership and boundaries; detailed payload contracts belong in the reference documentation.

## Application startup

```text
Electron main.cjs
  → main-composition.startMainApplication()
  → app.whenReady()
  → createRuntime()
  → attach Main-process event sources
  → create BrowserWindow with preload.cjs
  → Angular bootstrapApplication(App, appConfig)
```

The runtime is composed before the main window is created. Preload then exposes `window.atomicChat`, and the Angular port providers select Electron-backed ports when the API is present.

## Renderer request

```text
Feature component
  → facade or coordinator
  → typed Renderer port
  → window.atomicChat capability
  → ipcRenderer.invoke(channel, request)
  → ipcMain handler and sender validation
  → Main-process use case/service
  → Result<T> returned to the Renderer
```

The request retains its contract version and identifiers where required. A feature must not skip its facade or coordinator to invoke an arbitrary IPC channel.

## Incoming XMPP event

```text
XMPP session
  → XmppAdapter event
  → Main event source processing
  → persistence/notification side effects when required
  → event router
  → BrowserWindow.webContents.send('domain.event', envelope)
  → Preload subscription
  → Renderer port/facade/coordinator
  → store and component state
```

The event envelope carries a version, event identifier, event type and typed payload. Events that are scoped to a sender or transfer are routed to the appropriate WebContents rather than broadcast indiscriminately.

## Message persistence and presentation

Incoming message handling is coordinated in Main. The message is classified and persisted before the resulting domain event is forwarded to the Renderer. Renderer coordinators correlate the event with the active account and conversation, update the appropriate stores and allow the conversation view to render the timeline.

Late events must be rejected or ignored when their account, conversation or session generation no longer matches active state. This prevents a previous connection from updating a newly selected workspace.

## File and preview flow

```text
Renderer file input
  → Preload derives a guarded source request
  → Main validates sender and transfer request
  → file transfer coordinator / grants / media persistence
  → transfer or media domain event
  → Renderer updates transfer state or requests a preview operation
```

Preview grants and sender cleanup are owned by Main. Closing or destroying a window must release sender-scoped grants and listeners.

## Shutdown

```text
application lifecycle
  → dispose background mode and stop update service
  → disconnect active XMPP accounts
  → await runtime reconciliation
  → close persistence
```

Shutdown code must remain bounded and idempotent. New asynchronous resources should have an explicit cleanup path before they are added to the composition root.
