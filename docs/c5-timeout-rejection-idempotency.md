# C5 — Timeout, rechazo y duplicación de archivos

Actualización C5-INC-05 (2026-11-07): véase el
[expediente de cancelación con Spark 3.0.2](c5-inc05-spark-cancellation.md).
Corrige el cierre especulativo durante `open`, distingue aviso de cierre remoto y
registra 57 pruebas focalizadas. Los resultados de las secciones anteriores a esta
actualización son históricos; **C5-INC-05 y C5 global permanecen abiertas**.

Fecha: 2026-11-07. Modo: `IMPLEMENTACION_AUTORIZADA`.

Baseline solicitado: `ee12b95a4a7a01875a955db35dc2ebf185487cfe`.
HEAD inspeccionado: `781b529`, rama `dev`, árbol inicialmente limpio.
Se conservan las correcciones posteriores `c6cc7a6` y `781b529`: timeout
configurable por transferencia y propagación al IQ caller. No se aumentan sus valores.

## Diagnóstico: evidencia del código

| Incidencia | Causa comprobada | Corrección |
| --- | --- | --- |
| C5-INC-01 | `withTimeout` terminaba su propia promesa, pero `cancel` esperaba `record.operation` y no interrumpía el IQ. Las operaciones de lectura/stat podían terminar después de una cancelación y programar otra fase. | Señal de aborto por transferencia; la espera termina inmediatamente, retira su timer y comprueba el estado antes de invocar cada fase. El transporte verifica terminalidad y sesión antes y después del IQ. |
| C5-INC-02 | `parseOffer` generaba un UUID por recepción; `filePending` indexaba por SID y podía sobrescribirse, mientras las ofertas previas seguían visibles. La eliminación terminal de `filePending` no conservaba correlación. | Memoria SI independiente de los recursos de transferencia, con correlación por cuenta, generación, JID completo e identificadores IQ/SI. Reutilización de la decisión, sin otra llamada a `add` ni otro evento de oferta. |
| C5-INC-03 | El código esperaba un IQ de tipo `error`, pero el caller instalado normalmente rechaza la promesa. Un `StanzaError` acababa como `network_lost`; el error sintético `REMOTE_REJECTED` usaba incorrectamente `cancelled_by_sender`. | Normalización de errores reales y de respuestas sintéticas; rechazo remoto como `cancelled_by_receiver`, sin reintento ni segunda transición terminal. |
| C5-INC-04 | El compositor deduplicaba durante 800 ms y la fachada excluía lotes simultáneos, pero Main procesaba cada invocación repetida. La fachada también podía sustituir un terminal por un evento tardío y continuar un lote al volver a la misma cuenta. | Idempotencia antes del selector/temporal/envío en los tres canales IPC; conservación de terminales y ofertas conocidas en la fachada; generación local de cuenta para resultados y lotes pendientes. |

La desconexión explícita esperaba primero la limpieza de recepciones. Ahora marca
`disconnecting` y solicita la terminación de ambas direcciones antes de esperar,
de modo que una recepción pendiente no permita continuar el envío.

### Comportamiento de la dependencia instalada

Se inspeccionaron `node_modules/@xmpp/iq/package.json` y `caller.js`, versión
**0.14.0**, además de `@xmpp/events/lib/timeout.js`, `TimeoutError.js` y
`@xmpp/middleware/lib/StanzaError.js`.

`request(stanza, timeout)` registra un `Deferred`, espera `entity.send` y luego
inicia el timeout de respuesta. `_route` resuelve por IQ id y rechaza los errores
con `StanzaError.condition`; un vencimiento genera `TimeoutError`. No acepta
`AbortSignal` ni expone una operación pública de cancelación.

El adaptador retira exclusivamente su IQ del mapa `iqCaller.handlers` y resuelve
su Deferred al abortar. Resolver evita una promesa rechazada sin observador si
`entity.send` aún no terminó. Las comprobaciones de terminalidad impiden usar esa
resolución como aceptación. El coordinador libera descriptor, reserva y timers
sin esperar ese envío de red. Esta integración con un detalle interno de 0.14.0
queda cubierta mediante el caller real sin conexión y debe revisarse al actualizar
`@xmpp/iq`. No se modifica `node_modules`.

### Correlación e idempotencia

- SI: misma cuenta, generación y JID completo, con el mismo IQ id o el mismo
  `siSid`, representa una negociación ya conocida. El IQ id es la identidad de
  la solicitud; el SID identifica el stream. Los duplicados comparten decisión
  pendiente y repiten la misma respuesta después de decidir, incluso tras terminar.
  Una aceptación ya emitida no se cambia retrospectivamente por un error; un
  `open` posterior al terminal no encuentra un stream activo. Se exige IQ id en
  ofertas nuevas y una selección única de `stream-method = IBB` al aceptar.
- Cada memoria conserva como máximo **256 entradas**. Las operaciones pendientes
  no se expulsan; al llenarse se elimina la primera terminal elegible. Si todas
  siguen activas se rechaza la admisión por capacidad. No hay polling ni nuevos
  timers para mantener estas memorias.
- IPC: clave `(senderId, accountId, requestId)` compartida por `file.send`,
  `file.sendDropped` y `file.sendClipboard`. Repetirla comparte la promesa o el
  resultado, incluidos error y cancelación. Reutilizarla con otro canal o
  conversación genera conflicto. La autorización se comprueba también al repetir.
  Un cambio de sesión durante el selector o la preparación del archivo invalida
  el envío pendiente.
- Una intención nueva usa otro `requestId` y produce nuevos `transferId`, IQ id y
  `siSid`. Nombre, tamaño y contenido iguales no bloquean ese reenvío.
- Estas garantías tienen una **ventana acotada y en memoria**: después de expulsar
  una entrada terminal o reiniciar Main no existe deduplicación histórica duradera.
  Los IDs nuevos son obligatorios para nuevas operaciones. No se promete una
  garantía de exactamente una operación para siempre.

### Recorrido del pegado

`MessageComposerComponent.onPaste` → `filesPasted` → `App.pasteFiles` →
`FileFacade.sendClipboard` → puerto Electron → Preload `file.sendClipboard` →
Main `registerFileHandlers` → `XmppAdapter.sendFile` → coordinador saliente → SI.

El compositor conserva su WeakSet de eventos, deduplicación de representaciones y
ventana de 800 ms. La fachada crea un requestId por archivo; Preload lo conserva;
Main lo deduplica antes de crear temporales o llamar al adaptador. El resultado y
los eventos se aplican por transferId. Ningún observador de estado llama de nuevo
al envío. La ventana de 800 ms puede agrupar dos pegados deliberados muy próximos;
un pegado posterior queda permitido y probado.

## Contratos y clasificación de errores

Sin cambios en `FileTransfer`, `FileOffer`, `FileRequest`, versión IPC 1, nombres
de canales o eventos `file.offerReceived`/`file.stateChanged`. Renderer conserva
el acceso por Preload y puertos; no se añaden dependencias, rutas ni secretos al IPC.

| Evidencia de error | Código interno | Resultado público |
| --- | --- | --- |
| `forbidden` remoto | `REMOTE_REJECTED` | `cancelled / cancelled_by_receiver` |
| `not-acceptable`, método no implementado, servicio no disponible, `bad-profile` o `no-valid-streams` de SI | `UNSUPPORTED_METHOD` | `failed / unsupported_method` |
| `TimeoutError`, timeout del coordinador o `remote-server-timeout` | `TIMEOUT` | `failed / timed_out` |
| Sesión inválida/desconexión o recurso ausente | `NOT_CONNECTED` / `RECIPIENT_UNAVAILABLE` | `failed / network_lost` |
| Otro error del transporte o respuesta no correlacionada | `TRANSPORT_FAILED` | `failed / network_lost` |
| Cancelación local del emisor | Señal local | `cancelled / cancelled_by_sender` |

La distinción entre desconexión y otro fallo de transporte se mantiene internamente;
el contrato público ya agrupa ambos bajo `network_lost` y `TRANSPORT_FAILED`.
Se corrige explícitamente la semántica de rechazo saliente: antes podía aparecer
como `cancelled_by_sender`; ahora identifica al receptor. La desconexión saliente
también deja de presentarse como una cancelación voluntaria. Son valores existentes
del contrato; no se reescribe historial previo ni se migra almacenamiento.

## Validación focalizada ejecutada

Entorno local Windows; stanzas, sesiones y archivos sintéticos; sin `.env`, secretos
ni servidores reales. Se utiliza el middleware/caller instalado, sustituyendo
`session.send`; nunca se llama a `session.start` en estas pruebas.

```powershell
node --test --test-reporter=spec tests/file-transfer.outgoing.test.cjs tests/file-transfer-timeout.test.cjs tests/file-transfer.integration.test.cjs tests/xmpp-iq-callee.test.cjs tests/clipboard-and-external-links.test.cjs
npx ng test --no-watch --no-progress --include src/app/message-composer.spec.ts --include src/app/core/file.facade.spec.ts
npm run build
git diff --check
```

- Node: **60/60** pruebas pasan. La última repetición tras revisión usó
  `--test-reporter=dot`, mismos cinco archivos, salida 0.
- Angular: **21/21** pruebas pasan en los dos archivos indicados.
- Build de producción: salida 0. Advertencia de presupuesto inicial:
  **598,31 kB / 500 kB**; no se atribuye mejora de rendimiento ni se cambia el límite.
- Revisión de whitespace con `git diff --check`: sin errores.
- Durante el desarrollo se corrigieron fallos de las nuevas pruebas y la copia de
  respuestas XML. La fixture C5-OUT-09 esperaba `localActions` sin proporcionar
  `onCompleted`; ahora registra explícitamente ese colaborador simulado.

| Criterio | Evidencia focalizada |
| --- | --- |
| Timeout y aceptación tardía sin IBB | C5-INC-01 con caller real, timer controlado, respuesta tardía y ausencia de nuevas stanzas |
| Rechazo remoto único, sin nueva oferta | C5-INC-03: errores reales `forbidden`, incompatibilidad, timeout y transporte |
| SI duplicado pendiente y terminal | C5-INC-02: rechazo, aceptación seguida de cancelación, fallo y timeout; repetición por middleware real |
| Nuevas operaciones y aislamiento | C5-INC-02: nuevos IQ/SID, distinta cuenta, generación y recurso; saturación con una negociación activa |
| Pegado único y reenvío deliberado | Compositor existente y prueba de evento DOM propagado hasta `FileFacade`; IDs distintos al reenviar |
| IPC repetido sin duplicar SI | Tres canales, resultados pendientes/terminales, autorización, capacidad y prueba IPC→adaptador→coordinador→SI |
| Bytes exactos y finalización | C5-OUT-02/09, C5-INT-01/03/04: bloques, ACK secuenciales, fixture de 84.538 bytes y SHA-256 |
| Cancelación durante IBB | Evidencia histórica sustituida por C5-INC-05: sin `close` durante `open` pendiente; un cierre estándar durante IBB abierto, sin más datos |
| Desconexión/cambio de sesión | C5-INC-01: offline, disconnect con recepción bloqueada, generación y envío de red pendiente; selector IPC y lote Angular antiguos |
| Recursos y UI | Retirada de handlers IQ, registros, descriptor, timers y reserva; eliminación de temporales de portapapeles; terminales inmutables en fachada |

No se ejecutaron suites históricas completas, `npm test`, `test:p0`,
`test:ci:focused`, pruebas con servidores, Electron empaquetado ni pruebas en Linux.
No se certifica persistencia real del historial: se impide duplicar la operación
que origina la finalización y no se cambia su implementación de almacenamiento.

## Inferencias y límites de interoperabilidad

Los protocolos describen negociación/rechazo SI y cierre de streams IBB, pero no
una retirada interoperable de la oferta SI ya mostrada en la interfaz remota.
Por tanto, **no se promete cerrar el diálogo de Spark** al cancelar localmente o
vencer el timeout. Su permanencia concreta depende del cliente y no fue observada
en esta validación. Una stanza ya entregada a `entity.send` tampoco puede retirarse.

La implementación deja de enviar nuevas fases tras el terminal y no utiliza
`IBB close` para simular una retirada de SI. Si ya se abrió IBB, usa el cierre
definido por XEP-0047. Para una SI aún pendiente, Atomic Chat envía una notificación
`chat` con una extensión propia que otro Atomic Chat reconoce para cerrar la oferta.
Otros clientes reciben el texto, pero solo pueden cerrar su diálogo si implementan
esa extensión. No hay retirada SI interoperable ni reintentos automáticos. Debe
validarse este comportamiento con clientes reales antes de afirmar interoperabilidad.

Fuentes primarias consultadas: [XEP-0095, negociación y errores SI](https://xmpp.org/extensions/xep-0095.html),
[XEP-0096, perfil de archivos](https://xmpp.org/extensions/xep-0096.html) y
[XEP-0047, apertura y cierre IBB](https://xmpp.org/extensions/xep-0047.html).
La evidencia de la dependencia procede del código instalado 0.14.0, no de asumir
que la documentación de otra versión describe su comportamiento.

### Addendum — cierre de un IBB abierto

XEP-0047 permite a cualquiera de las partes cerrar un bytestream IBB mediante un
IQ `set` con `<close/>`. Al cancelar o fallar después de abrir IBB, Atomic Chat
ahora intenta ese cierre con un controlador y el timeout configurado del IQ
independientes. El estado local y la liberación de recursos no esperan la respuesta.
Un fallo de envío queda como mejor esfuerzo. No se envía `<close/>` mientras una
oferta SI aún espera aceptación ni se repite cuando el cierre normal ya está en
curso.

Como receptor, Atomic Chat responde con IQ `result` a un `<close/>` válido que llega
antes de recibir todos los bytes, elimina el temporal y marca `cancelled_by_sender`.
Si ya recibió todos los bytes, mantiene el cierre exitoso normal. XEP-0047 comunica
que el stream se cerró, no ofrece un campo separado para explicar el motivo. Spark
recibirá el cierre estándar si sigue conectado; su presentación de una transferencia
incompleta aún requiere una prueba con Spark real. Una oferta SI sin aceptar puede
seguir visible en clientes que no entienden la extensión de Atomic Chat, porque no
hay un retiro SI estándar.

Cuando vence el timeout mientras se espera la aceptación SI, Atomic Chat envía al
recurso destinatario un mensaje XMPP `chat` normal con un marcador de cancelación
que incluye el SID SI. Cualquier cliente muestra el texto; Atomic Chat encuentra la
oferta pendiente por el JID completo y SID, responde al IQ SI con error, y cambia el
estado entrante a `cancelled_by_sender`, incluso si ya se había aceptado SI pero IBB
no había comenzado. Spark no implementa este marcador y puede seguir mostrando su
solicitud hasta que el usuario la resuelva.

Al pegar archivos, se usa `clipboardData.files` como lista principal y `items` solo
como fallback. Chromium puede exponer el mismo archivo en ambas colecciones con
metadatos distintos; concatenarlas podía iniciar dos transferencias por un único
pegado.

Las pruebas focalizadas cubren el cierre tras cancelar durante datos, tras timeout
de ACK, la cancelación de una oferta SI en Atomic Chat y la selección única de los
archivos pegados. En esta actualización pasan **65/65** pruebas CJS focalizadas,
**23/23** pruebas Angular enfocadas, `npm run typecheck` y `npm run build`; también
pasa `git diff --check`. El build aún muestra el presupuesto inicial excedido por
98.64 kB.

## Archivos y actualización de tareas

Producción: `electron/file-transfer-outgoing.cjs`, `electron/xmpp-file.cjs`,
`electron/file-protocol.cjs`, `electron/ipc-file-handlers.cjs`,
`electron/xmpp-session.cjs`, `electron/xmpp-adapter.cjs`,
`src/app/core/file.facade.ts`, `src/app/message-composer.component.ts`.

Pruebas modificadas: `tests/file-transfer.outgoing.test.cjs`,
`tests/xmpp-iq-callee.test.cjs`, `tests/clipboard-and-external-links.test.cjs`,
`src/app/core/file.facade.spec.ts`, `src/app/message-composer.spec.ts`.
Documentación: este archivo.

| Tarea | Estado de esta entrega | Reserva |
| --- | --- | --- |
| C5-INC-01…04 | Implementadas y validadas focalizadamente en entregas anteriores | Interoperabilidad real pendiente |
| C5-INC-05 | Abierta; corrección y validación local documentadas en el expediente específico | Spark 3.0.2: aviso no confirma retirada; prueba manual A/B/C pendiente |
| C5 global / C5-SI-RECV-006 | Abierta | Esta corrección no certifica el cliente Spark ni todas las funciones de archivos |
| B8 | Referenciada, sin cierre | Transporte SI/IBB existente; la retirada SI pendiente usa una extensión Atomic Chat |
| B9 | Referenciada, sin cierre | Invalida operaciones antiguas; sin cola offline ni nueva política de reconexión |
| E5 | Referenciada, sin cierre | Terminalidad y correlación preservadas bajo los eventos IPC existentes |

La trazabilidad corresponde a los expedientes del workspace de auditoría
`reports/00-control/remediation/task-register-A-E.md`,
`reports/B-xmpp/connection-negotiation.md` y
`reports/E-atomic-chat/state-and-events.md`. Sus estados globales no se declaran terminados.
