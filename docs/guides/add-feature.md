# Add or change a feature

Use this guide when a change affects Angular presentation, a Renderer use case or an existing Electron capability. Keep the change inside the smallest existing boundary that owns the behavior.

## 1. Locate the owner

Start by mapping the behavior:

| Question                              | Inspect first                                                      |
| ------------------------------------- | ------------------------------------------------------------------ |
| Is it presentation or interaction?    | `src/app/features/` and its component tests.                       |
| Is it shared Renderer state?          | `src/app/core/stores/`.                                            |
| Is it a multi-step UI flow?           | `src/app/core/coordinators/`.                                      |
| Is it a Renderer use case?            | `src/app/core/facades/`.                                           |
| Does it need Main-process capability? | `src/app/core/ports/`, `electron/preload.cjs` and `electron/ipc/`. |
| Does it persist data or use XMPP?     | `electron/persistence/` or `electron/xmpp/`.                       |

Read the related domain types and characterization tests before editing. Preserve existing public signals, methods and contracts unless the task explicitly changes them.

## 2. Keep the dependency direction

```text
Component → facade/coordinator → port/domain contract → Preload → IPC → Main service
```

- Components should render state and delegate actions.
- Facades and coordinators should own orchestration, identity checks and asynchronous invalidation.
- Stores should remain the owner of their state; do not mirror a store in a facade.
- Renderer code must not import Node.js, Electron, SQLite or secret-storage modules.
- Main-process code must not depend on Angular components or Renderer-only state.

## 3. Preserve identity and lifecycle

For account or conversation behavior, carry the relevant `accountId`, conversation kind and bare JID through every async operation. Capture the current session generation before awaiting Main or XMPP work, then reject obsolete results before mutating state.

When changing navigation, history or scroll behavior, invalidate pending work for the previous account/conversation. Make timer, animation-frame, event-listener and subscription cleanup explicit.

## 4. Add characterization before changing behavior

Prefer a test that describes the existing behavior before refactoring. Include the relevant edge case:

- account or conversation switching;
- disconnect and reconnect;
- late event or stale async result;
- direct versus MUC identity;
- unread/focus behavior;
- reply, reaction or search navigation;
- component destruction during pending work.

Keep tests close to the owner: component tests for presentation, coordinator/facade tests for orchestration, and Node/Electron tests for Main-process behavior.

## 5. Validate the change

Run the focused test first, then the checks required by the touched layer. The standard Renderer sequence is documented in [Testing and validation](../getting-started/testing.md). Add `npm run typecheck:electron` and the affected Node/Electron tests when a process boundary or Main-process module changes.

Report commands that were actually run and distinguish `PASS`, `FAIL`, `SKIP` and `BLOCKED`.

## Definition of done

- The behavior has a clear owner.
- Public signals, methods and contracts remain compatible.
- Account, conversation and session-generation checks are preserved.
- Obsolete async work cannot mutate current state.
- Focused characterization tests cover the modified behavior.
- Appropriate validation has been executed and recorded.
- Documentation is updated when a boundary or contract changes.
