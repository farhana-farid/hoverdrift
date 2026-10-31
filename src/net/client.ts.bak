// Thin WebSocket client: transport, latency measurement, reconnect-free
// lifecycle. Prediction/interpolation lives in the session.

import type { ClientMessage, InputFrame, ServerMessage, Snapshot } from '../../shared/types';

export type NetStatus = 'connecting' | 'open' | 'closed';

export class NetClient {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  private pingId = 1;
  private pingSentAt = 0;
  rtt = 0;
  latency = 0;

  constructor(
    private handlers: {
      onWelcome: (you: string, snap: Snapshot) => void;
      onSnapshot: (snap: Snapshot) => void;
      onStatus: (status: NetStatus, reason?: string) => void;
    },
  ) {}

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  connect(name: string) {
    this.close();
    this.handlers.onStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch (err) {
      this.handlers.onStatus('closed', err instanceof Error ? err.message : 'socket failed');
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.handlers.onStatus('open');
      this.sendRaw({ t: 'join', name });
      this.startPing();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > 512_000) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        this.handlers.onWelcome(msg.you, msg.snap);
      } else if (msg.t === 'snap') {
        this.handlers.onSnapshot(msg.snap);
      } else if (msg.t === 'pong') {
        this.rtt = Math.max(0, performance.now() - this.pingSentAt);
        this.latency = this.rtt;
      }
    };

    ws.onclose = (ev) => {
      this.stopPing();
      this.handlers.onStatus('closed', ev.reason || undefined);
    };
    ws.onerror = () => {
      this.handlers.onStatus('closed', 'connection error');
    };
  }

  private startPing() {
    this.stopPing();
    const ping = () => {
      this.pingId++;
      this.pingSentAt = performance.now();
      this.sendRaw({ t: 'ping', id: this.pingId });
    };
    this.pingTimer = window.setInterval(ping, 2000);
    window.setTimeout(ping, 120);
  }

  private stopPing() {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  sendInput(frame: InputFrame) {
    this.sendRaw({ t: 'input', frame });
  }

  private sendRaw(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.stopPing();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
  }
}
