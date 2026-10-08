/**
 * Arranca un núcleo real de G-Mini Agent para la prueba de humo.
 *
 * Usa un puerto de prueba (nunca el 8765 de la app abierta), un GMINI_HOME
 * temporal para no tocar los datos del usuario y --headless, que omite visión
 * y control de escritorio. Las acciones se piden por POST /api/actions/execute,
 * que pasa por el planner, BrowserController y ExtensionBridge reales.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const STARTUP_TIMEOUT_MS = 180000;
// Códigos de color ANSI que loguru añade a la consola.
const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const LOGGER_STAMP = /run_stamp=(\S+)/;

function defaultPython(coreDir) {
  const windows = path.join(coreDir, 'venv', 'Scripts', 'python.exe');
  return existsSync(windows) ? windows : path.join(coreDir, 'venv', 'bin', 'python');
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`el núcleo terminó al arrancar (código ${child.exitCode})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        return response.json();
      }
    } catch {
      // Todavía no escucha: se reintenta.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`el núcleo no respondió en ${STARTUP_TIMEOUT_MS / 1000} s`);
}

export async function startRealCore({ coreDir, python = defaultPython(coreDir), port, workDir }) {
  const home = path.join(workDir, `core-home-${Date.now()}`);
  await mkdir(home, { recursive: true });
  const token = randomBytes(32).toString('hex');
  const child = spawn(python, ['-m', 'backend.main', '--headless', '--port', String(port)], {
    cwd: coreDir,
    env: {
      ...process.env,
      GMINI_HOME: home,
      GMINI_SESSION_TOKEN: token,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const events = new EventEmitter();
  const log = [];
  let connected = false;
  let logStamp = null;
  const onLine = (rawLine) => {
    const line = rawLine.replace(ANSI_COLOR, '');
    log.push(line);
    logStamp ??= LOGGER_STAMP.exec(line)?.[1] ?? null;
    if (line.includes('[ExtBridge] Extensión Chrome conectada')) {
      connected = true;
      events.emit('connected');
    } else if (line.includes('[ExtBridge] Extensión Chrome desconectada')) {
      connected = false;
      events.emit('disconnected');
    } else if (line.includes('[ExtBridge] Handshake OK')) {
      events.emit('hello', line);
    } else if (line.includes('/ws/extension rechazado')) {
      events.emit('rejected', line);
    }
  };
  readline.createInterface({ input: child.stdout }).on('line', onLine);
  readline.createInterface({ input: child.stderr }).on('line', onLine);

  const health = await waitForHealth(port, child);

  return {
    port,
    home,
    health,
    events,
    log,
    isConnected: () => connected,
    async execute(actionType, params = {}) {
      const response = await fetch(`http://127.0.0.1:${port}/api/actions/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ action_type: actionType, params }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }
      return response.json();
    },
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((resolve) => {
          child.once('exit', resolve);
          setTimeout(resolve, 10000);
        });
      }
      if (logStamp) {
        // backend/utils/logger.py escribe en <núcleo>/logs aunque haya GMINI_HOME.
        console.warn(`Aviso: el núcleo dejó sus logs en ${path.join(coreDir, 'logs')} (gmini_${logStamp}.log y gmini_detailed_${logStamp}.log).`);
      }
    },
  };
}
