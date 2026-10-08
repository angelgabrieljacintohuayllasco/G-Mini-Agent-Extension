/**
 * Núcleo simulado para las pruebas de extremo a extremo.
 *
 * Replica el comportamiento de backend/automation/extension_bridge.py:
 *   - un solo cliente: al conectarse otro, cierra el anterior con código 1000;
 *   - envía {"event": "ext:command", "data": {"id", "command", "params"}};
 *   - resuelve cada comando con el ext:response del mismo id;
 *   - expone /api/health como el núcleo real.
 * Los métodos del objeto `bridge` tienen los nombres y parámetros de la clase
 * ExtensionBridge.
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const DEFAULT_TIMEOUT_MS = 15000;

export async function startMockCore({ port = 0 } = {}) {
  const events = new EventEmitter();
  const pending = new Map();
  let current = null;

  const server = http.createServer((request, response) => {
    if (request.url === '/api/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', version: 'mock', uptime_seconds: 0 }));
      return;
    }
    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws/extension') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (ws, request) => {
    if (current && current.readyState === WebSocket.OPEN) {
      current.close(1000);
    }
    current = ws;
    events.emit('connected', { origin: request.headers.origin, host: request.headers.host });
    ws.on('message', (raw) => handleMessage(JSON.parse(String(raw))));
    ws.on('close', () => {
      if (current === ws) {
        current = null;
        for (const entry of pending.values()) {
          entry.reject(new Error('Extension disconnected'));
        }
        pending.clear();
        events.emit('disconnected');
      }
    });
  });

  function handleMessage({ event, data }) {
    if (event === 'ext:response') {
      const entry = pending.get(data.id);
      if (entry) {
        pending.delete(data.id);
        entry.resolve(data);
      }
      return;
    }
    events.emit(event, data);
  }

  function sendRaw(message) {
    if (!current) {
      throw new Error('Extension not connected');
    }
    current.send(JSON.stringify(message));
  }

  function sendCommand(command, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Extension command '${command}' timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      sendRaw({ event: 'ext:command', data: { id, command, params } });
    });
  }

  const bridge = {
    navigate: (url) => sendCommand('navigate', { url }),
    click: (selector, force = false) => sendCommand('click', { selector, force }),
    type: (selector, text, clear = true) => sendCommand('type', { selector, text, clear }),
    fill: (selector, text) => sendCommand('fill', { selector, text }),
    press: (key) => sendCommand('press', { key }),
    scroll: (direction = 'down', amount = 3) => sendCommand('scroll', { direction, amount }),
    hover: (selector) => sendCommand('hover', { selector }),
    select_option: (selector, value) => sendCommand('select', { selector, value }),
    wait_for_selector: (selector, timeoutMs = 15000, state = 'visible') =>
      sendCommand('wait_for', { selector, timeout_ms: timeoutMs, state }, timeoutMs + 2000),
    wait_for_load: (timeoutMs = 30000) => sendCommand('wait_load', { timeout_ms: timeoutMs }, timeoutMs + 2000),
    go_back: () => sendCommand('go_back'),
    go_forward: () => sendCommand('go_forward'),
    remove_overlays: () => sendCommand('remove_overlays'),
    extract: (selector = 'body') => sendCommand('extract', { selector }),
    get_dom: (selector = 'body', maxDepth = 6, maxLength = 12000) =>
      sendCommand('get_dom', { selector, max_depth: maxDepth, max_length: maxLength }),
    snapshot: () => sendCommand('snapshot'),
    evaluate: (script) => sendCommand('eval', { script }),
    screenshot: () => sendCommand('screenshot', {}, 10000),
    get_page_info: () => sendCommand('page_info'),
    list_tabs: () => sendCommand('tabs_list'),
    switch_tab: (index) => sendCommand('tab_switch', { index }),
    new_tab: (url = null) => sendCommand('tab_new', { url: url || 'about:blank' }),
    close_tab: (index = null) => sendCommand('tab_close', index === null ? {} : { index }),
    list_downloads: (limit = 20) => sendCommand('downloads_list', { limit }),
  };

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    port: server.address().port,
    events,
    bridge,
    sendCommand,
    sendRaw,
    isConnected: () => current !== null,
    async stop() {
      for (const client of wss.clients) {
        client.terminate();
      }
      const closed = new Promise((resolve) => server.close(resolve));
      // Cierra también las conexiones HTTP keep-alive (la prueba de salud del popup).
      server.closeAllConnections();
      await closed;
    },
  };
}
