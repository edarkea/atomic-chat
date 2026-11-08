# C5-INC-05 — Cancelación SI/IBB y Spark 3.0.2

Fecha: 2026-11-07. Modo: `IMPLEMENTACION_AUTORIZADA`, exclusivamente C5.
Baseline: `cdda674f84fcc5643788b24824ec9da3d1c138e3`, rama `dev`.
La revisión de fuentes externas fue de solo lectura. Las pruebas descritas abajo
son de implementación local, no resultados de una auditoría estática ni de Spark real.

## Diagnóstico y regresión

La cancelación local, la entrega de un mensaje y el cierre del protocolo son hechos
distintos. El baseline ya impedía reactivar transferencias terminales, pero desde
`8e21077` trataba un `open` pendiente como suficiente para intentar un `close`.
Además, el texto del aviso podía interpretarse como una cancelación remota efectiva.

| Commit revisado | Cambios en los cuatro archivos solicitados |
| --- | --- |
| `431ed9ec9651adadf955e403848d4ab259f29a5a` | `file-transfer-outgoing.cjs`: AbortController por operación, interrupción de `withTimeout`, comprobación antes de cada fase y razones correctas de rechazo/desconexión. `xmpp-file.cjs`: terminalidad/sesión antes y después de IQ, retirada del Deferred, clasificación de errores, validación de selección IBB y memoria SI acotada que reutiliza decisiones. Sin cambios en `file-transfer.cjs` ni `xmpp-adapter.cjs`. |
| `8e2107744f5abd580e5dc0c727a79e0a4943b9c0` | Coordinador saliente: `activePhase`, `ibbOpened` y `closeAbortedStream` con señal/timer independientes; **también cerraba cuando `activePhase === 'open'` sin ACK**. Adaptador y servicio: propagación de señal alternativa a `requestOutgoingIq` y `sendOutgoingClose`. Coordinador entrante: `cancelBySender`. Servicio: `close` prematuro de un stream abierto responde result y cancela la recepción parcial. |
| `3d77b7ee9b09fa025da11c857a4871c182f6ea4f` | Coordinador saliente invoca aviso solo para timeout SI; servicio crea mensaje chat informativo; adaptador delega `sendOutgoingTimeoutNotice`. Sin cambios en coordinador entrante. |
| `191a6afe8fcec83e4ceaa94c32f2bbd9dffb9542` | Ninguno de esos cuatro archivos cambia. Agrupa acciones simultáneas de adjuntar en `file.facade.ts` y su prueba. |
| `cdda674f84fcc5643788b24824ec9da3d1c138e3` | Coordinador saliente amplía el aviso a cancelación manual durante SI. Servicio añade marcador propietario `urn:atomic-chat:file-transfer:1`, correlación de recepción por cuenta/JID completo/SID y `cancelBySender`. Adaptador delega y procesa el mensaje antes del chat normal. Sin cambios en coordinador entrante. También deduplica el pegado, fuera de la corrección actual. |

`markTerminal` conserva un solo terminal y aborta la espera; `cancel` espera la
limpieza local. `closeAbortedStream` no acredita por sí mismo un cierre remoto.
`requestOutgoingIq` retira el handler propio de `@xmpp/iq` 0.14.0; un IQ tardío
no inicia otra fase. `sendOutgoingClose` envía un IQ set, nunca una respuesta
fabricada en nombre del receptor. Los IQ error de una recepción Atomic Chat son
respuestas legítimas del receptor a la SI que recibió.

No se proporcionó una captura de stanzas del incidente real. Por ello no se asigna
una fase al incidente a partir de la tarjeta visible: una tarjeta pendiente sugiere
SI sin aceptar, pero debe comprobarse con IQ id/SID y ACK. En las pruebas se captura
`activePhase` y `ibbOpened` en el instante exacto de cancelar o agotar el timeout.

## Referencias de la versión utilizada

El usuario confirmó **Spark 3.0.2**. Su etiqueta `v3.0.2` apunta a
`257b87f4aa97a3c2976bcbaae48f717903ee9162`; el
[POM de esa revisión](https://github.com/igniterealtime/Spark/blob/257b87f4aa97a3c2976bcbaae48f717903ee9162/pom.xml#L95)
declara **Smack 4.4.6**, cuyo commit es
`a82ae41c22f041c01cd40a9ef6b1918bc2afee3c`. La consulta preliminar de la rama
actual de Spark no se usa como evidencia de 3.0.2. No se inspeccionó el binario
instalado ni posibles plugins o modificaciones locales.

- [SparkTransferManager.java](https://github.com/igniterealtime/Spark/blob/257b87f4aa97a3c2976bcbaae48f717903ee9162/core/src/main/java/org/jivesoftware/spark/filetransfer/SparkTransferManager.java#L262): el listener SI despacha `handleTransferRequest`; si ningún listener externo la consume, crea `ReceiveFileTransfer`, le entrega la solicitud y añade el componente al transcript. La ruta de cierre del chat llama a `cancelTransfer`.
- [ReceiveFileTransfer.java](https://github.com/igniterealtime/Spark/blob/257b87f4aa97a3c2976bcbaae48f717903ee9162/core/src/main/java/org/jivesoftware/sparkimpl/plugin/filetransfer/transfer/ui/ReceiveFileTransfer.java#L170): aceptar/rechazar opera sobre `FileTransferRequest` (rechazo en líneas 241/285, aceptación en 319). El progreso se observa después de aceptar. `cancelTransfer` (687) solo cancela si ya existe `transfer`. No se encontró en este componente un receptor del marcador Atomic Chat ni una asociación entre texto de chat y retirada de tarjeta SI pendiente.
- [Smack FileTransferManager.java](https://github.com/igniterealtime/Smack/blob/a82ae41c22f041c01cd40a9ef6b1918bc2afee3c/smack-extensions/src/main/java/org/jivesoftware/smackx/filetransfer/FileTransferManager.java#L75): registra el handler SI set, crea una solicitud y avisa a los listeners. `rejectIncomingFileTransfer` responde forbidden al IQ original; no es una retirada enviada por el iniciador.
- [Smack FileTransferRequest.java](https://github.com/igniterealtime/Smack/blob/a82ae41c22f041c01cd40a9ef6b1918bc2afee3c/smack-extensions/src/main/java/org/jivesoftware/smackx/filetransfer/FileTransferRequest.java#L128): `accept` crea `IncomingFileTransfer`; `reject` delega al manager. No expone una operación para consumir una retirada remota de la oferta pendiente.
- [Smack OutgoingFileTransfer.java](https://github.com/igniterealtime/Smack/blob/a82ae41c22f041c01cd40a9ef6b1918bc2afee3c/smack-extensions/src/main/java/org/jivesoftware/smackx/filetransfer/OutgoingFileTransfer.java#L389): `cancel` cambia el estado local. No constituye evidencia de que otro cliente cierre una tarjeta pendiente.
- [Smack CloseListener.java](https://github.com/igniterealtime/Smack/blob/a82ae41c22f041c01cd40a9ef6b1918bc2afee3c/smack-extensions/src/main/java/org/jivesoftware/smackx/bytestreams/ibb/CloseListener.java#L49): busca una sesión IBB; cierra la existente o devuelve item-not-found. No busca tarjetas ni solicitudes SI pendientes.

Conclusión limitada a esas rutas: **no se encontró un mecanismo soportado para
retirar desde Atomic Chat la oferta pendiente de Spark 3.0.2**. No se implementa
una alternativa especulativa. La evidencia estática explica por qué el aviso no
equivale a retirar la tarjeta; el comportamiento visual del cliente instalado
sigue pendiente de verificación manual.

[XEP-0095](https://xmpp.org/extensions/xep-0095.html#usecases-neg) describe oferta,
aceptación y rechazo SI, sin una retirada del emisor en esa negociación.
[XEP-0047](https://xmpp.org/extensions/xep-0047.html#close) define el cierre de IBB
mediante IQ set/close y su respuesta. Ninguno convierte un mensaje chat en cierre
de una oferta SI. El marcador Atomic Chat sigue siendo una extensión propia.

## Contrato y matriz por fase

| Fase al terminar localmente | Evidencia | Conducta saliente | Alcance remoto |
| --- | --- | --- | --- |
| SI pendiente | Sin result SI validado; `ibbOpened=false` | Aborta IQ; un intento de aviso chat; ningún open/data/close ni segunda SI | Aviso informativo; retirada de tarjeta Spark no confirmada |
| SI aceptada, antes de invocar open | `accepted`, sin apertura | La comprobación terminal impide iniciar IBB; puede avisar si aún conserva fase SI | Atomic Chat conserva su recepción del marcador; Spark puede seguir negociando |
| open enviado, ACK pendiente | `activePhase=open`, `ibbOpened=false` | Aborta espera; **sin close** ni datos, incluso si llega ACK tardío | Estado remoto incierto; no se inventa una apertura ni se confirma retirada |
| IBB abierto / ACK data pendiente | ACK open validado; `ibbOpened=true` | Un intento estándar close con señal/timeout propios; termina y libera recursos locales | Se intenta cierre; solo la respuesta remota aporta evidencia del protocolo, no del aspecto de la tarjeta |
| close normal pendiente | `activePhase=close` | No envía un segundo close; aborta espera local | Un ACK tardío no cambia el terminal local ni confirma el resultado visual de Spark |
| Terminal | completed / failed / cancelled | Sin nueva SI, datos ni transiciones; no repite aviso o cierre de aborto | No deduce el estado remoto del estado local |

Cancelación voluntaria sigue siendo `cancelled / cancelled_by_sender`; timeout
sigue siendo `failed / timed_out`. Se conservan `completed`, los demás `endReason`,
DTO, versión IPC, canales y eventos. La UI recibe el resultado local existente;
no se añade un estado de cancelación remota ni se deducen capacidades por el nombre
del recurso. Si se introduce después una indicación de interfaz según capacidades,
deberá basarse en capacidades comprobadas, no en una supuesta confirmación del chat.

Si el receptor abrió IBB pero se perdió su ACK, el emisor no tiene confirmación:
esta entrega no manda close especulativo ni conserva una negociación ilimitada para
esperarlo. Esa incertidumbre remota queda documentada; no se altera ningún timeout.
Una stanza ya entregada a `session.send` tampoco puede retirarse del transporte.

## Cambios justificados

- `electron/file-transfer-outgoing.cjs`: cierre de aborto solo con apertura confirmada y protección explícita contra cierres repetidos. Mantiene limpieza local independiente del ACK remoto.
- `electron/xmpp-file.cjs`: señal alternativa solo permite cierre terminal de un IBB abierto; una señal vencida no autoriza otro IQ. Rechaza close sin apertura. Un aviso tiene como máximo un intento por registro, incluso si falla el envío. Su texto explica la finalización local y la posible necesidad de descartar la solicitud. Conserva destinatario, SID y namespace para Atomic Chat.
- `tests/file-transfer.outgoing.test.cjs`: matriz cancel/timeout × SI/open/data/close con caller real sin red, IQ tardío, stanzas exactas, terminal único, reservas/timers/descriptores/handlers liberados y aviso único. Cubre guardas del transporte, error del aviso y expiración independiente del close sin respuesta. Corrige dos aserciones antiguas absorbidas por el catch de cierre de mejor esfuerzo: ahora cuenta cierres fuera del callback.
- `tests/xmpp-iq-callee.test.cjs`: espera la promesa real del handler en el caso de cierre prematuro, en lugar de un número arbitrario de vueltas de event loop. Conserva las pruebas de recepción del marcador y cierre de ofertas Atomic Chat pendientes/aceptadas.

No cambia `electron/file-transfer.cjs` ni `electron/xmpp-adapter.cjs`: sus contratos
de cancelación entrante y delegación ya sirven a esta corrección. Sin dependencias,
migraciones, cambios de timeout, cambios a Spark ni ampliación fuera de C5.

## Validación focalizada

Windows, Node, archivos y cuentas sintéticos; caller/middleware `@xmpp/iq` instalado.
`session.send` sustituido, sin `session.start`, `.env`, secretos o servidores.

```powershell
node --test --test-reporter=spec tests/file-transfer.outgoing.test.cjs tests/xmpp-iq-callee.test.cjs
node --check electron/file-transfer-outgoing.cjs
node --check electron/xmpp-file.cjs
node --check tests/file-transfer.outgoing.test.cjs
node --check tests/xmpp-iq-callee.test.cjs
git diff --check
```

Resultado: **57/57 pasan**, sin fallos, cancelaciones ni omisiones; comprobaciones
de sintaxis y whitespace con salida 0. También pasan 57/57 sobre una exportación
aislada del índice preparado para commit, sin los cambios locales previos y con
las mismas dependencias instaladas. La primera ejecución detectó dos expectativas
de fixture que omitían el segundo bloque de datos y una espera frágil del handler
entrante; se corrigieron antes de este resultado. No se ejecutó la batería completa,
suites históricas, build Angular, tests con servidor ni Electron/Spark reales.
El typecheck Electron actual no incluye los dos módulos modificados; no se presenta
como validación de estos archivos. Las pruebas con receptor simulado no certifican
interoperabilidad real con Spark.

## Prueba manual pendiente y cambio futuro en Spark

Registrar versión/binario Spark, versión de Atomic Chat, servidor, fase, IQ id/SID
y stanzas anonimizadas. Repetir cancelar y timeout con SI pendiente; después intentar
aceptar tarde. Repetir cancelación con ACK open confirmado y datos parciales.
Separar los resultados siguientes, todos **pendientes de ejecución en esta entrega**:

| Observación | Evidencia necesaria | No permite concluir |
| --- | --- | --- |
| A: llega el aviso informativo | Mensaje recibido y texto visible | Que se haya retirado la tarjeta |
| B: se cierra realmente la oferta | Tarjeta retirada o deshabilitada automáticamente, correlacionada con la oferta | Que A por sí solo provocó B |
| C: aceptar tarde no permite transferir | Result SI tardío, ausencia de open/data del emisor y resultado/error observado en Spark | Que la tarjeta se retiró al cancelar o que se envió un rechazo SI ficticio |

Para C, el emisor **ignora** el result SI tardío: no responde con error a un result.
Spark podría terminar fallando su negociación; debe registrarse qué muestra y
cuándo, sin confundirlo con una retirada anterior. Con IBB abierto, registrar además
el close y su respuesta, el temporal remoto y el estado visual final.

Una retirada automática requeriría un cambio del lado de Spark: un handler de una
extensión acordada, correlación segura por emisor completo/SID y solicitud, transición
idempotente de la tarjeta pendiente y desactivación de aceptar, con pruebas de carreras
aceptar/cancelar y publicidad de capacidad. No basta con mostrar el body ni con llamar
al `cancelTransfer` actual antes de existir `transfer`. Es trabajo futuro, no un
mecanismo disponible ni implementado por esta entrega.

## Registro C5

| Tarea | Estado | Pendiente |
| --- | --- | --- |
| C5-INC-05.1 | Revisión estática de los cinco commits completada | Captura del incidente para determinar su fase real |
| C5-INC-05.2 | Implementada y validada localmente | Validación manual entre clientes reales |
| C5-INC-05.3 | Revisión de Spark 3.0.2/Smack 4.4.6 completada; limitación documentada | Ejecutar A/B/C en el binario utilizado; no hay retirada SI compatible demostrada |
| C5-INC-05 / C5 global / C5-SI-RECV-006 | **Abiertas** | No cerrar por pruebas simuladas ni por entrega del aviso |

Las fases posteriores y B8/B9/E5 mantienen sus estados. Los cinco archivos que ya
tenían cambios locales al iniciar la tarea se preservan; sus cambios previos no
forman parte del commit C5-INC-05, incluidos los de MIME en `xmpp-file.cjs`.
