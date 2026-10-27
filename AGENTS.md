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

## Skills del repositorio
- Usar `.agents/skills/atomic-angular-development/SKILL.md` para desarrollar o refactorizar Angular/TypeScript y límites de Electron.
- Usar `.agents/skills/atomic-performance-optimization/SKILL.md` cuando la tarea solicite reducir bundle, disco, CPU o memoria, o antes de introducir dependencias pesadas.
- Optimizar **con mediciones antes/después**, conservando funcionalidad, seguridad, accesibilidad y mantenibilidad. Nunca afirmar mejoras sin medición autorizada.

## Entrega del agente
- En `IMPLEMENTACION_AUTORIZADA`, inspeccionar `package.json` y ejecutar únicamente validaciones adecuadas a la tarea y al entorno autorizado. Scripts actualmente declarados: `npm run build`, `npm run test:p0`, `npm test`; no inventar un script `lint`. Evitar pruebas que conecten a servidores o utilicen secretos reales sin permiso expreso.
- Entregar resumen de cambios, archivos modificados, pruebas realizadas/no realizadas, riesgos, compatibilidad de contratos y actualización de tareas.
- Puedes **hacer commit y push al finalizar la implementación autorizada**, en la rama de trabajo permitida, tras revisar el diff y sin incluir secretos; indicar SHA y rama reales. Si solo se pide auditoría o borrador, **no** hacer commit/push.
