/**
 * Búsqueda de elementos con la semántica de la extensión original: en una
 * lista "a, b, c" se prueba cada selector en el orden escrito y gana el
 * primero que encuentre algo (prioridad, no orden del documento).
 */

/**
 * Divide una lista de selectores por las comas de primer nivel, respetando las
 * que van dentro de paréntesis, corchetes o comillas:
 * `input[name="a,b"], :is(.x, .y)` -> ['input[name="a,b"]', ':is(.x, .y)'].
 */
export function splitSelectorList(selectorList) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;

  for (let index = 0; index < selectorList.length; index += 1) {
    const char = selectorList[index];
    if (char === '\\') {
      current += char + (selectorList[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (quote) {
      quote = char === quote ? null : quote;
      current += char;
      continue;
    }
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[') {
      depth += 1;
    } else if ((char === ')' || char === ']') && depth > 0) {
      depth -= 1;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function queryOrNull(root, selector) {
  try {
    return root.querySelector(selector);
  } catch {
    // Selector no válido: se trata como sin coincidencias y se prueba el siguiente.
    return null;
  }
}

export function findElement(selectorList, root = document) {
  for (const selector of splitSelectorList(selectorList)) {
    const element = queryOrNull(root, selector);
    if (element) {
      return element;
    }
  }
  return null;
}

export function notFound(selector) {
  return { success: false, error: `Element not found: ${selector}` };
}
