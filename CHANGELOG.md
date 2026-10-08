# Cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
proyecto usa [versionado semántico](https://semver.org/lang/es/).

## [1.0.0] - 2026-10-07

Primera versión como proyecto independiente. Reemplaza a la extensión de
`assets/extension` del repositorio principal y mantiene su protocolo: el núcleo
de G-Mini Agent no necesita cambios.

### Añadido

- Paquetes para Chromium (Chrome, Edge, Brave, Opera, Vivaldi, Arc, Yandex) y
  Firefox 140+, generados desde un manifiesto base; instrucciones para convertirla
  a Safari.
- Popup con el estado de la conexión (Conectado, Reconectando, Sin app, Error, En
  pausa), "Probar conexión", dirección del servidor y las últimas 20 acciones.
- Página de opciones: pausar, puerto, dirección completa, servidores remotos con
  confirmación, borrar actividad, diagnóstico y restablecer.
- Reconexión con espera exponencial (1 s a 30 s), keepalive cada 20 s y alarma de
  vigilancia para el service worker de Manifest V3.
- Detección de otra instancia conectada: la extensión no compite por la conexión y
  ofrece "Conectar aquí".
- Insignia ON en el icono mientras G-Mini Agent controla el navegador.
- Validación de todos los mensajes del núcleo contra la lista de comandos
  permitidos y un esquema de parámetros por comando.
- Soporte de editores `contenteditable` en `type` y `fill`, combinaciones de
  teclas en `press` y estados `attached`/`detached` en `wait_for`.
- Pruebas unitarias, prueba de humo con Puppeteer contra un núcleo simulado y
  contra el núcleo real, y flujos de CI y publicación.

### Cambiado

- `tabs_list` devuelve `count`, `tab_close` devuelve `remaining_tabs` y
  `screenshot` devuelve `url` y `title`, que el planner del núcleo ya leía.
- `eval` se ejecuta en el mundo principal de la página con
  `scripting.executeScript` y devuelve valores serializables. Si la CSP de la
  página lo prohíbe, responde "Esta página no permite ejecutar código (CSP); usa
  browser_extract o browser_snapshot".
- `page_info` mide el viewport sin depender de `eval`.
- `go_back` y `go_forward` usan `history.back()`/`forward()` cuando Chromium omite
  la entrada anterior porque la página no recibió interacción del usuario.
- `navigate` y `tab_new` completan el esquema que falte y responden antes de que
  venza el plazo del núcleo.
- El content script se inyecta solo cuando el agente opera una página.
- Permisos mínimos: se quitan `cookies`, `webNavigation`, `activeTab` y los
  recursos accesibles desde la web.

### Corregido

- `eval` fallaba siempre en Chromium: Manifest V3 bloquea `new Function` en el
  content script.
- `fill` en `textarea` fallaba con "Illegal invocation".
- `wait_for` no veía elementos `position: fixed` y cortaba esperas de más de 15 s.
- Enter en un formulario no lo enviaba.
- Con el service worker dormido, la extensión dejaba de intentar reconectar.

### Seguridad

- Solo se conecta a direcciones locales salvo permiso explícito.
- `navigate` rechaza `javascript:` y `vbscript:`.
- `eval` queda aislado en `src/background/page-script.js` y nunca evalúa texto
  dentro de la extensión.

[1.0.0]: https://github.com/angelgabrieljacintohuayllasco/G-Mini-Agent-Extension/releases/tag/v1.0.0
