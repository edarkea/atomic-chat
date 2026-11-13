# Contributing to Atomic Chat

Thank you for improving Atomic Chat. Keep changes focused, preserve the Renderer/Main security boundary and make the behavior verifiable.

## Before changing code

1. Read [the development workflow](docs/getting-started/development.md) and the relevant architecture/domain documentation.
2. Identify the owner of the behavior and the contracts it crosses.
3. Inspect related tests and preserve account, conversation and session-generation identity.
4. Check whether the change requires an architecture, domain, contract or configuration documentation update.

## Documentation update matrix

| Change                                                   | Update                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Architecture, layering, ownership or lifecycle           | The relevant `docs/architecture/` page and ADR.                                                      |
| Renderer/Preload/IPC request, response or event contract | `docs/reference/api.md`.                                                                             |
| Domain rule, invariant, state or identity behavior       | `docs/domain/invariants.md`; update `docs/domain/business-rules.md` when explanatory detail changes. |
| Environment variable or runtime configuration            | `docs/reference/environment-variables.md` and `.env.example` when applicable.                        |
| Security or recovery behavior                            | The relevant `docs/security/` or `docs/operations/` page.                                            |
| User-visible command or validation workflow              | README or the relevant getting-started/guide page.                                                   |

Documentation must describe the current repository. Do not report a test, build, benchmark or manual validation result unless it was executed for the current change.

## Development and validation

Use commands declared in `package.json`:

```powershell
npm ci
npm run typecheck
npm run typecheck:electron
npm run lint
npm run format:check:all
npm run test:angular
npm run test:node
npm run build
npm run docs:links
```

Select the smallest relevant set and expand it when a change crosses a process or contract boundary. Report omitted or unavailable checks explicitly. Do not use real credentials or unauthorized XMPP servers.

## Security and compatibility

- Keep `contextIsolation`, sandboxing, `nodeIntegration: false`, TLS verification and sender validation enabled.
- Do not place credentials, tokens, certificate material, databases or private endpoints in Git, logs or documentation.
- Do not modify public contracts, migrations or security controls to satisfy an obsolete fixture without verifying production behavior.
- Preserve compatibility for existing accounts and data unless a migration and recovery plan has been approved.

## Definition of done

- The change is limited to the requested scope.
- Focused tests cover changed behavior and boundary cases.
- Relevant type, lint, format, build and link checks were run.
- Documentation and ADRs are updated when required by the matrix above.
- The final report lists actual results, skipped checks and remaining risks.
