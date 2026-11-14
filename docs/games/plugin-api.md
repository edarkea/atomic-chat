# API de juegos y extensibilidad

Los contratos puros de reglas son ejecutables en
[`src/app/core/domain/games/`](../../src/app/core/domain/games/). Las interfaces de
registro, host externo, sesiones y transporte que siguen siendo conceptuales no
autorizan todavía integración productiva.

## 1. Identidad y distribución

```ts
type GameCapability = 'invites' | 'replay' | 'resync' | 'score';

interface ExternalGameManifest {
  readonly manifestVersion: 1;
  readonly gameId: string;
  readonly displayName: string;
  readonly version: string;
  readonly apiVersion: 1;
  readonly players: { readonly min: 2; readonly max: 2 };
  readonly capabilities: readonly GameCapability[];
  readonly entrypoint: string;
  readonly assets?: readonly string[];
  readonly permissions: readonly [];
}

interface OfficialGameDescriptor {
  readonly distribution: 'official';
  readonly source: 'built-in';
  readonly gameId: string;
  readonly displayName: string;
  readonly version: string;
  readonly apiVersion: 1;
  readonly players: { readonly min: 2; readonly max: 2 };
  readonly capabilities: readonly GameCapability[];
}

type GameRegistryEntry =
  | (OfficialGameDescriptor & { readonly enabled: boolean })
  | (ExternalGameManifest & {
      readonly distribution: 'external';
      readonly source: 'installed';
      readonly integritySha256: string;
      readonly enabled: boolean;
      readonly installedAt: string;
    });
```

`distribution` no pertenece al manifiesto externo: el usuario puede aportar el archivo,
pero solo Main puede clasificarlo como `external` al registrarlo. `gameId`, `version`,
entrypoint y capacidades se validan desde el manifiesto y el hash de la instalación.
Los descriptores oficiales son código/configuración de Atomic Chat y no un paquete
`.atomicgame` que pueda autodeclararse oficial.

## 2. Sesión y estado

```ts
type GameSessionState =
  | 'invited'
  | 'accepted'
  | 'active'
  | 'paused'
  | 'resync-required'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'finished'
  | 'abandoned'
  | 'closed';

interface GameSessionRef {
  readonly accountId: string;
  readonly conversationId: string;
  readonly peerBareJid: string;
  readonly sessionId: string;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly apiVersion: 1;
  readonly state: GameSessionState;
  readonly sessionGeneration: number;
  readonly lastAcceptedRevision: number;
  readonly lastAcceptedEventId?: string;
  readonly stateHash?: string;
}

interface GameInviteInput {
  readonly version: 1;
  readonly requestId: string;
  readonly accountId: string;
  readonly conversationId: string;
  readonly gameId: string;
  readonly gameVersion?: string;
}
```

`requestId` correlaciona IPC; `eventId` identifica un evento; `sessionId` identifica
la partida; `revision` identifica la versión de estado asignada por el árbitro Main;
`actorSeq` es la secuencia del emisor para deduplicación. Son identidades distintas y
no deben sustituirse entre sí.

## 3. Contrato ejecutable de reglas

```ts
interface GameRules<State, Move, Result> {
  readonly gameId: string;
  readonly gameVersion: string;
  readonly initialState: () => State;
  readonly validateMove: (state: State, move: Move) => RuleResult<void>;
  readonly applyMove: (state: State, move: Move) => RuleResult<State>;
  readonly outcome: (state: State) => Result;
  readonly serializeState: (state: State) => string;
  readonly hashState: (state: State) => string;
}

type RuleResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: GameRuleError };
```

Las implementaciones ejecutables actuales son `ticTacToeRules` y `reversiRules`.
Sus estados usan los roles canónicos `initiator`/`responder`, no una perspectiva local.
No reciben `accountId` real, secretos, sockets, filesystem, IPC, reloj global ni
aleatoriedad implícita. Cara o Cruz expone utilidades puras de commit-reveal, no un
runtime.

El host oficial aplica cuotas operativas de sesiones, eventos,
solicitudes pendientes y deduplicación) antes de invocar una regla. Esas cuotas no
forman parte de una capacidad que el juego pueda ampliar y no habilitan todavía el
runtime de plugins externos.

## 4. Convergencia P2P mínima

La revisión local no se considera consenso entre dos clientes. Para transiciones no
conmutativas, el contrato ejecutable usa un secuenciador lógico fijo: `initiator`
asigna `revision`; cada propuesta incluye `expectedRevision` y `previousStateHash`.
El otro extremo solo aplica un evento secuenciado si la revisión esperada, el hash
previo y el hash resultante son reproducibles. Un hueco se rechaza sin mutar el
snapshot y se reintenta después de recibir el predecesor; duplicados son idempotentes;
eventos tardíos no mutan estado. Si el secuenciador desaparece, el futuro
`GameSessionManager` debe marcar resync/pausa: no hay takeover automático ni se
afirma consenso.

Los commits de Cara o Cruz son la excepción conmutativa: se acumulan como conjunto
por rol, se serializan en orden `initiator`, `responder` y solo producen resultado
cuando ambos reveals verifican sus commits. El orden de llegada no cambia el hash ni
el resultado.

## 5. Host y runtime externo

```ts
interface GameHostAPI {
  readonly apiVersion: 1;
  readonly session: {
    readonly getSnapshot: () => Promise<GameSnapshot>;
    readonly submitMove: (move: unknown) => Promise<Result<void>>;
    readonly requestResync: () => Promise<Result<GameSnapshot>>;
    readonly close: () => Promise<Result<void>>;
  };
  readonly ui: {
    readonly setTitle: (value: string) => void;
    readonly emitReady: () => void;
  };
}
```

Este contrato de extensibilidad no habilita paquetes externos por sí solo. El paquete no debe recibir el
objeto `window.atomicChat`, `ipcRenderer` ni una función de invocación arbitraria. El
host entregará una capacidad de sesión acotada a través de mensajes estructurados;
cada mensaje se validará antes de entrar en Main. Para reglas externas potencialmente
no confiables, la UI puede proponer movimientos, pero solo un árbitro verificable
puede convertirlos en snapshot y puntuación confiables. En P2P sin árbitro central,
un resultado externo no verificable debe marcarse recreativo/no verificado.

## 6. Eventos de dominio

```ts
interface GameSessionChangedPayload {
  readonly accountId: string;
  readonly conversationId: string;
  readonly session: GameSessionRef;
  readonly snapshot?: GameSnapshot;
}

interface GameSnapshot {
  readonly sessionId: string;
  readonly revision: number;
  readonly stateHash: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly updatedAt: string;
}

interface GameEventEnvelope {
  readonly protocolVersion: 1;
  readonly eventId: string;
  readonly sessionId: string;
  readonly correlationId?: string;
  readonly kind: string;
  readonly actor: 'initiator' | 'responder' | 'host';
  readonly actorSeq: number;
  /** Assigned by Main after validation; never trusted from a remote peer. */
  readonly revision: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly resultingStateHash?: string;
}
```

El `DomainEvent` general existente aporta `version`, `eventId`, `type` y
`correlationId`; el payload de juegos añade cuenta, conversación, sesión, actor,
`actorSeq`, `revision` y hash. Main serializa los eventos aceptados y asigna
`revision`. Para eventos concurrentes se conserva el `eventId` y se ordena el
conjunto aceptado por `(revision, actor, actorSeq, eventId)`; el orden de llegada no
decide el resultado. El validador Renderer rechaza eventos malformados antes de que
un store los vea.

Los snapshots puros actuales son específicos de cada juego (`TicTacToeState` y
`ReversiState`) y se serializan como bytes canónicos length-prefixed antes de aplicar
SHA-256. `GameSnapshot` sigue siendo un contrato de transporte futuro, no un objeto
dinámico que las reglas deban producir.

## 7. Errores mínimos

Se recomienda extender deliberadamente `AppErrorCode` con códigos de juegos, o mapearlos a una categoría estable si se decide no ampliar el union:

```ts
type GameErrorCode =
  | 'GAME_NOT_INSTALLED'
  | 'GAME_VERSION_UNSUPPORTED'
  | 'GAME_SESSION_NOT_FOUND'
  | 'GAME_SESSION_CONFLICT'
  | 'GAME_INVITE_EXPIRED'
  | 'GAME_NOT_YOUR_TURN'
  | 'GAME_INVALID_MOVE'
  | 'GAME_SEQUENCE_GAP'
  | 'GAME_STATE_MISMATCH'
  | 'GAME_PEER_MISMATCH'
  | 'GAME_PLUGIN_INVALID'
  | 'GAME_PLUGIN_FAULT'
  | 'GAME_ROUND_INCOMPLETE'
  | 'GAME_RESOURCE_LIMIT';
```

Mensajes para usuarios no deben incluir XML crudo, paths locales, stack traces, URLs privadas ni información del paquete que permita revelar secretos.

## 8. Compatibilidad y versionado

- `apiVersion` versiona el contrato host-juego.
- `gameVersion` versiona las reglas y UI de un juego.
- `manifestVersion` versiona el formato de paquete.
- `protocol namespace` versiona el wire protocol XMPP.
- No se debe aceptar una versión mayor desconocida; una versión menor solo puede aceptarse si el manifiesto declara compatibilidad.
- La renegociación ocurre antes de `accepted`; una partida ya activa no cambia de reglas silenciosamente.

## 9. Autoridad y resultados

El host Main conserva la sesión y el último snapshot aceptado. El juego propone
movimientos; el manager valida la forma, identidad, `actorSeq`, turno y hash, y asigna
la `revision`. El Renderer nunca convierte por sí solo una propuesta remota en
resultado.

- En juegos oficiales, las reglas confiables viven en Main o en un módulo puro
  compartido que no recibe capacidades del host.
- En juegos externos, el plugin solo presenta UI y propone acciones. No puede declarar
  puntos, finalizar una ronda ni escribir el snapshot canónico; Main verifica y
  persiste el resultado, o marca `unverified`/`plugin-fault`.
- Cara o Cruz usa commit-reveal verificado por Main. Una ronda sin los dos reveals es
  `round-incomplete`: no asigna puntos y requiere timeout, abandono explícito o
  rematch según la política acordada.

## 10. Codificación canónica y Cara o Cruz

Para evitar ambigüedad por separadores, espacios, locale o JSON, la codificación
canónica de campos es una secuencia fija de valores UTF-8, cada uno precedido por su
longitud `uint32` big-endian. El orden forma parte del protocolo:

```text
encode(fields) = concat(uint32be(byteLength(utf8(field))) || utf8(field))
commit = SHA-256(encode([
  "atomic-chat:coinflip:commit", protocolVersion, gameId, gameVersion,
  sessionId, roundId, actor, choice, nonce
]))
```

`choice` es exactamente `heads` o `tails`; `nonce` es un valor aleatorio local,
opaco y no reutilizable. Tras verificar ambos commits y reveals, Main calcula:

```text
coin = SHA-256(encode([
  "atomic-chat:coinflip:result", protocolVersion, sessionId, roundId,
  initiatorNonce, responderNonce
]))[0] & 1
```

`0` y `1` se asignan a las caras en el contrato del juego. Los nonces se ordenan por
rol (`initiator`, `responder`), no por llegada. Un reveal que no coincide con su
commit es inválido; no se reconcilian puntos silenciosamente.
