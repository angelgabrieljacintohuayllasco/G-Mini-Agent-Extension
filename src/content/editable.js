/**
 * Escritura en campos de texto y en editores contenteditable.
 *
 * Inputs y textareas reciben el valor con el setter nativo y un evento input,
 * que es lo que escuchan React, Vue y Angular. Los editores enriquecidos
 * (Gmail, WhatsApp Web, Notion...) se escriben con execCommand('insertText'),
 * que genera los eventos beforeinput/input que esperan sus frameworks.
 */

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

function nativeValueSetter(element) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
}

function setFieldValue(element, value) {
  const setter = nativeValueSetter(element);
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
}

function isTextField(element) {
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  return element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type.toLowerCase());
}

function emitInput(element, inputType, data = null) {
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data }));
}

function createFieldEditor(element) {
  return {
    clear() {
      setFieldValue(element, '');
      emitInput(element, 'deleteContentBackward');
    },
    insert(text) {
      setFieldValue(element, `${element.value}${text}`);
      emitInput(element, 'insertText', text);
    },
    replaceAll(text) {
      setFieldValue(element, text);
      emitInput(element, 'insertReplacementText', text);
    },
  };
}

function selectContents(element, { collapseToEnd }) {
  const selection = element.ownerDocument.getSelection();
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  if (collapseToEnd) {
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function createRichTextEditor(element) {
  const document = element.ownerDocument;
  // execCommand está obsoleto pero es la única vía que respetan los editores
  // enriquecidos; si el navegador lo rechaza se escribe en el DOM directamente.
  const insertText = (text) => {
    if (!document.execCommand('insertText', false, text)) {
      element.append(document.createTextNode(text));
      emitInput(element, 'insertText', text);
    }
  };
  return {
    clear() {
      selectContents(element, { collapseToEnd: false });
      if (!document.execCommand('delete', false)) {
        element.textContent = '';
        emitInput(element, 'deleteContentBackward');
      }
    },
    insert(text) {
      selectContents(element, { collapseToEnd: true });
      insertText(text);
    },
    replaceAll(text) {
      selectContents(element, { collapseToEnd: false });
      insertText(text);
    },
  };
}

/** Editor para el elemento, o null si no admite texto. */
export function createTextEditor(element) {
  if (isTextField(element)) {
    return createFieldEditor(element);
  }
  if (element.isContentEditable) {
    return createRichTextEditor(element);
  }
  return null;
}
