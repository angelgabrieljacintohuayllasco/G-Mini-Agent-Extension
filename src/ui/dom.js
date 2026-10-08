/** Utilidades mínimas de DOM para el popup y las opciones. Nunca usan HTML crudo. */

export function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Falta el elemento #${id} en la página.`);
  }
  return element;
}

export function createElement(tagName, { className, text, title, attributes = {} } = {}) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  if (title) {
    element.title = title;
  }
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

/** Muestra un aviso con tono (success, warning, danger, neutral) o lo oculta si no hay texto. */
export function showNotice(element, { tone = 'neutral', message = '' } = {}) {
  element.dataset.tone = tone;
  element.textContent = message;
  element.hidden = !message;
}

export function setFieldError(input, errorElement, message) {
  errorElement.textContent = message ?? '';
  errorElement.hidden = !message;
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}
