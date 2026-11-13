# Environment variables

The safe template is [.env.example](../../.env.example). Copy it to `.env` for local development and keep real values out of Git.

| Variable                         | Required                        | Purpose                                                            | Safe guidance                                                     |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `ATOMIC_XMPP_SERVICE`            | For connection flows            | XMPP service host or endpoint.                                     | Use an authorized test endpoint.                                  |
| `ATOMIC_XMPP_DOMAIN`             | For connection flows            | XMPP authentication/addressing domain.                             | Keep it consistent with the endpoint certificate and account.     |
| `ATOMIC_XMPP_PORT`               | For connection flows            | XMPP port.                                                         | Use the server's authorized StartTLS or direct-TLS port.          |
| `ATOMIC_XMPP_TRANSPORT`          | Recommended                     | `starttls` or `direct-tls`.                                        | Prefer explicit transport over legacy inference.                  |
| `ATOMIC_XMPP_TLS`                | Legacy compatibility            | Legacy TLS flag when transport is not explicitly set.              | Do not use it to disable verification.                            |
| `ATOMIC_XMPP_USERNAME`           | Optional legacy/default profile | Test account username used by local compatibility paths.           | Never commit a real account identifier with its secret.           |
| `ATOMIC_XMPP_PASSWORD`           | Optional legacy/default profile | Local password input for compatibility paths.                      | Use a disposable authorized account and never log or commit it.   |
| `ATOMIC_XMPP_ALLOW_INSECURE_TLS` | Optional                        | Explicit insecure-TLS request.                                     | Keep `false`; packaged validation rejects it.                     |
| `ATOMIC_XMPP_MUC_POLICY_JSON`    | Optional                        | Operator-provided exact MUC policy entries.                        | Use only evidence-backed policy data from an authorized operator. |
| `ATOMIC_CHAT_DEV_SERVER`         | Optional                        | Explicit Angular development URL accepted by the IPC sender guard. | Use a local development origin only.                              |

## Precedence and validation

Preload derives the endpoint configuration from the environment and supports explicit transport. Main validates host, port, domain, TLS and transport before creating the XMPP connection. Packaged builds require secure TLS policy.

The optional MUC policy is parsed and filtered in Main. A configured policy must match the exact account, service and endpoint; it does not enable room creation.

## Handling rules

- `.env` is ignored by Git and must remain local.
- Do not put secrets, certificate PEM values or private endpoints in documentation, issue reports or CI logs.
- Environment changes that affect a public contract or security policy require updates to this page, `.env.example`, relevant tests and security documentation.
