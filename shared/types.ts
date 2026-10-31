// Wire + simulation types shared by server and client.

export type PickupKind = 'health' | 'energy' | 'overdrive';

export interface Player {
  id: string;
  name: string;
  color: number;
  bot: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  aim: number;
  health: number;
  shield: number;
  energy: number;
  heat: number;
  overheated: boolean;
  cooldown: number;
  lastDamage: number;
  invuln: number;
  overdrive: number;
  alive: boolean;
  respawnAt: number;
  kills: number;
  deaths: number;
}

export interface Projectile {
  id: number;
  owner: string;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  life: number;
  dmg: number;
  overdrive: boolean;
}

export interface Crate {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  rot: number;
  vr: number;
  size: number;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  z: number;
  born: number;
}

export interface InputFrame {
  seq: number;
  /** World-space movement vector, already camera-relative on the client. */
  mx: number;
  mz: number;
  aim: number;
  fire: boolean;
  boost: boolean;
}

export type SimEvent =
  | { t: 'shoot'; id: string; x: number; z: number; aim: number; overdrive: boolean }
  | { t: 'hit'; x: number; z: number; dmg: number; target: string; by: string }
  | { t: 'kill'; x: number; z: number; killer: string; victim: string }
  | { t: 'impact'; x: number; z: number }
  | { t: 'crate'; x: number; z: number }
  | { t: 'pickup'; x: number; z: number; kind: PickupKind; id: string }
  | { t: 'spawn'; id: string; x: number; z: number }
  | { t: 'overheat'; id: string }
  | { t: 'round'; winner: string | null }
  | { t: 'join'; id: string; name: string; bot: boolean; color: number }
  | { t: 'leave'; id: string }
  | { t: 'round'; winner: string | null };

export interface Snapshot {
  tick: number;
  time: number;
  phase: 'live' | 'ended';
  serverTime: number;
  ack: number;
  players: Player[];
  projectiles: Projectile[];
  crates: Crate[];
  pickups: Pickup[];
  events: SimEvent[];
}

export type ClientMessage =
  | { t: 'join'; name: string }
  | { t: 'input'; frame: InputFrame }
  | { t: 'ping'; id: number };

export type ServerMessage =
  | { t: 'welcome'; you: string; tick: number; snap: Snapshot }
  | { t: 'snap'; snap: Snapshot }
  | { t: 'pong'; id: number; serverTime: number };
