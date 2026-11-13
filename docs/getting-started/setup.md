# Set up a local development environment

This guide prepares a local Atomic Chat checkout for development and a controlled smoke test.

## Prerequisites

- Git.
- Node.js compatible with the project toolchain.
- npm `11.19.0`, as declared by `package.json`.
- A test XMPP/Openfire account when connection flows must be exercised.

Do not use production credentials for local development. Electron Main owns credentials and persistence; the Angular Renderer must not receive secrets directly.

## Install dependencies

From the repository root:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env` with a disposable, authorized test account. The file is local configuration and must not be committed.

## Configuration

| Variable                         | Purpose                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `ATOMIC_XMPP_SERVICE`            | XMPP service host or endpoint.                                                  |
| `ATOMIC_XMPP_DOMAIN`             | XMPP domain used for authentication and addressing.                             |
| `ATOMIC_XMPP_PORT`               | XMPP connection port.                                                           |
| `ATOMIC_XMPP_TRANSPORT`          | Transport mode selected by the XMPP adapter.                                    |
| `ATOMIC_XMPP_TLS`                | TLS configuration for the connection.                                           |
| `ATOMIC_XMPP_USERNAME`           | Local test account username.                                                    |
| `ATOMIC_XMPP_PASSWORD`           | Local test account password.                                                    |
| `ATOMIC_XMPP_ALLOW_INSECURE_TLS` | Explicit opt-in for an insecure test configuration; keep it `false` by default. |
| `ATOMIC_XMPP_MUC_POLICY_JSON`    | Optional policy configuration for controlled MUC access.                        |

Use the values required by the authorized test environment. Do not disable TLS verification to bypass a certificate or server problem.

## Build and launch

```powershell
npm run build
npm run electron
```

`npm run electron` starts Electron with the local environment. Use `npm run build` first when the Renderer output is not current.

## First smoke check

With an authorized test account:

1. Start the application.
2. Confirm that the login flow reports the expected connection state.
3. Open a direct conversation and verify that the roster and presence load.
4. Send and receive a test message only in the authorized environment.
5. Close the application and confirm that no test credentials are copied into logs or source files.

If the account or server is unavailable, record the validation as blocked rather than substituting credentials or a public server.
