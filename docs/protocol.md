# Protocolo extensión ⇄ núcleo

Contrato entre la extensión G-Mini Agent Bridge y el núcleo de G-Mini Agent. Se
deriva de `backend/automation/extension_bridge.py` (clase `ExtensionBridge`) y de
cómo lo usa `backend/automation/browser_controller.py` en el repositorio
principal. La versión 1.0.0 de la extensión es compatible con ese código sin
cambios en el núcleo.

## 1. Transporte

| Aspecto | Valor |
|---|---|
| URL | `ws://127.0.0.1:8765/ws/extension` (configurable) |
| Frames | Texto, un objeto JSON UTF-8 por frame |
| Sobre | `{"event": "<nombre>", "data": { ... }}` |
| Clientes | Uno. Si se conecta otro, el núcleo cierra el anterior con código 1000 |
| Autenticación | No hay token en este socket |

El núcleo rechaza la conexión antes de aceptarla (HTTP 403) si:

- la cabecera `Host` no es `127.0.0.1:<puerto>`, `localhost:<puerto>` o
  `[::1]:<puerto>` cuando escucha en loopback;
- el `Origin` es una página web. Acepta `chrome-extension://`,
  `moz-extension://` y `safari-web-extension://`, que es lo que envían
  Chromium, Firefox y Safari desde el contexto de fondo de una extensión.

## 2. Eventos

### Extensión → núcleo

| Evento | Cuándo | `data` |
|---|---|---|
| `ext:hello` | Al abrir el socket | Ver 2.1 |
| `ext:response` | Respuesta a cada `ext:command` | `{"id", "success", ...}` (sección 3) |
| `ext:ping` | Cada 20 s mientras hay conexión | `{"ts": <ms>}` |
| `ext:pong` | Respuesta a `ext:ping` del núcleo | `{"ts": <ms>}` |

El núcleo registra `ext:hello`, resuelve `ext:response` por `id` e ignora
`ext:ping` (solo lo anota en el nivel debug). El ping existe para mantener vivo el
service worker de Manifest V3.

### Núcleo → extensión

| Evento | `data` |
|---|---|
| `ext:command` | `{"id": "<12 hex>", "command": "<nombre>", "params": {...}}` |
| `ext:ping` | Cualquier objeto. La extensión contesta `ext:pong` |

Cualquier otro evento se descarta sin respuesta.

### 2.1 `ext:hello`

Los cuatro primeros campos son los de la extensión anterior y los que lee el
núcleo. El resto es aditivo.

```json
{
  "extensionId": "kmoooophmghlnnjgbfglcfkghelmdlfi",
  "tabUrl": "https://example.com/",
  "tabTitle": "Example Domain",
  "userAgent": "Mozilla/5.0 ...",
  "extensionVersion": "1.0.0",
  "browser": { "name": "Microsoft Edge", "version": "154" },
  "build": "chromium",
  "commands": ["navigate", "go_back", "..."]
}
```

## 3. Comandos

Toda respuesta es `{"event": "ext:response", "data": {...resultado, "id": <id del
comando>}}`. `id` siempre es el del comando: ningún resultado puede
reemplazarlo. `success` siempre es booleano. En error: `{"id", "success": false,
"error": "<texto>"}`.

La columna "Acción del agente" indica qué acción del planner llega a cada comando
a través de `BrowserController`. El núcleo espera 15 s por comando salvo donde se
indica.

| Comando | Acción del agente | Parámetros (por defecto) | Respuesta |
|---|---|---|---|
| `navigate` | `browser_navigate` | `url` | `url`, `title`, `status` |
| `go_back` | `browser_go_back` | | `url`, `title`, `status` |
| `go_forward` | `browser_go_forward` | | `url`, `title`, `status` |
| `wait_load` | `browser_wait_load` | `timeout_ms` (30000; el núcleo espera `timeout_ms`/1000 + 2 s) | `url`, `title`, `status` |
| `click` | `browser_click`, `browser_force_click` | `selector`, `force` (false) | `tag`, `text` |
| `type` | `browser_type` | `selector`, `text`, `clear` (true) | `typed` |
| `fill` | `browser_fill` | `selector`, `text` | `filled` |
| `press` | `browser_press` | `key` | `key` |
| `scroll` | `browser_scroll` | `direction` (down), `amount` (3; 300 px por unidad) | `scrollX`, `scrollY`, `target` |
| `hover` | `browser_hover` | `selector` | `tag` |
| `select` | `browser_select` | `selector`, `value` | `selectedValue` |
| `wait_for` | `browser_wait_for` | `selector`, `timeout_ms` (15000), `state` (visible) | `found`, `waited_ms` |
| `remove_overlays` | `browser_remove_overlays` | | `removed_elements` |
| `extract` | `browser_extract` | `selector` (body) | `text` (hasta 8000 caracteres) |
| `get_dom` | skill `browser_get_dom` | `selector` (body), `max_depth` (6), `max_length` (12000) | `html` |
| `snapshot` | `browser_snapshot` | | `url`, `title`, `text` |
| `eval` | `browser_eval` | `script` | `result` (valor serializable o null) |
| `screenshot` | `browser_screenshot` | (el núcleo espera 10 s) | `image_base64` (PNG sin prefijo), `format`, `url`, `title` |
| `page_info` | `browser_page_info`, `browser_state` | | `url`, `title`, `viewport: {width, height}` |
| `tabs_list` | `browser_tabs` | | `tabs: [{index, id, url, title, active}]`, `count` |
| `tab_switch` | `browser_switch_tab` | `index` | `index`, `url`, `title` |
| `tab_new` | `browser_new_tab` | `url` (about:blank) | `index`, `tab_id`, `url`, `title` |
| `tab_close` | `browser_close_tab` | `index` (activa) | `closed_index`, `remaining_tabs` |
| `downloads_list` | | `limit` (20) | `downloads: [{id, filename, url, state, fileSize, startTime, endTime, mime}]`, `count` |

Notas:

- **Selectores**: `"a, b, c"` se prueba en el orden escrito y gana el primero que
  encuentre algo. Las comas dentro de `[...]`, `(...)` o comillas no separan.
- **Pestañas**: el objetivo es la pestaña activa de la última ventana enfocada;
  `index` es la posición en esa ventana.
- **`wait_for`**: `state` acepta `visible`, `hidden`, `attached` y `detached`.
  `hidden` también se cumple si el elemento no existe.
- **`press`**: acepta los alias de la extensión anterior (`enter`, `tab`,
  `escape`, `space`, `arrowdown`...) y combinaciones como `Control+a`. Si la
  página no cancela el `keydown`, Enter envía el formulario (`requestSubmit`) o
  activa el botón con foco, Espacio activa botones y casillas, y Tab mueve el foco.
- **`navigate` y `tab_new`**: si falta el esquema se completa (`example.com` →
  `https://example.com/`, `localhost:3000` → `http://localhost:3000/`). Se
  rechazan `javascript:` y `vbscript:` con `Blocked URL scheme: <esquema>`.
- **Plazos**: `navigate` y `tab_new` responden a los 13,5 s como máximo, con el
  estado que tenga la pestaña, para que el núcleo reciba la URL en vez de un
  TimeoutError. `type` escribe textos largos por bloques para terminar en unos 8 s.

### 3.1 `eval`

El script corre en el **mundo principal de la página**, con
`scripting.executeScript({target: {tabId}, world: "MAIN", func, args: [script]})`
(`src/background/page-script.js`, el único lugar que convierte texto en código).
Manifest V3 prohíbe evaluar texto dentro de la extensión, incluido el mundo
aislado del content script; por eso la extensión anterior fallaba siempre en
Chromium.

- **Contrato**: el texto es el cuerpo de una función `async`, así que solo
  devuelve un valor si usa `return` (`"return document.title"`). Respuesta
  `{"success": true, "result": <valor>}` con cualquier valor serializable en JSON
  (texto, número, booleano, lista, objeto); `undefined` llega como `null` y lo que
  no se puede serializar (ciclos, BigInt), como texto. Chromium entrega los
  objetos con las claves ordenadas.
- **Contexto**: ve el DOM y las variables de JavaScript de la página, con los
  permisos de la página y ninguno de la extensión.
- **CSP**: si la página tiene una política sin `'unsafe-eval'` (o exige Trusted
  Types), la respuesta es `{"success": false, "error": "Esta página no permite
  ejecutar código (CSP); usa browser_extract o browser_snapshot", "code":
  "csp_blocked"}`.
- **Errores del script**: `Eval error: <mensaje>` (sintaxis o excepción).
- **Plazo**: si el script no termina en 14 s, `Eval error: the script did not
  finish within 14000ms`.
- **Permisos**: usa `scripting` y los permisos de host que la extensión ya tenía.
  En Firefox, `world: "MAIN"` existe desde la versión 128 (el mínimo es 140).
- **Aprobación**: con la autonomía por defecto, el núcleo pide aprobación humana
  antes de un `browser_eval` que no clasifica como de solo lectura.

### 3.2 Mensajes de error

Se mantienen en inglés y con el mismo texto que la extensión anterior, porque el
núcleo y el agente los leen tal cual. La excepción es el error de CSP de `eval`,
que el núcleo pidió en español:

| Situación | `error` |
|---|---|
| Comando fuera de la lista | `Unknown command: <nombre>` |
| Parámetros inválidos | `Invalid params for '<comando>': '<campo>' is required` (o `must be a string`, `must be an integer`...) |
| Elemento inexistente | `Element not found: <selector>` |
| `select` sin `<select>` | `Select element not found: <selector>` |
| Opción inexistente | `Option not found: <valor>` |
| Elemento no editable (`type`, `fill`) | `Element is not editable: <selector>` |
| Espera vencida | `Timeout waiting for '<selector>' (<ms>ms)` |
| Pestaña fuera de rango | `Tab index <n> out of range (0-<max>)` |
| Última pestaña | `Cannot close the last tab` |
| Sin pestaña activa | `No active tab found` |
| Historial sin entrada | `Cannot find a next page in history.` |
| Página interna del navegador | `Cannot access this page (<origen>): <detalle>` |
| Content script sin respuesta | `Content script timeout for '<acción>' after <ms>ms` |
| URL rechazada | `Blocked URL scheme: <esquema>` o `Invalid URL: <texto>` |
| `eval` en una página con CSP sin `'unsafe-eval'` | `Esta página no permite ejecutar código (CSP); usa browser_extract o browser_snapshot` (con `code: "csp_blocked"`) |
| `eval` fallido o sin terminar | `Eval error: <detalle>` |
| Captura fallida | `Screenshot failed: <detalle>` |

## 4. Validación

Antes de tocar el navegador, cada mensaje pasa por `src/shared/protocol.js`:

1. Frames binarios, JSON inválido, frames de más de 4 MiB o sin `event`: se
   descartan.
2. `ext:command` sin `id` de texto (1 a 128 caracteres): se descarta, porque no hay
   a quién responder.
3. Comando fuera de la lista de la sección 3: `Unknown command`.
4. Parámetros: se validan contra un esquema por comando. Se conservan las
   tolerancias de la extensión anterior: números y booleanos escritos como texto
   se convierten, el 0 cuenta como ausente donde antes se usaba `valor || defecto`,
   los valores fuera de rango se acotan y una opción desconocida toma el valor por
   defecto. Los parámetros desconocidos se ignoran.

## 5. Ciclo de vida de la conexión

| Situación | Comportamiento |
|---|---|
| Arranque, instalación o inicio del navegador | Conecta si está habilitada |
| Conexión rechazada o perdida | Reintenta a 1, 2, 4, 8, 16 y 30 s (±20 % de variación), después cada 30 s |
| Sin respuesta al conectar | Corta el intento a los 10 s y reintenta |
| Conexión abierta | `ext:ping` cada 20 s |
| Service worker detenido por el navegador | Una alarma lo despierta cada 30 s y reconecta |
| El núcleo cierra con 1000 | Otra instancia tomó la conexión: no reconecta sola (estado Error, botón "Conectar aquí") |
| En pausa | Cierra el socket y no reintenta |

El caso del cierre con 1000 evita un bucle: si la extensión está en dos
navegadores o perfiles a la vez, cada reconexión expulsaría a la otra.

## 6. Diagnóstico HTTP

"Probar conexión" no abre otro WebSocket (expulsaría al actual). Consulta la ruta
pública `GET /api/health` del núcleo (y `/api/v1/health` si la primera no existe),
derivada de la dirección configurada (`ws:` → `http:`, `wss:` → `https:`). Con
eso distingue un núcleo cerrado de uno que responde pero rechaza el WebSocket.

## 7. Cambios respecto de la extensión anterior

Todos los cambios son compatibles: el núcleo no necesita modificaciones.

| Cambio | Motivo |
|---|---|
| `tabs_list` añade `count`, `tab_close` añade `remaining_tabs` y `closed_index`, `screenshot` añade `url` y `title` | El planner lee `data['count']`, `data['remaining_tabs']` y `data['url']`; con la extensión anterior esas acciones fallaban con KeyError |
| `eval` corre en el mundo principal de la página y devuelve valores serializables | En el content script, Manifest V3 bloqueaba siempre `new Function`; ahora solo falla si la propia página lo prohíbe por CSP, con un error que lo explica |
| `page_info` mide el viewport con una acción propia | Antes usaba `eval`, que no devolvía valor y además estaba bloqueado |
| `go_back`/`go_forward` recurren a `history.back()`/`forward()` en la página | Chromium omite en `tabs.goBack` las páginas abandonadas sin interacción del usuario, que son casi todas las que abre el agente |
| `fill` en `textarea` | La extensión anterior lanzaba "Illegal invocation" |
| `type` y `fill` en editores `contenteditable` | Gmail, WhatsApp Web o Notion no tienen `value` |
| `wait_for` con elementos `position: fixed` | `offsetParent` es null aunque se vean |
| `wait_for` con plazos mayores de 15 s | El mensaje al content script se cortaba antes |
| `navigate` y `tab_new` completan el esquema y rechazan `javascript:` | Sin esquema se abría una página de error de la extensión |
| Reconexión con backoff y alarma de vigilancia | Con el reintento fijo de 3 s el service worker dormido dejaba de reconectar |
| Content script inyectado bajo demanda | No se ejecuta nada en las páginas que el agente no toca |
| Sin permisos `cookies`, `webNavigation` ni `activeTab`, sin `web_accessible_resources` | No se usaban |
