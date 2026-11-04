# Login credential diagnostics

## Scope and evidence

AC-C1-LOGIN-01 was investigated with synthetic credentials only. The test password starts with U+0022 and contains U+00B7; no real account or password was used and no XMPP server was contacted.

The value is assigned by the Angular login state, passed unchanged through the restricted Preload API, stored by `SecretStore` either in the session map or encrypted persistent storage, recovered in Electron Main, and passed as the password argument to `@xmpp/client`. The focused test verifies the same IPC path for remembered and temporary credentials.

The installed PLAIN SASL mechanism builds the UTF-8 payload as `authzid\0authcid\0password`, then the SASL layer encodes it for transport. The synthetic quote and middle dot therefore are data, not XML syntax. The installed SCRAM implementation also consumes the password as a string for its cryptographic operations. The exact server-negotiated mechanism and server-side password preparation could not be observed without a real XMPP server.

SASL specifications define preparation requirements for mechanisms and deployments; PLAIN documents UTF-8 credentials and recommends SASLprep, while SASLprep specifies its own mapping and normalization rules. Atomic Chat does not apply a client-side Unicode transformation speculatively. The server and the selected mechanism must be validated together before introducing one, because changing the password would change the credential presented to the server.

References: [RFC 4616](https://datatracker.ietf.org/doc/html/rfc4616), [RFC 4013](https://datatracker.ietf.org/doc/html/rfc4013), and [RFC 5802](https://datatracker.ietf.org/doc/html/rfc5802).

## Corrections

- XMPP authentication conditions now use the typed `condition` property. A condition such as `not-authorized` remains `AUTH_FAILED` even when the server appends explanatory text.
- Secure-storage failures return `STORAGE_FAILED` instead of being allowed to fall into the generic XMPP connection message.
- Unknown connection failures are reported as controlled `INTERNAL` errors rather than being asserted to be transport failures.
- Connection diagnostics log only transport metadata and a bounded diagnostic code. Arbitrary error messages, passwords, SASL material, and password hashes are not logged.

TLS validation, certificate decisions, IPC sender authorization, and the existing credential reference contract were not relaxed or changed.

## Validation limits

The focused tests cover U+0022/U+00B7 preservation, temporary and remembered storage, PLAIN payload construction, SASL-condition classification, unexpected-error classification, and secure-storage failure handling. Real-server authentication, Openfire behavior, and Windows packaging were not executed for this diagnosis.
