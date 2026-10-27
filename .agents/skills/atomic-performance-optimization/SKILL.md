---
name: atomic-performance-optimization
description: Auditar y optimizar tamaño de build/instalación, memoria, CPU e IPC de Atomic Chat sin sacrificar funciones, seguridad ni contratos. Usar cuando se solicite ligereza, rendimiento o reducción de dependencias en Angular/Electron, y antes de añadir código pesado; no ejecutar mediciones en auditoría estática.
---

# Optimización de recursos — Atomic Chat

## Principio
**Medir → localizar causa → proponer cambio mínimo → validar → comparar.** Menos líneas no garantizan menos bytes ni menos RAM. No aceptar regresiones de seguridad, accesibilidad, interoperabilidad o legibilidad para ganar tamaño.

## Alcance y modo
1. Leer `AGENTS.md`, tarea aprobada y contratos relevantes. En auditoría v0.2 solo identificar costos **potenciales en código** y diseñar mediciones futuras; nunca ejecutar comandos ni presentar cifras observadas.
2. En implementación autorizada, registrar entorno reproducible (rama/SHA, SO, arquitectura, modo de build, número de cuentas y fixture sintético). Tomar una línea base antes de tocar código.
3. Distinguir métricas: **bundle inicial Angular**, assets y CSS, tamaño de distribución Electron, instalación en disco, RSS/heap en reposo y bajo carga, CPU, eventos y volumen de IPC. No equiparar bundle web con instalador ni heap JS con memoria total.

## Presupuestos observados en el repositorio
- `angular.json` declara producción: bundle inicial **warning 500 kB / error 1 MB** y estilos individuales **warning 10 kB / error 12 kB**. Tratarlos como controles existentes, no como consumo observado.
- No imponer presupuestos de RAM ni tamaño de instalador sin mediciones iniciales y aprobación. No subir límites para silenciar regresiones.

## Orden de optimización preferente
1. **Dependencias y empaquetado:** auditar imports y paquetes realmente usados; evitar dependencias redundantes o de alto costo; conservar `package-lock.json` coherente; no incluir mapas, tests, secretos ni recursos innecesarios en distribuciones. No retirar una dependencia sin analizar usos, licencias y efectos.
2. **Angular:** lazy loading donde exista división real de rutas/funciones; imports precisos; listas con `track` estable; estados derivados con `computed`; evitar cálculos de plantilla, copias masivas y renderizados repetidos; diferir interfaces pesadas cuando sea correcto.
3. **Memoria y eventos:** liberar listeners de IPC/XMPP, suscripciones, temporizadores, recursos y referencias obsoletas; acotar historiales y listas en memoria; implementar paginación/ventaneo solo si la tarea y el contrato lo permiten. Vigilar duplicación Main ↔ Renderer.
4. **IPC y persistencia:** reducir payloads y serializaciones innecesarias, agrupar con criterio, evitar consultas/escrituras redundantes e índices sin justificación. Conservar orden, idempotencia, estados y errores.
5. **Assets/estilo:** comprimir imágenes originales del proyecto, reducir fuentes y variantes, reutilizar tokens CSS. Revisar dependencias de fuentes externas; no introducir nuevas cargas bloqueantes.
6. **Electron:** no multiplicar ventanas, workers o procesos innecesarios; evaluar startup y módulos cargados, sin desactivar `sandbox`, `contextIsolation`, validación TLS ni controles de origen.

## Validación (solo implementación autorizada)
- Comparar antes/después bajo el **mismo entorno y carga sintética**, con repeticiones cuando las medidas sean variables; indicar herramienta/metodología y variabilidad.
- Ejecutar únicamente los scripts y perfiles aprobados. Inspeccionar efectos externos antes de correr tests de interoperabilidad.
- Verificar que contratos `Result<T>`, IPC, historial, mensajes y manejo de errores permanezcan compatibles; registrar resultados reales y pruebas no ejecutadas.
- Si no existe instrumentación o empaquetado en el repositorio, **proponer** cómo medir; no inventar herramientas, scripts ni porcentajes de ahorro.

## Entrega obligatoria
Reportar: ID de tarea; hipótesis y evidencia; métrica/entorno; valor anterior y posterior (o `NO_MEDIDO`); cambio exacto; impacto funcional/seguridad; pruebas; riesgos y decisión de mantener o revertir. Commit/push solo para implementación autorizada, nunca para auditoría.
