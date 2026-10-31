import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { GameSession } from '../game/session';

interface StickProps {
  side: 'left' | 'right';
  label: string;
  onChange: (x: number, y: number, active: boolean) => void;
}

function Stick({ side, label, onChange }: StickProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);
  const [active, setActive] = useState(false);

  const update = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = padRef.current;
    const knob = knobRef.current;
    if (!el || !knob) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width / 2 - 14;
    let dx = (e.clientX - cx) / radius;
    let dy = (e.clientY - cy) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    knob.style.transform = `translate(${dx * radius}px, ${dy * radius}px)`;
    onChange(dx, -dy, true);
  };

  const release = () => {
    activePointer.current = null;
    setActive(false);
    const knob = knobRef.current;
    if (knob) knob.style.transform = 'translate(0px, 0px)';
    onChange(0, 0, false);
  };

  return (
    <div
      ref={padRef}
      className={`stick ${side} ${active ? 'active' : ''}`}
      onPointerDown={(e) => {
        activePointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        setActive(true);
        update(e);
      }}
      onPointerMove={(e) => {
        if (activePointer.current !== e.pointerId) return;
        update(e);
      }}
      onPointerUp={(e) => {
        if (activePointer.current !== e.pointerId) return;
        release();
      }}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span className="stick-label">{label}</span>
      <div className="stick-base" />
      <div ref={knobRef} className="stick-knob" />
    </div>
  );
}

export function TouchControls({ session }: { session: RefObject<GameSession | null> }) {
  const [boosting, setBoosting] = useState(false);

  return (
    <div className="touch-layer">
      <Stick
        side="left"
        label="THRUST"
        onChange={(x, y, active) => session.current?.setTouchMove(active ? x : 0, active ? y : 0)}
      />
      <Stick
        side="right"
        label="AIM / FIRE"
        onChange={(x, y, active) => session.current?.setTouchAim(x, y, active)}
      />
      <button
        className={`boost-pad ${boosting ? 'on' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setBoosting(true);
          session.current?.setTouchBoost(true);
        }}
        onPointerUp={() => {
          setBoosting(false);
          session.current?.setTouchBoost(false);
        }}
        onPointerCancel={() => {
          setBoosting(false);
          session.current?.setTouchBoost(false);
        }}
      >
        BOOST
      </button>
    </div>
  );
}
