/**
 * Ejecución del comando `eval` (la acción `browser_eval` del agente).
 *
 * Es el ÚNICO lugar de la extensión que convierte texto en código, y debe
 * seguir siéndolo. Se conserva exactamente el mecanismo de la extensión
 * original para no cambiar el contrato con el núcleo:
 *
 *   - el texto se envuelve como cuerpo de una función async, así que solo
 *     devuelve un valor si el script usa `return` ("return document.title");
 *   - el resultado se convierte a texto, y `undefined` se devuelve como null;
 *   - corre en el mundo aislado del content script: ve el DOM de la página
 *     pero no sus variables de JavaScript.
 *
 * El navegador puede bloquearlo: la política de seguridad de Manifest V3 para
 * los content scripts no incluye 'unsafe-eval' en Chromium. En ese caso el
 * núcleo recibe {success: false, error: "Eval error: ..."}, igual que con la
 * extensión anterior. Ver docs/protocol.md.
 *
 * Las reglas no-eval y no-new-func de ESLint siguen activas en el resto del
 * proyecto; esta excepción está acotada a la línea marcada.
 */
export async function runPageScript(script) {
  // eslint-disable-next-line no-new-func -- comando eval del núcleo; ver el comentario del módulo
  const run = new Function(`return (async () => { ${script} })()`);
  const value = await run();
  return value === undefined ? null : String(value);
}
