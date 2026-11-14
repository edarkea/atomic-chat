# Protocolo XMPP de juegos

## 1. Estado de soporte actual

`urn:atomic-chat:games:1` está implementado en Main como extensión de los mensajes de
chat de la sesión XMPP existente. La validación se ejecuta con dos sesiones simuladas,
sin red. Todavía no se ha demostrado que un servidor XMPP concreto lo soporte ni se
debe presentar como interoperabilidad de servidor.

## 2. Convenciones de identidad

Cada evento transporta o deriva estas identidades:

| Identidad                | Fuente/uso                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `accountId`              | Cuenta local que posee la sesión Main; nunca se confunde con la cuenta actualmente seleccionada en el Renderer.                    |
| `from` / `to`            | JID del stanza, normalizado a bare JID para la conversación y conservando full JID cuando la política lo requiera.                 |
| `sessionId`              | UUID opaco de una partida. Permite varias partidas con el mismo peer.                                                              |
| `gameId` + `gameVersion` | Identifica las reglas negociadas.                                                                                                  |
| `eventId`                | UUID único del evento XMPP; deduplicación y trazabilidad.                                                                          |
| `actorSeq`               | Secuencia monotónica por `(sessionId, actor)` para deduplicar propuestas del emisor. No es la autoridad del estado.                |
| `revision`               | Número monotónico asignado por Main al evento aceptado y al snapshot resultante. Nunca se acepta el valor remoto sin recalcularlo. |
| `correlationId`          | Relaciona respuesta de aplicación con invitación, movimiento o resync.                                                             |
| `stateHash`              | Hash de snapshot canónico después de un evento aceptado.                                                                           |

El receptor debe verificar que el stanza proviene del peer esperado, que el `to`/conversación corresponde a la sesión, que la cuenta y la generación Main siguen activas y que el `sessionId` está registrado.

## 3. Namespace y forma de eventos

Forma conceptual:

```xml
<message type="chat" to="peer@example.test">
  <game xmlns="urn:atomic-chat:games:1"
        event-id="evt-uuid"
        session-id="session-uuid"
        game-id="tictactoe"
        game-version="1.0.0"
        api-version="1"
        actor="initiator"
        actor-seq="4"
        revision="7"
        correlation-id="req-uuid"
        kind="move">
    <state-hash algorithm="sha-256">...</state-hash>
    <move format="json">...</move>
  </game>
</message>
```

La implementación usa JSON únicamente para `move` y `state`, con límites de bytes,
profundidad y tamaño de campos, y valida el contenido antes de entregarlo al dominio.
Los tipos de evento y los hijos XML permitidos tienen una lista cerrada; JSON arbitrario
no se considera una estructura confiable.

## 4. Eventos y estados

| Evento                          | Emisor                   | Efecto esperado                                                                                  |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `capabilities.request/response` | cualquiera               | Negociar `apiVersion`, juegos y versiones compatibles. Puede ser IQ.                             |
| `invite`                        | iniciador                | Crea `invited`; incluye juego, versión y límites.                                                |
| `accept`                        | invitado                 | Pasa a `accepted`; debe referir al `sessionId` original.                                         |
| `reject`                        | invitado                 | Pasa a `rejected`; terminal para esa invitación.                                                 |
| `cancel`                        | cualquiera autorizado    | Pasa a `cancelled` si no terminó.                                                                |
| `start`                         | host lógico de la sesión | Fija participantes, turnos, nonce/semilla y snapshot inicial.                                    |
| `move`                          | jugador del turno        | Se valida contra estado, actor, `actorSeq` y hash; Main asigna `revision` y calcula el snapshot. |
| `move-ack`                      | receptor                 | Confirma `eventId`, `actorSeq`, `revision` y hash resultante.                                    |
| `finish`                        | ambos                    | Propone cierre; Main calcula/verifica el resultado y publica el snapshot final.                  |
| `resign`                        | jugador                  | Pasa a `abandoned`/resultado por abandono.                                                       |
| `rematch`                       | cualquiera               | Crea un nuevo `sessionId`; no recicla el anterior.                                               |
| `state.request/response`        | cualquiera               | Compara y devuelve el snapshot actual; el replay incremental queda pendiente.                    |
| `error`                         | receptor                 | Rechaza una operación con código estable y correlación.                                          |

Estados terminales (`rejected`, `cancelled`, `expired`, `finished`, `abandoned`, `closed`) no aceptan movimientos posteriores. Un evento tardío debe producir deduplicación silenciosa o `GAME_SESSION_CONFLICT`, nunca mutar el resultado.

## 5. IQ frente a message con extensión

### Messages con extensión

Usarlos para invitaciones y eventos de partida porque son asíncronos, se integran con la conversación directa y no requieren un IQ callee específico del peer. Debe existir confirmación a nivel de aplicación para no confundir envío con aceptación.

### IQ

Usarlo para:

- descubrimiento/capabilities con correlación request-response;
- pedir un snapshot o rango de eventos;
- negociar resincronización después de un hueco de secuencia;
- confirmar una operación que necesite respuesta inmediata y timeout acotado.

No asumir que el servidor soporta IQ personalizado, IQ push o almacenamiento de estado. Si un IQ falla, el protocolo debe poder marcar `resync-required` y no inventar un estado.

## 6. Duplicados, orden y replay

- Mantener una tabla o caché bounded de `eventId` por `(accountId, sessionId)`.
- Aceptar el mismo evento repetido solo si payload, emisor y hash coinciden; devolver el mismo resultado sin aplicar dos veces.
- Si `actorSeq` ya fue aceptado, tratarlo como duplicado solo si coinciden emisor,
  payload y hash; si no, es conflicto.
- Un hueco de `actorSeq` pide resync del actor. Un `revision` remoto no puede saltarse
  la serialización local: Main acepta una propuesta contra su último snapshot y asigna
  la siguiente revisión.
- La instancia Main del `initiator` es el único secuenciador: asigna cada `revision`
  contra su snapshot actual. La instancia Main del `responder` solo envía propuestas;
  no las acepta localmente ni puede asumir takeover. Si llegan propuestas concurrentes,
  el initiator acepta como máximo la que sea legal contra su revisión actual y las
  demás se rechazan o requieren resync; no se afirma consenso distribuido.
- El hash se calcula sobre una serialización canónica del estado, no sobre el XML original.
- Expirar invitaciones y solicitudes con timers bounded; cancelar timers al cambiar de cuenta, sesión o estado terminal.

## 7. Reconexión

1. La desconexión local incrementa la generación Main y pasa la sesión a `paused`.
2. La reconexión no reusa el full JID ni la sesión XMPP anterior.
3. Se renegocian API y versión de juego.
4. Se envía `state.request` con `sessionId`, última `revision` y `stateHash` local.
5. El peer responde con `state.response` y el snapshot actual.
6. El manager valida cuenta, sesión, generación, reglas y hash; si diverge, marca
   `resync-required` y no instala silenciosamente el estado remoto. La implementación
   actual no tiene un request de rango de eventos ni replay incremental autenticado.

## 8. Cara o Cruz: aleatoriedad verificable

Una ronda tiene `roundId`, elección local (`heads`/`tails`), nonce aleatorio local y commit.
La codificación no usa concatenación ambigua:

```text
encode(fields) = concat(uint32be(byteLength(utf8(field))) || utf8(field))
commit = SHA-256(encode([
  "atomic-chat:coinflip:commit", 1, gameId, gameVersion,
  sessionId, roundId, actor, choice, nonce
]))
```

Flujo recomendado:

1. Ambos publican commit antes de revelar elección/nonce.
2. Ambos publican reveal; Main calcula la moneda con `SHA-256(encode(["atomic-chat:coinflip:result", 1, sessionId, roundId, initiatorNonce, responderNonce]))` y una regla pública de paridad.
3. Main y cada cliente verifican que cada reveal coincide con su commit; el orden de nonces es por rol, no por llegada.
4. Main puntúa el resultado: cada jugador que coincide recibe un punto; si ambos coinciden, ambos reciben uno; si ninguno, ninguno.
5. Main persiste el resultado y hash de ronda antes de emitir `roundFinished`.

Abandono:

- commit sin reveal dentro del timeout: `round-incomplete`, no asignar puntos automáticamente; marcar `aborted` salvo una política de abandono explícita acordada por ambos;
- reveal inválido o commit cambiado: marcar `cheating-detected`/`resync-required`, no reconciliar puntos silenciosamente;
- una revancha crea nuevo `sessionId` o `roundId`, nunca reusa nonce;
- el marcador se considera recreativo y no una prueba criptográfica de identidad del usuario.

## 9. Errores y compatibilidad

Los errores de protocolo se mapean a códigos de aplicación estables: versión no soportada, juego no instalado, sesión inexistente, peer incorrecto, secuencia con hueco, estado divergente, timeout y recurso excedido. Nunca se reenvía XML crudo al Renderer.

## 10. Validación futura

`PENDIENTE_VALIDACION`: pruebas de dos clientes, Openfire/servidores autorizados, message carbons, offline delivery, stanza IDs, IQ timeout, full JID cambiante, duplicados, reordenamiento y reconexión. No se debe declarar compatibilidad de servidor antes de esas pruebas.
