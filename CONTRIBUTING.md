# Cómo contribuir

## Entorno

- Node.js 22.12 o superior (`.nvmrc`).
- `npm ci` instala solo herramientas de desarrollo: la extensión no tiene
  dependencias en tiempo de ejecución.

```sh
npm run build       # dist/chromium, dist/firefox y los zips
npm run check:dist  # valida manifiestos y zips
npm run lint
npm test
```

Para probar a mano, carga `dist/chromium` como extensión descomprimida o
`dist/firefox/manifest.json` como complemento temporal y ejecuta `npm run build`
después de cada cambio (y recarga la extensión).

## Prueba de extremo a extremo

`tests/e2e/smoke.mjs` carga `dist/chromium` en un Chromium sin interfaz con un
perfil temporal, apunta la extensión a un puerto libre (nunca al 8765 de una app
abierta) y recorre todos los comandos, el popup y las opciones. Deja capturas en
`tests/e2e/.output/`.

```sh
CHROME_PATH=/ruta/a/chrome npm run test:e2e
CHROME_PATH=/ruta/a/chrome GMINI_CORE_DIR=/ruta/a/G-Mini-Agent npm run test:e2e -- --core=real
```

- Chrome estable 137+ ignora `--load-extension`. Sirven Chrome for Testing,
  Chromium, Edge y Brave.
- `--core=real` arranca el núcleo con `python -m backend.main --headless`, un
  `GMINI_HOME` temporal y un token propio, y envía las acciones por
  `POST /api/actions/execute`. Usa `GMINI_CORE_PYTHON` si el intérprete no está en
  `venv/` del repositorio del núcleo. El núcleo escribe sus logs en su propia
  carpeta `logs/` aunque haya `GMINI_HOME`; la prueba avisa qué archivos dejó.
- Para Firefox: `npx web-ext lint --source-dir dist/firefox`. El único aviso
  esperado es `DANGEROUS_EVAL`.

## Reglas del proyecto

- **Compatibilidad con el núcleo.** Los nombres de eventos, comandos, parámetros
  y campos de respuesta de [docs/protocol.md](docs/protocol.md) son un contrato.
  Solo se añaden campos; nunca se renombran ni se quitan. Los mensajes de error
  del protocolo se mantienen en inglés.
- **Un comando nuevo** necesita: entrada en `COMMAND_SPECS`
  (`src/shared/protocol.js`), manejador en `src/background/commands/index.js`,
  etiqueta en `src/shared/activity.js`, fila en `docs/protocol.md` y pruebas. Las
  pruebas unitarias fallan si alguna lista no coincide.
- **Sin `eval` nuevo.** `src/content/run-page-script.js` es el único punto que
  convierte texto en código.
- **Sin HTML crudo** en la interfaz: `createElement` y `textContent`.
- **Diseño.** Solo valores de `src/ui/tokens.css`; iconos SVG con trazo de Lucide
  (2 px); revisa los dos temas y `prefers-reduced-motion`.
- **Sin emojis** en código, interfaz, documentación ni commits.
- Textos de interfaz y documentación en español; identificadores en inglés.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/) en español:

```
feat(popup): muestra el tiempo hasta el próximo intento
fix(content): wait_for detecta elementos con position fixed
docs: documenta la conversión a Safari
```

Tipos habituales: `feat`, `fix`, `docs`, `test`, `build`, `ci`, `refactor`,
`chore`. Un cambio lógico por commit.

## Publicar una versión

1. Actualiza `version` en `package.json` y añade la sección en `CHANGELOG.md`.
2. `git tag v<versión>` y sube la etiqueta.
3. El flujo `release.yml` valida, construye y adjunta los dos zips a la Release
   con las notas de esa versión del changelog.
