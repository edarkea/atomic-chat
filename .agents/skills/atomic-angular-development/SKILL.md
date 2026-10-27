---
name: atomic-angular-development
description: Desarrollar o refactorizar funcionalidades autorizadas de Atomic Chat con Angular, TypeScript estricto, código limpio, SOLID y contratos IPC/XMPP existentes. Usar al implementar UI, fachadas, servicios, DTO o integración entre Renderer, Preload y Electron Main; no usar para auditorías de solo lectura.
---

# Desarrollo Angular y TypeScript — Atomic Chat

## Entrada obligatoria
1. Leer `AGENTS.md`, el ID y los criterios de aceptación de la tarea aprobada y los archivos implicados.
2. Inspeccionar `package.json`, `tsconfig.json`, `angular.json` y contratos en `src/app/core/`. No dar por hechos los requisitos que no estén en esas fuentes o en la tarea.
3. Identificar el flujo **UI → fachada/puerto → API Preload → Main → XMPP/SQLite** y quién es propietario de cada estado/dato.

## Reglas de implementación (solo con autorización)
- Escribir TypeScript estricto para código nuevo de Angular y contratos. Evitar `any`, casts inseguros, `!` injustificado y promesas sin manejo de errores. Modelar los errores con los `Result<T>`/`AppError` existentes cuando aplique.
- Aplicar **SRP** por componente/servicio; **OCP** con extensión justificada, no herencia innecesaria; **LSP** al conservar contratos; **ISP** mediante puertos pequeños; **DIP** entre lógica y adaptadores. Preferir composición y cambios mínimos.
- Preservar el contrato actual de `src/app/core/domain.ts`, `ports.ts` y `electron-api.ts`: nombres, estados, correlación, `requestId`, `clientMessageId`, versión y semántica de errores. No alterarlos silenciosamente.
- Validar estructura, autorización y origen de toda solicitud IPC en Electron Main; Preload solo expone métodos explícitos. El renderer no importa módulos `node:*`, Electron, SQLite ni clientes XMPP.
- Separar UI, lógica de negocio y acceso externo. Componentes Angular pequeños; utilizar `inject`, `signal` y `computed` cuando simplifiquen; `ChangeDetectionStrategy.OnPush` cuando proceda; `@for (...; track ...)` con identidad estable para colecciones. Cancelar suscripciones/tareas al destruir el contexto.
- No ejecutar efectos en getters computados, no filtrar listas extensas en cada pasada de plantilla si se puede derivar con `computed`, no duplicar estado sin necesidad.
- Conservar invariantes de mensajería: JID normalizado, identificación/deduplicación de mensajes, estados, errores y persistencia según contratos existentes. No afirmar interoperabilidad XMPP no demostrada.
- Seguridad: preservar aislamiento del contexto, TLS seguro, secretos en Main y contenido remoto tratado como no confiable. Temas por tokens CSS sin lógica de mensajes.
- Respetar el código Electron `.cjs` existente; **no migrarlo a TypeScript** sin una tarea específica y estrategia de compilación aprobada.
- No agregar bibliotecas, frameworks de estado, patrones o capas nuevos sin necesidad demostrada y aprobación conforme al roadmap.

## Flujo y salida
1. Diseñar el cambio mínimo y enumerar archivos/contratos afectados.
2. Implementar una unidad coherente, con casos normales, límites y fallos; actualizar pruebas existentes o proponerlas si la tarea lo permite.
3. En implementación autorizada, validar con los scripts existentes adecuados al alcance. `npm run build` comprueba el bundle; `npm run test:p0` o `npm test` solo si su entorno/datos y posibles efectos están autorizados. No afirmar pruebas no ejecutadas.
4. Revisar formato, complejidad y compatibilidad de API; indicar regresiones potenciales.
5. Reportar ID de tarea, archivos, contratos afectados, resultado real de validaciones y pendientes. Commit/push únicamente al terminar la implementación autorizada y con permiso vigente.

## Criterio de listo
La solución cubre únicamente el alcance, mantiene límites de confianza y contratos, es legible y testeable, maneja errores y evita dependencias o abstracciones superfluas. Si falta evidencia o aprobación, dejar la parte incierta explícitamente bloqueada.
