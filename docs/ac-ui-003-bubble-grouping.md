# AC-UI-003 — Burbujas compactas y agrupación inteligente

## Contrato de agrupación

La agrupación es únicamente una transformación de presentación. `Message` y `RoomMessage` no se modifican y conservan sus IDs, timestamps, estado de persistencia, clasificación y contenido.

| Regla | Implementación | Evidencia |
| --- | --- | --- |
| Remitente estable | dirección + JID bare en directos; occupant JID en MUC | `conversation-view.component.ts`, `muc-view.component.ts` |
| Misma conversación | `conversationId` bare; `roomJid + sessionGeneration` | mismos archivos |
| Ventana temporal | máximo `20000 ms` (20 segundos) entre mensajes consecutivos | `message-grouping.ts` (`MESSAGE_GROUP_MAX_GAP_MS`) |
| Mismo día local | `messageDayKey` | `message-grouping.ts` |
| Límites | cambio de remitente, conversación, día, clasificación, contexto, fecha inválida o elemento no textual | `canJoin` y `groupConsecutiveMessages` |
| Difusión | no se mezcla con mensajes normales ni se agrupa sin contexto explícito | `canJoin`; `Message.classification` permanece intacto |

`groupMessagesForDisplay` devuelve posiciones `single`, `first`, `middle` y `last`, además de la cabecera y el separador de día. La función es lineal, no muta la colección y conserva las referencias de cada elemento.

## Matriz de tokens y consumidores

| Responsabilidad visual | Token CSS | Consumidor | Ruta |
| --- | --- | --- | --- |
| Burbuja recibida | `--atomic-bubble-incoming` | `.message.incoming` | `src/styles.scss` |
| Burbuja enviada | `--atomic-bubble-outgoing` | `.message`/`.message.outgoing` | `src/styles.scss` |
| Texto de burbuja | `--atomic-text` | contenido y remitente | `src/styles.scss` |
| Remitente recibido | `--atomic-green-soft` | `.message.incoming .message-sender` | `src/styles.scss` |
| Remitente enviado | `--atomic-message-outgoing-text` | `.message.outgoing .message-sender` | `src/styles.scss` |
| Hora y fecha | `--atomic-text-muted` | `.message-time`, separador de cabecera | `src/app/message-item.component.scss` |
| Distintivo de difusión | `--atomic-green` | `.broadcast-badge` | `src/app/message-item.component.scss` |
| Aviso de persistencia | `--atomic-danger` | `.message-persistence-warning` | `src/app/message-item.component.scss` |
| Radio y continuidad | `--atomic-radius-lg` + radios de 5px | `.message` y posiciones de grupo | `src/styles.scss` |

No se añadieron colores hardcodeados ni tokens nuevos. La compactación se limita a espaciado, radios y presentación de la cabecera.

## Cambios

- `src/app/message-grouping.ts`: contrato y funciones puras de agrupación/formato.
- `src/app/message-grouping.spec.ts`: límites temporales, remitente/día, difusión, elementos no agrupables, identidad y posiciones.
- `src/app/conversation-view.component.*`: agrupación de mensajes de texto en conversaciones directas; archivos y stickers rompen la continuidad.
- `src/app/muc-view.component.*`: misma semántica para mensajes de salas.
- `src/app/message-item.component.*`: cabecera de una línea, rango de horas, timestamp accesible oculto en elementos intermedios y clases de posición.
- `src/styles.scss`: burbujas compactas y radios continuos por grupo.

## Verificación

- `npm run typecheck` — correcto.
- `npm run test:angular -- --include src/app/message-grouping.spec.ts --include src/app/message-date-time.spec.ts` — 6 pruebas correctas.
- `npm run build` — correcto; permanece el aviso preexistente del presupuesto inicial (597.56 kB frente a 500 kB).
- `npx eslint` sobre los archivos TypeScript modificados — correcto.
- `git diff --check` — correcto.

No se conectaron servidores XMPP ni se ejecutaron suites históricas completas.
