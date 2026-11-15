# Seguridad, confianza y rendimiento

## 1. Modelo de confianza

```text
Usuario
  ↓
Renderer Angular confiable pero no privilegiado
  ↓  API explícita
Preload confiable y mínimo
  ↓  IPC validado
Electron Main confiable: identidad, XMPP, SQLite, instalación y límites
  ├─ servidor/peer XMPP: externo, no confiable
  └─ paquete externo: código no confiable, aunque el usuario lo haya elegido
```

La elección local de un archivo no lo convierte en código de confianza. Los juegos oficiales son código mantenido por el proyecto; los externos deben tratarse como contenido activo hostil.

## 2. Amenazas y mitigaciones

| Amenaza                          | Mitigación propuesta                                                                                                                      | Estado                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Paquete manipulado               | SHA-256 del archivo, staging atómico, validación de manifest; firma opcional para autenticidad.                                           | `PROPUESTA_DE_DISEÑO`                           |
| Path traversal/symlink           | Extraer solo bajo directorio temporal validado; rechazar rutas absolutas, `..`, symlinks y tipos no permitidos.                           | `PROPUESTA_DE_DISEÑO`                           |
| Código externo accede a Node/IPC | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, contexto separado, sin `atomicChat` ni `ipcRenderer`.                | `PROPUESTA_DE_DISEÑO` / `PENDIENTE_VALIDACION`  |
| Navegación o popup externo       | CSP estricta, `will-navigate`/popup rechazados, origen único del paquete y sin enlaces externos por defecto.                              | `PROPUESTA_DE_DISEÑO`                           |
| XSS en host                      | Renderizar texto como texto, no insertar HTML de manifest/peer; no interpolar contenido del juego en plantillas Angular sin sanitización. | `PROPUESTA_DE_DISEÑO`                           |
| IPC genérico                     | Canales explícitos `games.*`, schemas por operación y sender guard existente.                                                             | `PROPUESTA_DE_DISEÑO`                           |
| Lectura de secretos              | No entregar credenciales, perfiles, tokens, paths, `accountId` real innecesario ni objetos Main al runtime externo.                       | `PROPUESTA_DE_DISEÑO`                           |
| Suplantación de peer             | Validar `from`, bare JID, cuenta, conversación, sesión, versión y generación; no confiar en display name.                                 | `PROPUESTA_DE_DISEÑO`                           |
| Movimiento fraudulento           | Validar actor, turno, `actorSeq`, snapshot/hash y reglas; Main calcula el resultado y no acepta solo lo que declara el peer o el plugin.  | `PROPUESTA_DE_DISEÑO`                           |
| Replay/duplicado                 | `eventId` único, caché bounded y persistencia de secuencia aceptada por sesión.                                                           | `PROPUESTA_DE_DISEÑO`                           |
| Mensaje alterado                 | Hash canónico del snapshot y verificación commit-reveal con codificación length-prefixed para Cara o Cruz.                                | `PROPUESTA_DE_DISEÑO`                           |
| DoS por eventos                  | Límite de bytes, tasa por cuenta/sesión/peer, número de sesiones, IQ timeout y backpressure.                                              | `PENDIENTE_VALIDACION`                          |
| DoS por plugin                   | Watchdog, cuota de mensajes/timers/estado y destrucción del contexto externo en exceso.                                                   | `PENDIENTE_VALIDACION`                          |
| Fuga de memoria                  | Disposer explícito, `AbortController`/timers bounded, destrucción de view y limpieza por cuenta/ventana.                                  | `PROPUESTA_DE_DISEÑO`                           |
| Evento obsoleto                  | `accountId` + `sessionGeneration` + `sessionId` en Main y Renderer; ignorar callbacks tardíos.                                            | `DOCUMENTADO_EN_FUENTE` / `PROPUESTA_DE_DISEÑO` |
| SQLite expuesto                  | Solo Main accede a stores; tablas con FK e índices por cuenta; payloads validados y cuotas.                                               | `PROPUESTA_DE_DISEÑO`                           |

## 3. Aislamiento externo compatible con el diseño actual

### Opción A — `WebContentsView`/ventana renderer sandboxada

Recomendada para código externo si el spike la confirma en la versión Electron del proyecto.

- contexto renderer separado y destruible;
- `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true`;
- sesión/partition dedicada y sin cookies de la aplicación;
- preload inexistente o mínimo, con un bridge explícito de mensajes;
- navegación, ventanas, descargas, permisos y protocolos interceptados y rechazados por defecto;
- comunicación host↔juego mediante `MessagePort`/mensajes estructurados, nunca IPC genérico.

Coste: más memoria y tiempo de creación por vista; mayor complejidad de ciclo de vida. El paquete sigue estando dentro de la superficie de Chromium/Electron, por lo que no se debe afirmar aislamiento absoluto.

### Opción B — iframe `sandbox="allow-scripts"`

Puede reducir memoria y reutilizar el Renderer, pero el código no confiable comparte proceso con Angular. Debe usar origen opaco, CSP, sin `allow-same-origin`, sin `allow-top-navigation`, sin formularios/popups y con `postMessage` validado por `source` y schema.

Coste/riesgo: un plugin que consuma CPU o bloquee el proceso puede afectar a todo el cliente. Solo sería aceptable si las mediciones y el modelo de amenaza autorizan ese compromiso. No es sustituto de un proceso separado para un nivel de riesgo alto.

### Validación del aislamiento

En Electron `45.2.2`, el fixture local confirmó en ambos modos `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`, ausencia de `window.atomicChat`,
Node y `process` en el juego, bridge explícito únicamente, rechazo de token inválido,
popup, navegación/red/permisos y destrucción observada. `WebContentsView` fue la
opción preferida para el diseño por disponer de un `WebContents` separado y
destruible; esto no equivale a aislamiento absoluto ni habilita por sí solo el runtime
externo de producción.

### Opciones rechazadas

- `eval`, `new Function`, `node:vm`: no constituyen una frontera de seguridad para código hostil.
- Worker con Node: otorga capacidades incompatibles con el requisito de no acceso a Node/filesystem/secretos.
- Cargar scripts del paquete en el documento Angular: mezcla confianza, CSP, DOM y ciclo de vida.
- Exponer `ipcRenderer`, un `invoke(channel, payload)` o la API completa `atomicChat`: viola [`ADR-0001`](../architecture/decisions/0001-electron-process-boundary.md).

## 4. Autorización y datos mínimos

El host debe pasar solo:

- `sessionId` opaco y un alias de jugador no sensible;
- metadatos públicos del juego;
- snapshot de juego validado y eventos necesarios;
- capacidades de sesión estrechas: `submitMove`, `requestResync`, `close`.

El runtime no debe recibir:

- contraseña, secret reference, certificado o token;
- JID completo si no es imprescindible;
- rutas locales, `userData`, paths de instalación o archivos de otras partidas;
- acceso a historial general, stickers, preferencias, links o actualizaciones;
- selector de canal IPC, socket, URL XMPP o cliente XMPP.

## 5. Límites operativos

Los límites deben ser configurables en Main y medirse antes de fijar valores:

- tamaño máximo de `.atomicgame` y de cada archivo;
- número máximo de archivos y bytes extraídos;
- tamaño de manifest, snapshot y movimiento;
- mensajes por segundo y IQ concurrentes por sesión/cuenta;
- sesiones activas por cuenta y por peer;
- timers y callbacks activos por runtime;
- tiempo de carga, tiempo de respuesta de `submitMove` y tiempo de inactividad;
- retención máxima de eventos antes de compactar a snapshot.

Main implementa cuotas de sesiones por cuenta/peer, invitaciones
pendientes, eventos por ventana, ACKs, solicitudes de estado y deduplicación. Se
configuran con `ATOMIC_GAMES_*`; un payload del Renderer no puede modificarlas. La
retención es conservadora: no hay compaction automática ni borrado de eventos/snapshots
aceptados, porque el protocolo actual no ofrece replay incremental seguro.

Si no se puede garantizar un límite en el contexto elegido, se debe desactivar la instalación externa en esa plataforma, no quitar la sandbox.

## 6. Medición posterior

La medición instrumental del fixture no es un benchmark de producto ni una prueba de
carga. Para comparar oficiales, iframe y vista separada
se debe seguir midiendo:

1. memoria privada y RSS del proceso antes/después de abrir una partida;
2. CPU en reposo y durante eventos/animación;
3. tiempo desde `invite` hasta primer render y desde reconexión hasta resync;
4. bytes instalados, bytes extraídos y tamaño del release;
5. número de listeners/timers/contextos antes y después de cerrar partida, cambiar cuenta y destruir ventana;
6. comportamiento con dos, cinco y el máximo autorizado de partidas concurrentes.

Registrar hardware, sistema operativo, versión Electron, configuración, muestra, warm/cold start y si el resultado es `PASS`, `FAIL`, `SKIP` o `BLOCKED`. No declarar mejora sin comparación antes/después reproducible.

## 7. Revisión de seguridad antes de activar externos

- threat model revisado;
- paquete malicioso de prueba bloqueado;
- navegación y popup bloqueados;
- IPC, XMPP, SQLite, filesystem y secretos inaccesibles;
- sender/frame y cuenta validados;
- replay, spoofing, eventos tardíos y cambios de cuenta cubiertos;
- límites de recursos demostrados;
- cleanup verificado con instrumentación;
- firma/autenticidad o advertencia explícita de que el hash no autentica al autor;
- validación de interoperabilidad completada en entorno autorizado.
