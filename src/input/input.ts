// ---------------------------------------------------------------------------
// Unified input: keyboard + mouse, gamepad (polled), and touch (injected by the
// React touch layer). Produces a camera-relative intent that the session turns
// into world-space simulation input.
// ---------------------------------------------------------------------------

export interface Sample {
  mx: number;
  mz: number;
  /** Absolute world aim angle, or null when the mouse is the aim source. */
  aim: number | null;
  fire: boolean;
  boost: boolean;
  pointer: { x: number; y: number } | null;
  source: 'keyboard' | 'gamepad' | 'touch';
}

const DEADZONE = 0.22;
const applyDeadzone = (v: number) => {
  if (Math.abs(v) < DEADZONE) return 0;
  const sign = Math.sign(v);
  return sign * ((Math.abs(v) - DEADZONE) / (1 - DEADZONE));
};

export class InputController {
  private keys = new Set<string>();
  pointer: { x: number; y: number } | null = null;
  mouseFire = false;
  private disposed = false;

  touchMove = { x: 0, y: 0 };
  touchAim = { x: 0, y: 0, active: false };
  touchFire = false;
  touchBoost = false;

  private padIndex: number | null = null;
  private padStartPrev = false;

  constructor(
    private target: HTMLElement,
    private opts: { onPause?: () => void; onAnyInput?: () => void } = {},
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('contextmenu', this.preventDefault);
    window.addEventListener('gamepadconnected', this.onGamepad);
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.target.removeEventListener('contextmenu', this.preventDefault);
    window.removeEventListener('gamepadconnected', this.onGamepad);
  }

  private preventDefault = (e: Event) => e.preventDefault();

  private onGamepad = (e: Event) => {
    const gp = (e as GamepadEvent).gamepad;
    this.padIndex = gp.index;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
      if (code !== 'Tab' || !e.shiftKey) e.preventDefault();
    }
    if (code === 'Escape' || code === 'KeyP') {
      this.opts.onPause?.();
      return;
    }
    this.keys.add(code);
    this.opts.onAnyInput?.();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.mouseFire = false;
    this.touchFire = false;
    this.touchBoost = false;
    this.touchMove = { x: 0, y: 0 };
    this.touchAim = { x: 0, y: 0, active: false };
  };

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.target.getBoundingClientRect();
    this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.mouseFire = true;
    this.opts.onAnyInput?.();
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseFire = false;
  };

  setTouchMove(x: number, y: number) {
    this.touchMove = { x, y };
  }

  setTouchAim(x: number, y: number, active: boolean) {
    this.touchAim = { x, y, active };
  }

  private pollPad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.padIndex !== null && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p && p.connected) {
      this.padIndex = p.index;
      return p;
    }
    return null;
  }

  /** Edge-triggered vibration for hits, kills and heavy impacts. */
  rumble(strength: number, ms = 120) {
    const pad = this.pollPad();
    const actuator = (pad as unknown as { vibrationActuator?: { playEffect: (t: string, o: object) => Promise<unknown> } })
      ?.vibrationActuator;
    if (!actuator) return;
    void actuator
      .playEffect('dual-rumble', {
        duration: ms,
        strongMagnitude: Math.min(1, strength),
        weakMagnitude: Math.min(1, strength * 0.7),
      })
      .catch(() => undefined);
  }

  private readKeyAxis(invert: boolean): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (invert) y = -y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Rotate a camera-space vector into world space. */
  private static toWorld(x: number, y: number, camYaw: number) {
    return {
      x: Math.cos(camYaw) * x + Math.sin(camYaw) * y,
      z: -Math.sin(camYaw) * x + Math.cos(camYaw) * y,
    };
  }

  sample(camYaw: number, invert = false): Sample {
    const keyAxis = this.readKeyAxis(invert);
    let mx = keyAxis.x;
    let mz = keyAxis.y;
    let aim: number | null = null;
    let fire = this.mouseFire || this.touchFire || this.keys.has('Space');
    let boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchBoost;
    let source: Sample['source'] = 'keyboard';

    // Touch takes over movement when the stick is pushed.
    if (Math.hypot(this.touchMove.x, this.touchMove.y) > 0.05) {
      mx = this.touchMove.x;
      mz = invert ? -this.touchMove.y : this.touchMove.y;
      source = 'touch';
    }
    if (this.touchAim.active) {
      const a = InputController.toWorld(this.touchAim.x, invert ? -this.touchAim.y : this.touchAim.y, camYaw);
      aim = Math.atan2(a.x, a.z);
      fire = fire || Math.hypot(this.touchAim.x, this.touchAim.y) > 0.35;
      source = 'touch';
    }

    const pad = this.pollPad();
    if (pad) {
      const ax = applyDeadzone(pad.axes[0] ?? 0);
      const ay = applyDeadzone(pad.axes[1] ?? 0);
      if (Math.hypot(ax, ay) > 0.02) {
        mx = ax;
        mz = invert ? ay : -ay;
        if (source !== 'touch') source = 'gamepad';
      }
      const rx = applyDeadzone(pad.axes[2] ?? 0);
      const ry = applyDeadzone(pad.axes[3] ?? 0);
      if (Math.hypot(rx, ry) > 0.05) {
        const a = InputController.toWorld(rx, invert ? ry : -ry, camYaw);
        aim = Math.atan2(a.x, a.z);
        if (source !== 'touch') source = 'gamepad';
      }
      const btn = (i: number) => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.3;
      fire = fire || btn(7) || btn(0);
      boost = boost || btn(6) || btn(2);

      const start = btn(9);
      if (start && !this.padStartPrev) this.opts.onPause?.();
      this.padStartPrev = start;
    }

    if (Math.hypot(mx, mz) > 0) {
      const w = InputController.toWorld(mx, mz, camYaw);
      mx = w.x;
      mz = w.z;
    }

    return { mx, mz, aim, fire, boost, pointer: this.pointer, source };
  }
}
