// Headless protocol smoke test: joins the arena, sends inputs, verifies the
// server is simulating, shooting and replicating.
//   node scripts/smoke.mjs [ws://localhost:8080/ws]
import WebSocket from 'ws';

const url = process.argv[2] ?? 'ws://localhost:8080/ws';
const ws = new WebSocket(url);

let seq = 0;
let ticks = [];
let players = 0;
let maxProjectiles = 0;
let crates = 0;
let pickups = 0;
let you = null;
let events = new Set();

const fail = (msg) => {
  console.error('FAIL:', msg);
  process.exit(1);
};

const timeout = setTimeout(() => fail('timed out without snapshots'), 12000);

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'join', name: 'SMOKE-TEST' }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === 'welcome') {
    you = msg.you;
    return;
  }
  if (msg.t !== 'snap') return;
  const s = msg.snap;
  ticks.push(s.tick);
  players = Math.max(players, s.players.length);
  maxProjectiles = Math.max(maxProjectiles, s.projectiles.length);
  crates = Math.max(crates, s.crates.length);
  pickups = Math.max(pickups, s.pickups.length);
  for (const e of s.events) events.add(e.t);

  const me = s.players.find((p) => p.id === you);
  if (me) {
    // drive forward + fire + aim so the sim has something to chew on
    const frame = { seq: ++seq, mx: 0.7, mz: 0.5, aim: 0.6 + Math.sin(seq * 0.05) * 0.4, fire: true, boost: seq % 60 < 30 };
    ws.send(JSON.stringify({ t: 'input', frame }));
  }
});

setTimeout(() => {
  clearTimeout(timeout);
  const ok =
    you &&
    players >= 4 &&
    maxProjectiles > 0 &&
    crates > 0 &&
    ticks.length > 30;
  console.log(JSON.stringify(
    {
      ok,
      you,
      snapshots: ticks.length,
      tickRange: [ticks[0], ticks[ticks.length - 1]],
      players,
      maxProjectiles,
      crates,
      pickups,
      events: [...events].sort(),
    },
    null,
    2,
  ));
  ws.close();
  process.exit(ok ? 0 : 1);
}, 5000);
