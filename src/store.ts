// Tiny external store: the engine pushes HUD snapshots into it, React reads.
import { useSyncExternalStore } from 'react';

export type Status = 'idle' | 'connecting' | 'live' | 'closed';

export interface ScoreRow {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  color: string;
  bot: boolean;
  alive: boolean;
  you: boolean;
}

export interface FeedItem {
  id: number;
  text: string;
  color: string;
  at: number;
}

export interface RadarBlip {
  x: number;
  z: number;
  heading: number;
  color: string;
  you: boolean;
  alive: boolean;
  bot: boolean;
}

export interface RadarPickup {
  x: number;
  z: number;
  kind: 'health' | 'energy' | 'overdrive';
}

export interface Hud {
  status: Status;
  you: string | null;
  scoreboard: ScoreRow[];
  timeLeft: number;
  phase: 'live' | 'ended';
  winner: string | null;
  health: number;
  shield: number;
  energy: number;
  heat: number;
  overheat: boolean;
  overdrive: number;
  alive: boolean;
  respawnIn: number;
  kills: number;
  deaths: number;
  ping: number;
  fps: number;
  feed: FeedItem[];
  hitMarker: number;
  damageFlash: number;
  killFlash: number;
  boost: boolean;
  notice: string | null;
  radar: RadarBlip[];
  radarPickups: RadarPickup[];
}

export interface Settings {
  name: string;
  volume: number;
  sensitivity: number;
  quality: 'auto' | 'high' | 'low';
  showFps: boolean;
  camera: 'chase' | 'fixed';
  invertStick: boolean;
  shake: number;
}

export interface AppState {
  hud: Hud;
  settings: Settings;
  paused: boolean;
  screen: 'menu' | 'game';
  touch: boolean;
}

const DEFAULT_HUD: Hud = {
  status: 'idle',
  you: null,
  scoreboard: [],
  timeLeft: 180,
  phase: 'live',
  winner: null,
  health: 100,
  shield: 50,
  energy: 100,
  heat: 0,
  overheat: false,
  overdrive: 0,
  alive: true,
  respawnIn: 0,
  kills: 0,
  deaths: 0,
  ping: 0,
  fps: 0,
  feed: [],
  hitMarker: 0,
  damageFlash: 0,
  killFlash: 0,
  boost: false,
  notice: null,
  radar: [],
  radarPickups: [],
};

const DEFAULT_SETTINGS: Settings = {
  name: '',
  volume: 0.6,
  sensitivity: 1,
  quality: 'auto',
  showFps: true,
  camera: 'chase',
  invertStick: false,
  shake: 1,
};

const SETTINGS_KEY = 'hoverdrift.settings.v1';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

class Store {
  state: AppState = {
    hud: { ...DEFAULT_HUD },
    settings: loadSettings(),
    paused: false,
    screen: 'menu',
    touch:
      typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse)').matches &&
      !window.matchMedia('(pointer: fine)').matches,
  };

  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = () => this.state;

  private emit() {
    for (const fn of this.listeners) fn();
  }

  patch(partial: Partial<AppState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  patchHud(partial: Partial<Hud>) {
    let changed = false;
    for (const key of Object.keys(partial) as (keyof Hud)[]) {
      if (this.state.hud[key] !== partial[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, hud: { ...this.state.hud, ...partial } };
    this.emit();
  }

  resetHud() {
    this.state = { ...this.state, hud: { ...DEFAULT_HUD } };
    this.emit();
  }

  setSettings(patch: Partial<Settings>) {
    const settings = { ...this.state.settings, ...patch };
    this.state = { ...this.state, settings };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable — non fatal */
    }
    this.emit();
  }
}

export const store = new Store();

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}
