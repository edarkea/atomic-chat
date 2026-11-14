# Juegos — referencia técnica

Esta carpeta reúne la documentación técnica vigente del sistema de juegos de Atomic
Chat. La implementación mantiene la separación `Angular Renderer → Preload → Electron
Main → XMPP/SQLite` y limita el catálogo actual a juegos oficiales para conversaciones
directas.

## Documentos

- [Arquitectura del sistema](architecture.md): componentes, responsabilidades, estados
  y flujos de sesión.
- [API de reglas y extensibilidad](plugin-api.md): contratos de reglas, snapshots,
  eventos y aislamiento del host.
- [Protocolo XMPP](xmpp-protocol.md): namespace, eventos, validación, deduplicación y
  reconexión.
- [Formato de paquetes](package-format.md): diseño técnico del formato `.atomicgame`,
  validación y límites de extracción.
- [Modelo de seguridad](security.md): fronteras de confianza, permisos y límites
  operativos.

## Fuentes de verdad

- Los contratos Renderer, Preload y Main se mantienen en
  [`docs/reference/api.md`](../reference/api.md) y en `src/app/core/`.
- La arquitectura general de Electron se mantiene en
  [`docs/architecture/`](../architecture/).
- Las invariantes del dominio se mantienen en
  [`docs/domain/invariants.md`](../domain/invariants.md).

## Alcance actual

Tic-Tac-Toe y Reversi están integrados como juegos oficiales de dos participantes. El
Renderer presenta DTO y snapshots confirmados; Main conserva la autoridad sobre
identidad, reglas, persistencia, transporte, límites y ciclo de vida. Los juegos
externos y la instalación de paquetes permanecen descritos como interfaces técnicas,
pero no forman parte del catálogo oficial actual.
