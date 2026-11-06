# Perfil, segundo plano y actualización desde la versión

Implementación autorizada del 6 de noviembre de 2026.

## Tareas implementadas

- [x] Mostrar el nombre completo del usuario conectado: se consulta su vCard XMPP (`FN`, nombre/apellido o nickname). Si no existe un nombre distinto del identificador, se presenta el usuario sin dominio, separando puntos, guiones y guiones bajos e iniciando cada palabra en mayúscula (`juan.munoz` → `Juan Munoz`). Es una alternativa visual; no reconstruye apellidos ni tildes ausentes. El nombre real del perfil siempre tiene prioridad. La consulta tiene un límite de cinco segundos y no bloquea el inicio de sesión. El JID de autenticación y mensajería permanece intacto.
- [x] Preferencias → General → **Mantener en segundo plano al cerrar**. Es una opción global persistida, desactivada inicialmente. Activada, cerrar oculta la ventana y mantiene la sesión. Desactivada, cerrar sale de la aplicación. Si no se puede crear la bandeja, cerrar sale para evitar un proceso inaccesible.
- [x] Clic derecho en la bandeja: abrir, cambiar estado y salir completamente. Menú Wasteland Terminal con temas claro, oscuro y personalizado; teclado, Escape y cierre al perder el foco. El clic izquierdo abre el chat. El estado se publica por el adaptador XMPP y se refleja en Angular.
- [x] Punto rojo para mensajes directos, de salas en vivo, stickers entrantes y ofertas de archivo recibidos con la ventana oculta. Los mensajes de texto se deduplican y se excluyen los propios y el histórico MUC. Funciona aunque las notificaciones del sistema estén desactivadas. Se limpia al volver a enfocar el chat.
- [x] Versión y control de actualización compartido entre login y chat. Sin una versión nueva no aparece botón. Con actualización disponible permite descargar; muestra progreso y después **Reiniciar y actualizar**. Los errores permiten reintentar. Las comprobaciones periódicas respetan una descarga en curso o lista para instalar; las transferencias activas bloquean la instalación sin perder la descarga.

## Archivos y compatibilidad

- `electron/background-mode.cjs`, `tray-preload.cjs` y `tray-menu.{html,css,js}`: bandeja y menú aislado; integración en `main.cjs`, `app-lifecycle.cjs`, `ipc-preference-handlers.cjs`, `ipc-helpers.cjs` y `message-notifications.cjs`.
- `electron/xmpp-display-name.cjs` y `xmpp-session.cjs`: nombre del perfil, sin acceso XMPP desde Angular.
- `src/app/version-update.component.ts`, login, shell y preferencias: presentación de los controles. `core/update.facade.ts` y `electron/update-service.cjs`: errores y conservación del estado de descarga.
- `core/domain.ts`, `core/domain-event.validation.ts`, `core/chat.facade.ts` y `operator-presence.component.*`: nombre opcional y compatibilidad con eventos existentes.

Contrato público v1 conservado. Se añaden `ConnectionState.displayName?` y `Preferences.closeToTray?`; la ausencia de la preferencia equivale a `false`. No se cambia el esquema de SQLite ni se añaden dependencias. El menú tiene su propio preload, sin API general del chat; Main comprueba ventana, frame principal, URL local y acciones permitidas en `tray.getState`/`tray.action`.

## Validación y pendientes

- Corrección del cierre: `main-window.cjs` captura el ID del renderer antes de destruir la ventana y ejecuta la limpieza una sola vez. Evita `TypeError: Object has been destroyed`. Validada con 24 pruebas de ventana, bandeja y módulos IPC, y con la integración Electron usando la ventana real de producción sobre `about:blank`. No requiere cambios de contratos ni recompilar Angular.
- Menú de bandeja compacto: se eliminó el encabezado visible y el menú solo muestra `Abrir aplicación` y `Salir completamente`. El clic izquierdo sobre el icono abre directamente la aplicación.

- Build y comprobación TypeScript ejecutados. El build advierte que el bundle inicial supera el presupuesto de aviso de 500 kB.
- Pruebas Node específicas de bandeja, vCard, preferencias, notificaciones, actualizaciones y módulos IPC: 50 aprobadas, con dobles locales y sin servidores.
- Pruebas Angular enfocadas en controles nuevos, fachada de chat y validación de eventos: 29 aprobadas.
- Integración con Electron real (`tests/background-mode.integration.cjs`): preload aislado, ausencia de Node/API general, acción de presencia, dimensiones del menú, tema claro, indicador y cierre a bandeja aprobados. Usa ventanas ocultas y una bandeja simulada; no abre la aplicación con `.env`.
- Suite Angular completa: 120 aprobadas y 42 fallidas antes de agregar las cuatro pruebas nuevas. Los mismos 42 fallos se reprodujeron en un worktree del commit base `2c83eca`, en `app.spec.ts` y `presentation.components.spec.ts`. No se alteraron esos tests ajenos al alcance.
- Pendiente de validación manual: bandeja nativa y foco en cada sistema operativo, nombre vCard contra el servidor real e instalación de una release empaquetada. No se conectó a servidores ni se descargó o instaló una actualización real. La disponibilidad de bandeja depende del escritorio, especialmente en Linux.

Comandos locales específicos (sin cargar `.env`):

```powershell
node --test tests/background-mode.test.cjs tests/xmpp-display-name.test.cjs tests/theme-preferences.test.cjs tests/update-service.test.cjs tests/message-notifications.test.cjs
npm run test:angular -- --include src/app/version-update.component.spec.ts --include src/app/core/domain-event.validation.spec.ts --include src/app/core/chat.facade.spec.ts
node -e "delete process.env.ELECTRON_RUN_AS_NODE; const child = require('node:child_process').spawnSync(require('electron'), ['tests/background-mode.integration.cjs'], { stdio: 'inherit', env: process.env }); process.exit(child.status ?? 1)"
```
