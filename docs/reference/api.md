# API and contract reference

This is the navigation point for Renderer, Preload and Main-process contracts. The TypeScript interfaces and domain types remain the source of exact field-level truth; this page describes the public capability groups and the rules for changing them.

## Boundary

```text
Angular ports → window.atomicChat → electron/preload.cjs → Main IPC handlers → runtime services
```

The page receives a frozen, capability-oriented API. It does not receive `ipcRenderer`, Node.js objects, SQLite handles, XMPP sessions or secret values.

## Request and result conventions

- Cross-process requests use `version: 1` and a unique `requestId` where defined by the contract.
- Account-scoped operations carry `accountId`.
- Conversation operations carry `conversationId` or `roomJid` and preserve direct/MUC kind semantics.
- Results use `Result<T>` with either `{ ok: true, value, version, requestId }` or `{ ok: false, error, version }`.
- Errors use stable `AppErrorCode` values and a `retryable` flag.
- Asynchronous events use a versioned envelope with `eventId`, `type`, typed `payload` and optional `correlationId`.

## Capability groups

| Group                       | Scope                                                                  |
| --------------------------- | ---------------------------------------------------------------------- |
| `account`                   | Secrets, connect/disconnect and secret-storage recovery/reset actions. |
| `connectionProfiles`        | List, save and delete connection profiles.                             |
| `certificate`               | Apply an explicit certificate trust decision.                          |
| `session`                   | Read connection state.                                                 |
| `presence` and `roster`     | Set presence and list contacts.                                        |
| `messaging` and `chatState` | Send messages, reactions and typing state.                             |
| `muc`                       | Discover, join, leave, send room messages and reactions.               |
| `history`                   | List/search/page messages, timelines and conversation summaries.       |
| `media` and `fileHistory`   | List media and open/reveal persisted files.                            |
| `file` and `preview`        | Transfer actions and guarded image preview streams.                    |
| `stickers`                  | Sticker library, message, pack, draft and preview operations.          |
| `preferences`               | Read/update/reset preferences and select a download directory.         |
| `attention` and `broadcast` | Window attention and controlled broadcasts.                            |
| `updates`                   | Read, check, download and install packaged updates.                    |
| `externalLinks`             | Open an approved external link through Main.                           |
| `subscribe`                 | Receive validated `domain.event` messages and unsubscribe.             |

Exact methods and payloads are defined in:

- `src/app/core/ports/electron-api.ts`;
- `src/app/core/ports/ports.ts`;
- `src/app/core/domain/`;
- `electron/preload.cjs`;
- `electron/ipc/`.

## Contract change checklist

When changing a request, response or event:

1. Update the domain type and port interface.
2. Update the typed Preload API and the Main handler/use case.
3. Preserve sender validation, identity scope and error semantics.
4. Add or update characterization tests at both relevant sides of the boundary.
5. Update this reference and any affected domain/architecture documentation.
6. Run the available type, focused test, format, build and link checks.

Do not broaden a capability to avoid adding a precise contract.
