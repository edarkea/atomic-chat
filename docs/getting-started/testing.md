# Testing and validation

Use the smallest validation set that covers the changed layer, then expand it when the change crosses a process or contract boundary.

## Available commands

| Command                             | Scope                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `npm run typecheck`                 | Angular and TypeScript type checking.                                        |
| `npm run typecheck:electron`        | Electron-side type checking configured by the repository.                    |
| `npm run lint`                      | ESLint for `src/**/*.ts` and `src/**/*.html`.                                |
| `npm run format:check`              | Prettier check for the configured source set.                                |
| `npm run format:check:all`          | Prettier check including the broader repository set.                         |
| `npm run test:angular`              | Angular tests without watch mode or progress output.                         |
| `npm run test:node`                 | Node test suite in `tests/*.test.cjs`; includes environment-sensitive cases. |
| `npm run test:node:outgoing`        | Outgoing file-transfer tests.                                                |
| `npm run test:node:outgoing:safety` | Selected outgoing transfer robustness and lifecycle cases.                   |
| `npm run test:electron`             | Electron-oriented test command declared by the project.                      |
| `npm run build`                     | Production Angular build.                                                    |

## Recommended local order

For a Renderer-only change:

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run test:angular
npm run build
```

For Electron, IPC, persistence or XMPP changes, add `npm run typecheck:electron` and the focused Node/Electron tests that cover the affected path. Do not start an external XMPP validation without an authorized environment.

## Focused Angular tests

The current feature layout places conversation tests below `src/app/features/conversation`:

```powershell
npm run test:angular -- `
  --include src/app/features/conversation/message-composer.spec.ts `
  --include src/app/features/conversation/message-date-time.spec.ts
```

The legacy `test:ci:focused` script still references pre-packaging paths. Until that maintenance item is updated, use the explicit commands above or invoke the current test paths directly.

## Reporting results

Record each check as `PASS`, `FAIL`, `SKIP` or `BLOCKED`.

- `PASS` means the command completed successfully.
- `FAIL` means the command completed with an error or a failing assertion.
- `SKIP` means the check was intentionally not run.
- `BLOCKED` means the environment or an external dependency prevented execution.

Keep historical failures separate from results produced by the current change. Do not treat a skipped or blocked check as a pass.
