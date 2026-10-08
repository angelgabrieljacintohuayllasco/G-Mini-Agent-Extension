# Seguridad

## Versiones con soporte

| Versión | Soporte |
|---|---|
| 1.0.x | Sí |

## Reportar una vulnerabilidad

No abras un issue público. Usa el reporte privado de GitHub en la pestaña
**Security** del repositorio ("Report a vulnerability"). Incluye la versión de la
extensión, el navegador y los pasos para reproducirlo. La primera respuesta llega
en un plazo de 7 días.

## Modelo de amenazas

La extensión le da al núcleo de G-Mini Agent control del navegador: abrir páginas,
leer su contenido, escribir en formularios y tomar capturas, con las sesiones
iniciadas de la persona. Por eso:

1. **Quién puede dar órdenes.** Solo el servidor configurado. Por defecto se
   aceptan únicamente `127.0.0.1`, `localhost` y `[::1]`; un servidor remoto exige
   activarlo en Opciones y confirmar un aviso, y el fondo vuelve a comprobar esa
   política aunque la interfaz ya lo haya hecho. El núcleo, a su vez, rechaza
   conexiones cuyo `Origin` sea una página web.
2. **Qué se puede pedir.** Solo los 24 comandos del protocolo
   ([docs/protocol.md](docs/protocol.md)). Cada mensaje se valida antes de tocar el
   navegador: tamaño, `id`, nombre del comando y parámetros. Lo demás se descarta o
   recibe `Unknown command`.
3. **Ejecución de código.** El único punto que convierte texto en código es el
   comando `eval`, en `src/background/page-script.js`. El script se inyecta con
   `scripting.executeScript` en el mundo principal de la página: tiene los permisos
   de esa página (y su CSP decide si puede evaluar código), pero ningún acceso a la
   extensión ni a sus APIs. Nunca se evalúa texto dentro de la extensión. Las reglas
   `no-eval` y `no-new-func` de ESLint y una prueba unitaria impiden añadir otros
   puntos. El núcleo, además, pide aprobación humana para scripts que no son de
   solo lectura.
4. **Navegación.** `navigate` y `tab_new` rechazan `javascript:` y `vbscript:`,
   para que no sirvan de atajo al comando `eval`.
5. **Interfaz.** CSP `script-src 'self'; object-src 'self'; base-uri 'none';
   form-action 'none'`. El popup y las opciones construyen el DOM con
   `textContent`; asignar `innerHTML` está prohibido por ESLint.
6. **Mensajes internos.** El fondo solo atiende mensajes de las páginas de la
   propia extensión, y el content script solo los de su extensión.
7. **Superficie en las páginas.** Ningún script se declara para todas las páginas:
   el content script se inyecta solo en la pestaña que el agente opera. No hay
   recursos accesibles desde la web.
8. **Datos guardados.** Ajustes en `storage.local`; la actividad, en
   `storage.session` (memoria), sin texto escrito, sin scripts y con las URL sin
   parámetros.

## Fuera del alcance

- Lo que el núcleo de G-Mini Agent hace con los datos que recibe (por ejemplo,
  enviarlos a un proveedor de modelos). Se configura en G-Mini Agent.
- Un atacante con acceso a la cuenta del sistema operativo: puede iniciar su
  propio servidor en `127.0.0.1:8765` antes que G-Mini Agent. Cierra G-Mini Agent
  si no lo usas o pausa la extensión.
