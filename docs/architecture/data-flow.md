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

## On-demand XEP-0054 profile flow

```text
Direct conversation selection
  → ChatFacade / UserProfileCoordinator
  → UserProfilePort
  → window.atomicChat.userProfiles.get
  → userProfiles IPC handler + sender/account validation
  → XmppAdapter user-profile service
  → existing vCard IQ helper in xmpp-display-name.cjs
  → bounded UserProfile Result<T>
  → coordinator checks account/session generation
  → conversation header fallback: roster alias → vCard display name → JID
```

Profile reads are not roster synchronization. A vCard photo is validated and retained in Main behind a short-lived opaque reference; optional stream reads use bounded ArrayBuffer chunks and are cleared on session or window cleanup.

After a successful XEP-0054 read, Main stores the bounded profile fields and validated local PNG/JPEG bytes in `userData/profile-data`. Entries are account/JID scoped, content-addressed and quota limited; they remain across application sessions. After the roster is published at login, the facade restores stored contact profiles with a four-operation local-read limit; a `stored` read never sends another vCard IQ. The store is also consulted before a remote profile read, but its bytes remain Main-only and are rewrapped in a new sender-scoped image reference for every response. The Renderer shares one bounded object-URL cache per account/reference and coalesces concurrent stream reads, so the same avatar is not transferred repeatedly while it is visible. Avatar components defer stream reads until they enter the viewport (with a small preload margin), and account changes revoke cached URLs and pending image operations. XEP-0153 photo hashes invalidate a changed entry and emit `profile.avatarChanged`; the active coordinator then performs one fresh read. The roster alias remains independent from stored vCard fields.

## Own profile update flow

```text
Profile editor in the session UI
  → ChatFacade
  → UserProfilePort.update
  → window.atomicChat.userProfiles.update
  → userProfiles IPC handler + sender/account/JID validation
  → XmppAdapter user-profile service
  → existing vCard IQ helpers in xmpp-display-name.cjs
  → bounded text-only IQ set for the authenticated account
  → refreshed UserProfile Result<T>
```

The editor updates only the authenticated account. Contact profiles are displayed on demand and remain read-only. Roster aliases are never overwritten by remote `FN` or `NICKNAME` values.

## Own avatar publication flow

```text
Avatar tab in the own-profile editor
  → ChatFacade.updateOwnUserAvatar / clearOwnUserAvatar
  → UserProfilePort
  → native Main-process image picker (update only)
  → userProfiles.avatar IPC handler + sender/account validation
  → XmppAdapter user-profile service
  → existing vCard IQ helpers in xmpp-display-name.cjs
  → XEP-0054 PHOTO/TYPE/BINVAL or PHOTO removal
  → UserProfile image reference + guarded ArrayBuffer stream
```

The picker result remains in Main. Main validates size, dimensions and MIME type, while the Renderer receives only the refreshed `UserProfile` and an expiring opaque image reference.

XEP-0153 presence hashes are used only as cache invalidation metadata. The implementation does not publish or subscribe to XEP-0084 PEP metadata/data.

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
