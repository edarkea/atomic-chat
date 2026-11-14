# Arquitectura del sistema de juegos

## 1. Principios

1. Mantener `Angular Renderer → Preload restringido → Electron Main → XMPP / SQLite`.
2. Hacer que el Renderer presente estado; Main sea dueño de identidad, transporte, persistencia, límites y ciclo de vida.
3. Compartir un contrato, no una implementación privilegiada.
4. Registrar juegos oficiales de forma estática y juegos externos mediante manifiestos instalados localmente.
5. Mantener los juegos para dos participantes y sin dinero real.
6. Preservar la presentación Wasteland Terminal sin mezclarla con las reglas XMPP.

## 2. Vista de componentes

```text
┌──────────────────────────────── Renderer ────────────────────────────────┐
│ ConversationView                                                         │
│   └─ GameEntryAction                                                      │
│       └─ GameFacade / GameSessionStore                                    │
│           └─ GamesPort                                                     │
│              └─ ElectronGamesPort                                         │
│                 └─ window.atomicChat.games (Preload allow-list)           │
└────────────────────────────────────┬──────────────────────────────────────┘
                                     │ named IPC + domain.event
┌────────────────────────────────────▼──────────────────────────────────────┐
│ Electron Main                                                              │
│ GameUseCases → GameSessionManager → GameTransport → XmppAdapter/session    │
│       │                 │                 │                                │
│       ├─ GameRegistry   ├─ GameStorage    └─ protocol validation           │
│       └─ GameRuntime    └─ SQLite account/session scope                    │
│              │                                                             │
│       pure official rules / future external sandbox host                   │
└──────────────┬───────────────────────────────┬─────────────────────────────┘
               │                               │
        XMPP direct messages             SQLite + package directory
```

## 3. Responsabilidades

### `GameRegistry`

Es un registro de metadatos, no un service locator universal.

- Registrar `gameId`, nombre, versión del juego, versión de API, distribución, capacidades, límites y entrypoints.
- Contiene Tic Tac Toe y Reversi como entradas compiladas; Cara o Cruz no forma parte del catálogo Main.
- No exponer paths, módulos Node, credenciales ni objetos de ejecución al Renderer.
- Rechazar IDs duplicados y versiones incompatibles.

La lectura del catálogo se expone mediante `games.catalog` y solo devuelve entradas
`official`. No se exponen módulos, rutas ni manifests externos.

### `Games IPC` y `GameEventPublisher`

`ipc-game-handlers.cjs` registra operaciones nombradas,
valida sender/cuenta/conversación/sesión/generación y reautoriza después de esperas.
`GameEventPublisher` filtra por `webContents`, cuenta, conversación y sesión; publica
solo DTO sanitizados después de persistir y mantiene `game.*` fuera del historial,
unread y notificaciones.

El límite IPC también rechaza MUC descubierto, bloquea revancha antes de un estado terminal,
revalida la generación después de `rematch` y permite leer snapshots persistidos cuando
la cuenta está desconectada, sin permitir que una acción use una conexión obsoleta.

El harness de interoperabilidad es opt-in y conserva niveles separados de evidencia:
adaptadores simulados, Electron local con Preload/Renderer real y servidor XMPP
autorizado. La interoperabilidad real requiere un entorno autorizado.

Main aplica admisión bounded: sesiones vivas por cuenta/peer, invitaciones
pendientes, eventos por ventana, ACKs y solicitudes de resync pendientes, además de
deduplicación por sesión. Las cuotas se cargan desde `ATOMIC_GAMES_*` y no se exponen
al Renderer.

### `GameFacade` y `GameSessionStore`

El Renderer consume `GamesPort` mediante Preload, usa
signals para catálogo, sesiones y snapshots confirmados, y descarta resultados o
eventos de generaciones anteriores. La UI de juegos se monta únicamente en
conversaciones directas. El panel carga con `@defer`, presenta legalMoves y
passAllowed calculados por Main, y añade resultado, rol, foco roving y etiquetas ARIA.

### `GameSessionManager`

La máquina de estados, la autoridad local de eventos y
el transporte acotado se ejecutan en Main; no hay API pública de juegos en Renderer.

Debe ser el dueño de una máquina de estados por `sessionId`:

`idle` no es un estado persistido: significa que no existe un registro de sesión.
Una sesión persistida usa únicamente:

```text
invited → accepted → active → finished → closed
  │          │          ├→ paused → resync-required → active
  │          ├→ rejected│          └→ abandoned → closed
  │          └→ expired └→ cancelled → closed
```

La clave interna mínima es `(accountId, sessionId)` y cada sesión contiene un
`conversationId`, `peerBareJid`, `gameId`, `gameVersion`, `apiVersion`, `localTurn`,
`lastAcceptedRevision`, `lastAcceptedEventId`, `sessionGeneration`, `stateHash` y
timers bounded. Una misma pareja puede tener varias sesiones simultáneas; nunca se
debe correlacionar solo por JID.

Responsabilidades:

- validar invitación, aceptación, rechazo, cancelación, movimiento, finalización, abandono y revancha;
- comprobar cuenta, conversación, peer, sesión XMPP y generación actual;
- deduplicar por `eventId` y `(actor, actorSeq)` y detectar huecos;
- serializar transiciones por sesión;
- persistir antes de publicar el estado que la UI presentará;
- detener timers y listeners al alcanzar estado terminal o destruir el runtime.

### `GameTransport`

Adaptador explícito sobre la sesión XMPP actual.

- `electron/xmpp/xmpp-games.cjs` usa el `XmppAdapter`
  existente y mensajes directos simulables; no crea clientes ni conexiones nuevas.
- Serializa/deserializa únicamente el namespace `urn:atomic-chat:games:1`.
- Usa mensajes con extensión para eventos asíncronos; capabilities e IQ personalizado
  siguen fuera del protocolo actual.
- No publica directamente en `domain.event`; devuelve eventos internos validados a `GameSessionManager`.
- Incluye una guarda de `(accountId, session object, sessionGeneration)` equivalente al patrón usado por stickers y MUC.
- Rechaza MUC, cuenta/peer/conversación incorrectos, generaciones obsoletas, payloads
  desconocidos, duplicados incompatibles y hashes divergentes.
- Aplica rate limiting por cuenta/peer/sesión/kind, limita ACKs y requests pendientes,
  y ofrece diagnósticos internos bounded para pruebas y operación.
- `state.response` solo verifica si el snapshot remoto coincide; ante divergencia marca
  `resync-required` y no instala estado remoto sin un protocolo de rango seguro.

### `GameRuntime`

Host de reglas y presentación:

- **Oficial:** reglas puras estáticas y confiables, sin APIs privilegiadas, conectadas al manager mediante el contrato común. La implementación actual incluye Tic-Tac-Toe y Reversi.
- **Externo:** runtime no confiable dentro de una `WebContentsView`/ventana renderer sandboxada. Un iframe con `sandbox="allow-scripts"` comparte el renderer y tiene una frontera más débil.
- El runtime externo solo recibe comandos de UI, snapshots acotados y resultados de host; no recibe `atomicChat`, `ipcRenderer`, Node, XMPP, SQLite, rutas ni secretos.
- Un watchdog limita tiempo de carga, frecuencia de mensajes, tamaño de estado, timers y memoria observable. Si se excede, el host destruye el contexto y marca la partida como `plugin-fault`.

No usar `eval`, `new Function`, `node:vm`, Worker con Node o cargar el paquete en el contexto Angular principal como frontera de seguridad.

### `GameStorage`

Persistencia Main de:

- sesiones y su estado terminal/no terminal;
- eventos aceptados o snapshots compactos;
- resultados recreativos y marcadores;
- instalaciones y versiones de paquetes.

Todo registro incluye `accountId`; la sesión incluye el bare JID de conversación y el `sessionId`. El payload de plugin debe pasar por un esquema y una cuota. No se debe guardar la cuenta en el almacenamiento del plugin ni aceptar claves arbitrarias sin namespace.

El almacenamiento conserva eventos y snapshots aceptados, incluso terminales, para replay,
deduplicación y auditoría. `getStats(accountId)` mide conteos y bytes JSON sin crear
una compaction destructiva; el purge por cuenta sigue siendo explícito.

### `GamePluginAPI`

Las reglas oficiales ejecutables viven en
[`src/app/core/domain/games/`](../../src/app/core/domain/games/) y no conocen
capacidades de la aplicación. El contrato futuro de plugin está documentado en
[`plugin-api.md`](plugin-api.md): expone solo capacidades declarativas de juego; el
host conserva la autoridad sobre invitaciones, transporte, identidad, persistencia y
límites.

## 4. Flujo de invitación

```text
UI selecciona juego
  → GameFacade solicita games.invite(account, conversation, game)
  → IPC valida sender + cuenta + conversación + catálogo
  → Main crea sessionId/eventId y persiste invited
  → GameTransport envía message/game invite
  → evento XMPP validado por cuenta, peer y namespace
  → SessionManager transiciona accepted/rejected/expired
  → persistencia
  → GameEventPublisher → game.event filtrado por cuenta/conversación/sesión
  → Store/host actualiza la vista
```

El usuario puede cerrar la conversación sin cerrar la sesión; la política de producto debe decidir si se permite notificación y reanudación. El panel no debe conservar listeners propios del transporte.

## 5. Flujo de cuenta y reconexión

1. `SessionProfileCoordinator` cambia la generación lógica del Renderer.
2. Main incrementa `sessionGenerations` al desconectar o sustituir la sesión XMPP.
3. `GameSessionManager` cancela timers de envío, conserva snapshot y marca las partidas activas `paused`.
4. La nueva conexión negocia `apiVersion` y capabilities y solicita el estado desde la última `revision`.
5. Solo se aceptan respuestas cuyo account, peer, sessionId, gameId, generación actual y hash esperado coincidan.
6. La vista antigua se descarta; cualquier respuesta tardía se ignora sin mutar el store actual.

## 6. Juegos oficiales y externos

| Propiedad              | Oficiales                                   | Externos                                                                               |
| ---------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Descubrimiento         | Registro compilado                          | Registro de paquetes instalados                                                        |
| Reglas                 | Código mantenido y testeable                | Código no confiable, contrato versionado                                               |
| Transporte             | Compartido                                  | Compartido, jamás implementado por el paquete                                          |
| Invitación             | Compartida                                  | Compartida                                                                             |
| Persistencia           | Compartida                                  | Compartida y acotada                                                                   |
| Aislamiento            | Módulo de UI del Renderer/Main según diseño | Contexto separado obligatorio                                                          |
| Actualización          | Release de Atomic Chat                      | Reinstalación manual del archivo                                                       |
| Confianza del marcador | Puede ser validada por reglas oficiales     | Recreativa; no se debe presentar como resultado verificablemente confiable sin árbitro |

## 7. Decisiones y límites pendientes

- `DECIDIDO_PARA_EL_DISEÑO`: preferir `WebContentsView` en Electron 45 para el runtime externo; la activación productiva aún requiere implementación autorizada, límites medidos y revisión de threat model. El iframe queda como alternativa condicionada por mediciones y riesgo.
- Las reglas puras oficiales no dependen de Angular, Electron,
  Node, XMPP, SQLite, reloj global ni aleatoriedad implícita; la estrategia P2P de
  revisión se prueba en `src/app/core/domain/games/game-rules.spec.ts`.
- Las reglas oficiales se comparten con Main mediante un artefacto CommonJS generado desde TypeScript; no hay imports `.ts` desde Electron.
- Los límites de payload, estado y timers de transporte están
  cerrados para la primera implementación y cubiertos por pruebas aisladas; el rate y
  el número máximo de sesiones siguen requiriendo mediciones autorizadas.
- Los límites de sesiones, rate, pendientes y deduplicación están
  implementados y cubiertos por pruebas deterministas; no constituyen benchmark de
  RSS/CPU ni sustituyen la interoperabilidad XMPP real.
- El harness local y la matriz de XEPs no constituyen una afirmación de interoperabilidad
  con servidores.
- `PENDIENTE_VALIDACION`: protocolo de replay incremental/compaction, interoperabilidad
  con servidores XMPP y límites de carga en escenarios reales.
