/**
 * Comando `eval` (la acción `browser_eval` del agente).
 *
 * Es el ÚNICO lugar de la extensión que convierte texto en código, y debe
 * seguir siéndolo. Manifest V3 prohíbe evaluar texto dentro de la extensión,
 * así que el script se ejecuta en el mundo principal de la página
 * (scripting.executeScript con world: 'MAIN'): ve el DOM y las variables de
 * JavaScript de la página, con los permisos de la página y ninguno de la
 * extensión.
 *
 * Contrato con el núcleo, el mismo de la extensión anterior:
 *   - el texto es el cuerpo de una función async, así que devuelve un valor
 *     solo si usa `return` ("return document.title");
 *   - éxito: {success: true, result} con un valor serializable (undefined -> null);
 *   - fallo: {success: false, error}.
 * Si la CSP de la página no admite 'unsafe-eval', el error lo dice y sugiere
 * acciones que no necesitan ejecutar código.
 *
 * Las reglas no-eval y no-new-func de ESLint siguen activas en el resto del
 * proyecto; la excepción está acotada a la línea marcada.
 */
import { describePageOrigin } from './page-relay.js';
import { getActiveTab } from './tabs.js';

export const CSP_BLOCKED_MESSAGE = 'Esta página no permite ejecutar código (CSP); usa browser_extract o browser_snapshot';

// El núcleo espera 15 s por comando: se responde antes aunque el script siga.
const SCRIPT_TIMEOUT_MS = 14000;

/**
 * Se inyecta en la página: el navegador serializa esta función, así que no
 * puede usar nada que esté fuera de su propio cuerpo.
 */
export function runScriptInPage(code) {
  const describe = (error) => String(error && error.message ? error.message : error);
  const isCspBlock = (error) =>
    error instanceof EvalError || /unsafe-eval|Content Security Policy|Trusted Type/i.test(describe(error));
  const toSerializable = (value) => {
    if (value === undefined) {
      return null;
    }
    try {
      const json = JSON.stringify(value);
      return json === undefined ? String(value) : JSON.parse(json);
    } catch {
      // Ciclos o BigInt: se devuelve su representación en texto.
      return String(value);
    }
  };
  const failure = (error) => ({ ok: false, blockedByCsp: isCspBlock(error), message: describe(error) });

  let run;
  try {
    // eslint-disable-next-line no-new-func -- comando eval del núcleo; ver el comentario del módulo
    run = new Function(`return (async () => { ${code} })()`);
  } catch (error) {
    return failure(error);
  }
  return Promise.resolve()
    .then(run)
    .then((value) => ({ ok: true, value: toSerializable(value) }), failure);
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new ScriptTimeoutError(timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class ScriptTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`the script did not finish within ${timeoutMs}ms`);
  }
}

export async function evaluateInPage(api, { script }, { timeoutMs = SCRIPT_TIMEOUT_MS } = {}) {
  const tab = await getActiveTab(api);
  let injections;
  try {
    injections = await withTimeout(
      api.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: runScriptInPage,
        args: [script],
      }),
      timeoutMs,
    );
  } catch (error) {
    if (error instanceof ScriptTimeoutError) {
      return { success: false, error: `Eval error: ${error.message}` };
    }
    return { success: false, error: `Cannot access this page (${describePageOrigin(tab.url)}): ${error.message}` };
  }

  const outcome = injections?.[0]?.result;
  if (!outcome) {
    // La página navegó o se cerró mientras corría el script.
    return { success: false, error: 'Eval error: the page returned no result' };
  }
  if (outcome.ok) {
    return { success: true, result: outcome.value };
  }
  if (outcome.blockedByCsp) {
    return { success: false, error: CSP_BLOCKED_MESSAGE, code: 'csp_blocked' };
  }
  return { success: false, error: `Eval error: ${outcome.message}` };
}
