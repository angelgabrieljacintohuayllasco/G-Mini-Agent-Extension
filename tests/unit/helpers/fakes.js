/** Dobles de prueba: reloj controlable, WebSocket falso y área de storage en memoria. */

export function createFakeClock(start = 1_000_000) {
  let now = start;
  let nextId = 1;
  const timers = new Map();

  function nextDue(limit) {
    let chosen = null;
    for (const [id, timer] of timers) {
      if (timer.at <= limit && (chosen === null || timer.at < chosen[1].at)) {
        chosen = [id, timer];
      }
    }
    return chosen;
  }

  return {
    now: () => now,
    setTimeout(callback, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback, every: null });
      return id;
    },
    setInterval(callback, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback, every: ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    advance(ms) {
      const target = now + ms;
      for (let due = nextDue(target); due; due = nextDue(target)) {
        const [id, timer] = due;
        now = timer.at;
        if (timer.every === null) {
          timers.delete(id);
        } else {
          timer.at += timer.every;
        }
        timer.callback();
      }
      now = target;
    },
    pendingTimers: () => timers.size,
  };
}

export class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closedWith = null;
  }

  send(text) {
    this.sent.push(JSON.parse(text));
  }

  close(code, reason) {
    this.readyState = 3;
    this.closedWith = { code, reason };
  }

  acceptConnection() {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message) {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }

  closeFromServer(code) {
    this.readyState = 3;
    this.onerror?.();
    this.onclose?.({ code, wasClean: code === 1000 });
  }
}

export function createSocketFactory() {
  const sockets = [];
  const create = (url) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  };
  return { create, sockets, last: () => sockets.at(-1) };
}

export function createMemoryStorageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
  };
}

export const silentLog = { warn: () => {}, error: () => {}, info: () => {} };
