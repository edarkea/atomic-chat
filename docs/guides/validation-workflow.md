# Validation workflow for changes

Validation should match the risk and boundary of the change. Start focused, then expand to the process or contract level.

## Renderer-only change

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run test:angular
npm run build
```

Use a focused Angular test command first when the affected spec is known. See [Testing and validation](../getting-started/testing.md) for the current file layout.

## Electron, IPC or persistence change

Add the following to the Renderer checks when applicable:

```powershell
npm run typecheck:electron
npm run test:node
npm run test:electron
npm run format:check:all
git diff --check
```

`test:node` includes environment-sensitive cases. Run focused files or scripts when the full Node suite is not appropriate for the change. Do not connect to an external XMPP service without an authorized environment.

## Reporting

For every command, record the exact command and one of:

- `PASS` — completed successfully.
- `FAIL` — completed with an error or failing assertion.
- `SKIP` — intentionally not run.
- `BLOCKED` — prevented by a missing capability or external dependency.

Keep historical failures separate from current regressions. A build or test result from an earlier commit is not evidence for the current change. Performance claims require before/after measurements and are outside this workflow unless explicitly requested.
