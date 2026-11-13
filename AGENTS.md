# AGENTS.md — Atomic Chat

## Alcance y fuentes de verdad

- Proyecto: cliente XMPP de escritorio con Angular, TypeScript y Electron. Repositorio: `edarkea/atomic-chat`.
- **Dos modos distintos**: `AUDITORIA` = únicamente lectura estática y redacción documental; `IMPLEMENTACION_AUTORIZADA` = editar y validar únicamente el alcance aprobado. Nunca atribuir resultados de pruebas al modo auditoría.

## Diseño y calidad

- Mantener la separación: **Angular Renderer → Preload de API restringida → Electron Main → XMPP/persistencia**. El renderer no accede directamente a Node.js, SQLite, secretos ni al socket XMPP.
- Respetar las interfaces, DTO, versiones, estados y errores de `src/app/core/`;
- TypeScript `strict`; preferir tipos explícitos en límites, uniones discriminadas, `readonly` cuando proceda y funciones de responsabilidad única. No usar `any` ni silencios de errores para ocultar contratos rotos.
- Aplicar SOLID con pragmatismo: responsabilidades pequeñas, dependencias a través de interfaces donde aporten valor, no abstracciones ceremoniales. Priorizar claridad, cohesión y pruebas del comportamiento modificado.
- Angular: componentes enfocados en presentación, servicios/fachadas para casos de uso, inyección de dependencias, `signals`/`computed` para estado local y limpieza de suscripciones. Evitar cálculos costosos en plantillas y estado duplicado.
- Mantener seguridad por defecto: TLS verificado, mínimo privilegio IPC, no secretos en renderer/SQLite/logs, saneamiento de contenido externo. No desactivar controles para optimizar.
- Conservar la identidad visual original **Wasteland Terminal**. No mezclar presentación con reglas XMPP.

## Mapa actual del repositorio

- Angular Renderer: `src/app/`, organizado por `core/` y `features/`, con coordinadores y fachadas de aplicación donde corresponde.
- Electron Main: `electron/main.cjs`, con composición en `electron/composition/`, casos de uso y adaptadores en `electron/application/`, límites IPC en `electron/ipc/`, persistencia en `electron/persistence/`, seguridad en `electron/security/`, plataforma en `electron/platform/`, XMPP en `electron/xmpp/`, archivos en `electron/files/`, stickers en `electron/stickers/` y bandeja en `electron/tray/`.
- Preload: `electron/preload.cjs`; debe continuar exponiendo únicamente capacidades explícitas y mínimas.
- Pruebas: `src/**/*.spec.ts` para Angular y `tests/**/*.test.cjs` para Node/Electron.
- Los módulos de Electron permanecen en CommonJS (`.cjs`). No migrarlos a TypeScript como parte de una tarea ordinaria.

## Flujo de trabajo y Git

- Trabajar en la rama autorizada por la tarea. `dev` no se modifica directamente durante refactors salvo autorización explícita.
- Antes de modificar, revisar `git status`, la rama actual, `package.json` y el diff existente. No descartar cambios preexistentes.
- Un merge de una rama de refactor a `dev` puede hacerse con `git merge --squash` cuando se quiera conservar el resultado sin trasladar su historial de commits. Revisar el diff y ejecutar las validaciones antes del commit.
- Commit y push solo cuando el usuario los solicite o la tarea los autorice expresamente. Informar siempre la rama y el SHA reales.

## Pruebas y comandos vigentes

- Usar los nombres actuales de scripts: `test:node`, `test:node:outgoing`, `test:node:outgoing:safety`, `test:angular`, `test:ci:focused`, `test:electron`, `typecheck`, `typecheck:electron`, `lint`, `format:check:all`, `docs:links` y `build`.
- No reintroducir los nombres históricos `test:p0` ni selectores opacos `cal01`/`C5-OUT-*` en nuevos documentos o scripts.
- `npm run test:node` puede terminar con skips legítimos cuando el entorno Windows no permite symlinks o cuando una prueba XMPP requiere infraestructura autorizada. Reportar `SKIP` o `BLOCKED`; nunca presentarlos como `PASS`.
- Para cambios de formato histórico, usar Prettier sobre el alcance declarado y verificar después `format:check:all`, `git diff --check` y las pruebas afectadas. El formateo no autoriza cambios semánticos.
- No ejecutar servidores XMPP, cuentas reales, credenciales ni pruebas de interoperabilidad fuera del entorno autorizado.

## Skills del repositorio

- Usar `.agents/skills/atomic-angular-development/SKILL.md` para desarrollar o refactorizar Angular/TypeScript y límites de Electron.
- Usar `.agents/skills/atomic-performance-optimization/SKILL.md` cuando la tarea solicite reducir bundle, disco, CPU o memoria, o antes de introducir dependencias pesadas.
- Optimizar **con mediciones antes/después**, conservando funcionalidad, seguridad, accesibilidad y mantenibilidad. Nunca afirmar mejoras sin medición autorizada.

## Documentación y mantenimiento

- Keep the shared documentation current when implementation changes:
  - architecture changes update the corresponding document in `docs/architecture/` and the relevant ADR in `docs/architecture/decisions/`;
  - contract changes update `docs/reference/api.md`;
  - business-rule changes update `docs/domain/invariants.md` and, when useful, `docs/domain/business-rules.md`;
  - configuration changes update `docs/reference/environment-variables.md` and the safe `.env.example` template when required.
- Do not claim tests, builds, measurements or manual checks that were not executed for the current change. Mark checks as `PASS`, `FAIL`, `SKIP` or `BLOCKED`.
- Guides must use commands that exist in `package.json`. If a repeatable check is needed, add and validate the script before documenting it.
- Run `npm run docs:links` when Markdown links or documentation structure changes.

## Entrega del agente

- En `IMPLEMENTACION_AUTORIZADA`, inspeccionar `package.json` y ejecutar únicamente validaciones adecuadas a la tarea y al entorno autorizado. Scripts disponibles incluyen `npm run build`, `npm run test:node`, `npm run test:angular`, `npm run typecheck`, `npm run typecheck:electron`, `npm run lint`, `npm run format:check`, `npm run format:check:all` y `npm run docs:links`; no inventar comandos. Evitar pruebas que conecten a servidores o utilicen secretos reales sin permiso expreso.
- Entregar resumen de cambios, archivos modificados, pruebas realizadas/no realizadas, riesgos, compatibilidad de contratos y actualización de tareas.
- Puedes **hacer commit y push al finalizar la implementación autorizada**, en la rama de trabajo permitida, tras revisar el diff y sin incluir secretos; indicar SHA y rama reales. Si solo se pide auditoría o borrador, **no** hacer commit/push.
