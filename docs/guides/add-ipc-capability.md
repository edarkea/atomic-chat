# Add an IPC capability

Use this guide when the Renderer needs a capability that is not already exposed by the existing Preload API. IPC additions are contract changes and must be implemented end to end.

## Required path

```text
Domain type
  → Renderer port
  → Electron port adapter
  → Preload allow-list
  → Main IPC handler/use case
  → runtime service or platform adapter
```

Do not expose `ipcRenderer`, a generic `invoke(channel, payload)` function or privileged service objects to the page.

## Implementation sequence

1. Define or reuse the request, result, error and event types in `src/app/core/domain/`.
2. Add the narrow capability to the relevant interface in `src/app/core/ports/ports.ts` and the typed `AtomicChatApi` surface in `src/app/core/ports/electron-api.ts`.
3. Implement the Renderer adapter in the corresponding `electron-application.ports.ts` or `electron-xmpp.port.ts` module.
4. Expose one named method in the appropriate frozen group in `electron/preload.cjs`.
5. Register the Main handler in the matching `electron/ipc/ipc-*-handlers.cjs` module. Add the module to `ipc-use-case-registry.cjs` only when it is a new use-case group.
6. Validate the sender and request at the Main boundary using the existing helpers and security policy.
7. Call the runtime service or platform adapter without moving privileged state into Preload.
8. Return the established `Result<T>` shape and stable error codes.
9. Add focused tests for the contract, sender rejection, invalid input and the successful path.

## Contract checklist

- Use `version: 1` and a unique `requestId` for cross-process requests where the surrounding contract requires them.
- Scope account, conversation, file, preview and sticker operations to the identity in the request.
- Preserve `Result<T>` success/error semantics.
- Preserve correlation identifiers on asynchronous events.
- Validate URLs, paths, sizes, IDs and enum values at the boundary.
- Do not return secret values, raw database handles, XMPP clients or unrestricted filesystem paths.
- Use sender-scoped grants for sensitive history, file and preview operations.

## Testing the boundary

At minimum, cover:

1. A valid request reaches the intended use case.
2. A request from an unauthorized or destroyed sender is rejected.
3. Invalid input returns the expected stable error code.
4. Account/conversation identity is preserved.
5. A late result cannot update an invalidated account or session.
6. The Renderer adapter consumes the same response and event shape exposed by Preload.

Run `npm run typecheck`, `npm run typecheck:electron`, the focused Node/Electron tests, `npm run lint` where Renderer TypeScript changes, and the production build as appropriate.
