// ---------------------------------------------------------------------------
// HOVERDRIFT authoritative game server.
//   * one 60 Hz simulation loop per room, 20 Hz snapshots
//   * server owns hits, kills, pickups and physics props
//   * bots fill rooms so a solo player always has opposition
//   * serves the built client from /dist in production
// ---------------------------------------------------------------------------

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import { BOT_FILL, FIXED_DT, MAX_PLAYERS, SNAPSHOT_EVERY, TICK_RATE } from '../shared/constants';
import type { ClientMessage, InputFrame, ServerMessage, SimEvent } from '../shared/types';
import { World } from '../shared/world';
import { makeBrain, updateBot, type BotBrain } from './ai';

const PORT = Number(process.env.PORT) || 8080;
const BOT_NAMES = ['VECTOR', 'HELIX', 'RIFT', 'NOVA', 'PULSE', 'TALON', 'ONYX', 'KITE'];
const MAX_ROOMS = 24;

interface Client {
  ws: WebSocket;
  id: string;
  seq: number;
  hits: number;
  windowStart: number;
  joined: boolean;
}

class Room {
  readonly world = new World();
  readonly clients = new Map<WebSocket, Client>();
  readonly brains = new Map<string, BotBrain>();
  private botSeq = 0;
  private acc = 0;
  private last = performance.now();
  private events: SimEvent[] = [];
  private timer: NodeJS.Timeout;
  private endedAt = 0;
  private botTimer = 0;

  constructor(readonly id: string) {
    this.timer = setInterval(() => this.pump(), 1000 / TICK_RATE);
  }

  get size(): number {
    return this.clients.size;
  }

  private pump(): void {
    const now = performance.now();
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;

    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 5) {
      this.simulate(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
  }

  private simulate(dt: number): void {
    this.reconcileBots(dt);

    for (const [id, brain] of this.brains) {
      const bot = this.world.players.get(id);
      if (!bot) {
        this.brains.delete(id);
        continue;
      }
      if (!bot.bot && bot.alive) continue;
      if (bot.alive) {
        const frame = updateBot(this.world, bot, brain, dt);
        this.world.setInput(id, frame);
      }
    }

    const events = this.world.step(dt);
    if (events.length) this.events.push(...events);

    if (this.world.phase === 'ended') {
      if (!this.endedAt) {
        this.endedAt = this.world.time;
      } else if (this.world.time - this.endedAt > 10) {
        this.endedAt = 0;
        this.world.reset();
        // Bot brains are keyed by player id and survive the round reset.
      }
    }

    if (this.world.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  private broadcastSnapshot(): void {
    const base = this.world.snapshot(0, Date.now());
    base.events = this.events;
    this.events = [];
    const refs = base.players;
    base.players = []; // replaced per-client below to keep the payload lean
    for (const c of this.clients.values()) {
      if (c.ws.readyState !== 1) continue;
      const payload: ServerMessage = { t: 'snap', snap: { ...base, ack: c.seq, players: refs } };
      c.ws.send(JSON.stringify(payload));
    }
  }

  join(ws: WebSocket, rawName: string): void {
    const name = String(rawName || 'Pilot').replace(/[^\w \-.]/g, '').slice(0, 14) || 'Pilot';
    const id = `p${Math.random().toString(36).slice(2, 9)}`;
    const client: Client = { ws, id, seq: 0, hits: 0, windowStart: performance.now(), joined: true };
    this.clients.set(ws, client);
    const snap = this.world.snapshot(0, Date.now());
    const welcome: ServerMessage = { t: 'welcome', you: id, tick: this.world.tick, snap };
    ws.send(JSON.stringify(welcome));
    this.world.addPlayer(id, name, false);
    // Surface the join event to everyone on the next snapshot.
    this.events.push(...this.world.events);
    this.world.events.length = 0;
  }

  leave(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;
    this.clients.delete(ws);
    this.world.removePlayer(client.id);
  }

  handle(ws: WebSocket, msg: ClientMessage): void {
    const client = this.clients.get(ws);
    if (!client) return;
    if (msg.t === 'input') {
      const now = performance.now();
      client.hits++;
      if (now - client.windowStart > 1000) {
        client.windowStart = now;
        client.hits = 0;
      }
      if (client.hits > 240) return; // input flood guard
      const f = msg.frame;
      if (!f || typeof f !== 'object') return;
      const frame: InputFrame = {
        seq: Number.isFinite(f.seq) ? f.seq : client.seq,
        mx: clampNum(f.mx, -1, 1),
        mz: clampNum(f.mz, -1, 1),
        aim: clampNum(f.aim, -Math.PI * 8, Math.PI * 8),
        fire: !!f.fire,
        boost: !!f.boost,
      };
      client.seq = Math.max(client.seq, frame.seq);
      this.world.setInput(client.id, frame);
    } else if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', id: msg.id, serverTime: Date.now() } satisfies ServerMessage));
    }
  }

  private reconcileBots(dt: number): void {
    this.botTimer -= dt;
    if (this.botTimer > 0) return;
    this.botTimer = 0.5;

    const humans = this.world.humans;
    const target = Math.max(0, Math.min(4, BOT_FILL - humans));
    let bots = [...this.world.players.values()].filter((p) => p.bot).length;

    while (bots > target) {
      const victim = [...this.world.players.values()].find((p) => p.bot);
      if (!victim) break;
      this.brains.delete(victim.id);
      this.world.removePlayer(victim.id);
      bots--;
    }
    while (bots < target) {
      const used = new Set([...this.world.players.values()].map((p) => p.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) ?? `BOT ${this.botSeq + 1}`;
      const id = `bot-${this.id}-${this.botSeq++}`;
      this.world.addPlayer(id, name, true);
      this.brains.set(id, makeBrain());
      bots++;
    }
  }

  stats() {
    return {
      room: this.id,
      humans: this.world.humans,
      bots: [...this.world.players.values()].filter((p) => p.bot).length,
      phase: this.world.phase,
    };
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}

const clampNum = (v: unknown, min: number, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n < min ? min : n > max ? max : n;
};

// ---------------------------------------------------------------- http + ws
const DIST = path.resolve(process.cwd(), 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const rooms = new Map<string, Room>();

function pickRoom(): Room {
  for (const room of rooms.values()) {
    if (room.size < MAX_PLAYERS) return room;
  }
  if (rooms.size >= MAX_ROOMS) return rooms.values().next().value as Room;
  const room = new Room(`arena-${rooms.size + 1}`);
  rooms.set(room.id, room);
  console.log(`[room] opened ${room.id}`);
  return room;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.size, 0) }));
    return;
  }
  if (url.pathname === '/rooms') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([...rooms.values()].map((r) => r.stats())));
    return;
  }
  if (!fs.existsSync(DIST)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Client not built. Run `npm run dev` (Vite on :5173) or `npm run build` first.');
    return;
  }
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(DIST, 'index.html')));
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': rel === '/index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let room: Room | null = null;
  let joined = false;
  const joinDeadline = setTimeout(() => {
    if (!joined) ws.close(4000, 'join timeout');
  }, 10000);

  // Heartbeat: a tab that sleeps or a dropped network must not leave a ghost
  // pilot blocking a slot. Browsers answer protocol pings automatically.
  let responsive = true;
  ws.on('pong', () => {
    responsive = true;
  });
  const heartbeat = setInterval(() => {
    if (!responsive) {
      ws.terminate();
      return;
    }
    responsive = false;
    ws.ping();
  }, 15000);

  ws.on('message', (data) => {
    const text = Buffer.isBuffer(data)
      ? data.toString()
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString()
        : Array.isArray(data)
          ? Buffer.concat(data).toString()
          : String(data);
    if (text.length > 4096) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      return;
    }
    if (msg.t === 'join' && !joined) {
      joined = true;
      clearTimeout(joinDeadline);
      room = pickRoom();
      room.join(ws, msg.name);
      return;
    }
    room?.handle(ws, msg);
  });

  ws.on('close', () => {
    clearTimeout(joinDeadline);
    clearInterval(heartbeat);
    room?.leave(ws);
  });
  ws.on('error', () => {
    clearTimeout(joinDeadline);
    clearInterval(heartbeat);
    room?.leave(ws);
  });
});

server.listen(PORT, () => {
  console.log(`[hoverdrift] sim + ws listening on :${PORT}  (ws://localhost:${PORT}/ws)`);
});

const shutdown = () => {
  console.log('\n[hoverdrift] shutting down');
  for (const room of rooms.values()) room.dispose();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
