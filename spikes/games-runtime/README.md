# Game Runtime isolation spike

Experimento local y no productivo para Electron `45.2.2`.

El spike compara:

- `view`: un `WebContentsView` con `sandbox`, `contextIsolation`, `nodeIntegration: false`, preload mínimo y partition de sesión no persistente;
- `iframe`: un `iframe sandbox="allow-scripts"` con origen opaco dentro de una ventana host.

El contenido es local e inocuo. No implementa juegos, XMPP, IPC de producción, persistencia ni instalación de paquetes.

## Ejecución

Desde la raíz del repositorio:

```powershell
node node_modules/electron/cli.js spikes/games-runtime/main.cjs --mode=view --json
node node_modules/electron/cli.js spikes/games-runtime/main.cjs --mode=iframe --json
```

El proceso imprime un JSON con capacidades observadas, mensajes aceptados/rechazados, métricas de `app.getAppMetrics()` y limitaciones del entorno. El comando no debe ejecutarse con cuentas reales ni mientras exista una sesión XMPP que deba conservarse.

## Seguridad del experimento

- La ventana host usa un preload local que expone únicamente `spikeHost.notify`, un listener de ACK y un sentinel `atomicChat` no funcional para comprobar aislamiento.
- El contenido de juego no recibe `window.atomicChat`, Node.js ni un bridge IPC genérico.
- Los mensajes requieren un token efímero y un `kind` permitido; el Main valida el `sender` del host o del `WebContentsView`.
- La session del spike bloquea `http`, `https`, `ws` y `wss`, descargas, popups y permisos.
- El runtime se destruye automáticamente después del handshake y las comprobaciones de abuso.

Los archivos están fuera de `package.json > build.files`, por lo que no forman parte del empaquetado normal.

