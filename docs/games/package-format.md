# Formato `.atomicgame`

## 1. Objetivo

Un `.atomicgame` es un archivo local elegido por el usuario. No es una tienda, no se descarga automáticamente y no modifica ni recompila Atomic Chat.

**Estado:** `PROPUESTA_DE_DISEÑO`; no hay instalador actual en el repositorio.

## 2. Contenedor propuesto

Contenedor ZIP con contenido declarativo:

```text
example.atomicgame
├── manifest.json
├── ui/index.html
├── ui/main.js
├── ui/main.css
├── assets/...
└── integrity.json             (opcional si se adopta firma)
```

El paquete no puede incluir módulos nativos, ejecutables, symlinks, rutas absolutas, archivos fuera de su raíz, preload propio ni dependencias npm instalables. `manifest.json` debe ser pequeño, UTF-8 y validado antes de extraer el resto.

El repositorio no contiene un parser ZIP ni una dependencia declarada para este flujo. `PENDIENTE_VALIDACION`: seleccionar un parser mínimo y auditar límites, o adoptar una capacidad de plataforma aprobada. No se debe añadir una dependencia grande solo para el prototipo sin medición.

## 3. Manifiesto mínimo

```json
{
  "manifestVersion": 1,
  "gameId": "com.example.coinflip",
  "displayName": "Cara o Cruz",
  "version": "1.0.0",
  "apiVersion": 1,
  "entrypoint": "ui/index.html",
  "players": { "min": 2, "max": 2 },
  "capabilities": ["invites", "resync", "score"],
  "permissions": []
}
```

El manifiesto externo no contiene `distribution`: Main lo registra como `external`
después de validar la instalación. Un manifiesto nunca puede autodeclararse `official`.
El host ignora o rechaza campos desconocidos que intenten ampliar autoridad.
`gameId`, `entrypoint`, versiones, límites y nombres se validan con longitudes máximas
y caracteres permitidos. El registro expone el objeto normalizado definido en
[`plugin-api.md`](plugin-api.md), con `source: "installed"`, hash y estado de activación.

## 4. Integridad y autenticidad

- Calcular SHA-256 del archivo completo antes de instalar.
- Persistir hash, tamaño, versión, fecha e instalación en Main.
- La misma versión con hash diferente requiere confirmación explícita y no sobrescribe activamente una partida.
- Un hash solo demuestra integridad respecto del archivo seleccionado, no quién lo publicó.
- `PENDIENTE_VALIDACION`: firma digital y lista de claves confiables para releases oficiales de terceros. Nunca presentar un paquete solo hasheado como confiable.

## 5. Instalación manual

```text
selección de archivo
  → Main valida sender y extensión/tamaño
  → lee manifest sin ejecutar código
  → verifica versión/API/players/permisos
  → extrae a games/.staging/<random> con límites
  → rechaza traversal, symlink, duplicado, ejecutable o exceso
  → valida integridad de archivos
  → renombra atómicamente a games/<gameId>/<version>/<hash>
  → registra instalación en SQLite
  → actualiza GameRegistry
```

La extracción debe ocurrir exclusivamente en Main, bajo el `userData` de Atomic Chat, con directorio temporal aleatorio y limpieza en error. Nunca se debe ejecutar el entrypoint durante la instalación.

## 6. Desinstalación y actualización

- No desinstalar un juego con sesiones activas sin cerrar o marcar esas sesiones.
- La desinstalación elimina el registro y la carpeta exacta de esa instalación; no usa rutas calculadas sin comprobar que están dentro de `games/`.
- Una actualización manual instala una versión nueva en una carpeta inmutable, valida y cambia el puntero activo de forma atómica.
- Mantener la versión anterior hasta que las sesiones que la usan terminen o hasta una limpieza explícita.
- No hay actualización automática, catálogo remoto ni migración silenciosa de partidas.

## 7. Compatibilidad

| Situación                           | Resultado                                  |
| ----------------------------------- | ------------------------------------------ |
| `manifestVersion` mayor             | Rechazar como incompatible.                |
| `apiVersion` mayor                  | Rechazar y conservar instalación anterior. |
| Juego ya instalado con mismo hash   | Operación idempotente.                     |
| Misma versión con hash distinto     | Conflicto y confirmación explícita.        |
| Entry point ausente o fuera de raíz | Rechazar.                                  |
| Permiso distinto de lista vacía     | Rechazar.                                  |
| Paquete corrupto o incompleto       | Rechazar y limpiar staging.                |

## 8. Almacenamiento

La migración futura puede añadir `game_packages`/`game_installations` con `game_id`, `version`, `sha256`, `path_key`, `enabled`, `installed_at` y `last_error`. No guardar el path absoluto como contrato del Renderer; Main lo deriva y vuelve a validar.

## 9. Parser y límites del ZIP

El cliente actual no instala paquetes ni modifica el runtime de producción. Antes de
implementar instalación se debe seleccionar una librería ZIP mantenida o una capacidad
de plataforma que permita inspeccionar entradas sin ejecutar código y validar, como
mínimo:

- número de entradas, tamaño comprimido y descomprimido por archivo y total;
- nombres normalizados sin rutas absolutas, `..`, backslashes ambiguos o symlinks;
- tipo regular de cada entrada, ausencia de ejecutables y ausencia de enlaces;
- límite de profundidad, ratio de expansión y cancelación/limpieza en error;
- lectura de `manifest.json` antes de extraer recursos y hash del archivo original.

La implementación debe ejecutarse solo en Main, con staging aleatorio dentro de
`userData`, y eliminar staging de forma segura ante cualquier fallo. El `.atomicgame`
no es un instalador ni activa fetchs, catálogo remoto o dependencias npm.

## 10. Coste y validaciones pendientes

- `PENDIENTE_VALIDACION`: tiempo de lectura/extracción y tamaño temporal máximo.
- `PENDIENTE_VALIDACION`: coste de una vista renderer por partida externa frente a compartir una vista.
- La política de CSP, navegación, popup, permisos, red y recursos locales debe
  comprobarse en Electron 45.2.2 antes de habilitar instalaciones externas.
- `PENDIENTE_VALIDACION`: limpieza segura de instalaciones huérfanas después de cierre inesperado.
