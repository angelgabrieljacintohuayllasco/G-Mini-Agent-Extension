/** Acciones de solo lectura: texto, DOM resumido y tamaño de la ventana. */
import { findElement, notFound } from './selectors.js';

const EXTRACT_LIMIT = 8000;
const TEXT_NODE_LIMIT = 200;
const ATTRIBUTE_LIMIT = 80;
const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'path']);
const KEPT_ATTRIBUTES = ['id', 'class', 'href', 'src', 'type', 'name', 'role', 'aria-label', 'placeholder', 'value'];

export async function extract({ selector }) {
  const element = findElement(selector);
  if (!element) {
    return notFound(selector);
  }
  const text = element.innerText || element.textContent || '';
  return { success: true, text: text.slice(0, EXTRACT_LIMIT) };
}

function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

/** HTML resumido: sin scripts ni estilos, con atributos útiles para elegir selectores. */
export function serializeElement(root, { maxDepth, maxLength }) {
  function serialize(node, depth) {
    if (depth > maxDepth) {
      return '';
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').trim().slice(0, TEXT_NODE_LIMIT);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }
    const tag = node.tagName.toLowerCase();
    if (SKIPPED_TAGS.has(tag)) {
      return '';
    }
    let attributes = '';
    for (const name of KEPT_ATTRIBUTES) {
      const value = node.getAttribute(name);
      if (value) {
        attributes += ` ${name}="${escapeAttribute(value.slice(0, ATTRIBUTE_LIMIT))}"`;
      }
    }
    let inner = '';
    for (const child of node.childNodes) {
      inner += serialize(child, depth + 1);
      if (inner.length > maxLength) {
        break;
      }
    }
    return `<${tag}${attributes}>${inner}</${tag}>`;
  }
  return serialize(root, 0).slice(0, maxLength);
}

export async function getDom({ selector, max_depth: maxDepth, max_length: maxLength }) {
  const element = findElement(selector);
  if (!element) {
    return notFound(selector);
  }
  return { success: true, html: serializeElement(element, { maxDepth, maxLength }) };
}

/** Uso interno (page_info): no es un comando del núcleo. */
export async function viewport() {
  return {
    success: true,
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}
