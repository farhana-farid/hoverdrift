import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Radar } from './Radar';

const fmtClock = (s: number) => {
  const safe = Math.max(0, s);
  const m = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export function Hud({ mouseUser, onPause }: { mouseUser: boolean; onPause: () => void }) {
  const hud = useStore((s) => s.hud);
  const settings = useStore((s) => s.settings);
  const [board, setBoard] = useState(false);
  const crosshairRef = useRef<HTMLDivElement>(null);

  // Crosshair is moved with direct style writes: no React re-render per frame.
  useEffect(() => {
    if (!mouseUser) return;
    const onMove = (e: MouseEvent) => {
      const el = crosshairRef.current;
      if (el) el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [mouseUser]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setBoard(true);
      }
      if (e.code === 'KeyM') setBoard((v) => !v);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Tab') setBoard(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const healthPct = Math.max(0, Math.min(100, hud.health));
  const shieldPct = Math.max(0, Math.min(100, (hud.shield / 50) * 100));
  const energyPct = Math.max(0, Math.min(100, hud.energy));
  const heatPct = Math.max(0, Math.min(100, hud.heat * 100));
  const low = hud.health <= 35 && hud.alive;
  const self = hud.scoreboard.find((r) => r.you);

  return (
    <div className={`hud ${low ? 'low' : ''}`}>
      {/* keyed flashes restart their CSS animation on every new timestamp */}
      {hud.damageFlash > 0 && <div key={`d${hud.damageFlash}`} className="damage-flash" />}
      {hud.killFlash > 0 && <div key={`k${hud.killFlash}`} className="kill-flash" />}
      {low && <div className="low-vignette" />}

      <div className="hud-top">
        <div className="top-left">
          <div className="brand-mini">
            HOVER<span>DRIFT</span>
            <i>ARENA 01</i>
          </div>
          <div className="pilot-line">
            <span className="pilot-name">{self?.name ?? hud.you ?? '—'}</span>
            <span className="pilot-tag">PILOT</span>
          </div>
        </div>

        <div className="clock-panel">
          <div className="clock">{fmtClock(hud.timeLeft)}</div>
          <div className="clock-sub">
            <span className="dot" /> {hud.phase === 'live' ? 'LIVE MATCH' : 'ROUND OVER'}
          </div>
        </div>

        <div className="top-right">
          <div className="stat-chips">
            <span className="chip">
              <b>{self?.kills ?? 0}</b> KILLS
            </span>
            <span className="chip">
              <b>{self?.deaths ?? 0}</b> DEATHS
            </span>
            {settings.showFps && (
              <span className="chip muted">
                {hud.fps} FPS · {hud.ping} MS
              </span>
            )}
          </div>
          <div className="mini-board">
            {hud.scoreboard.slice(0, 4).map((r, i) => (
              <div key={r.id} className={`mini-row ${r.you ? 'you' : ''} ${r.alive ? '' : 'down'}`}>
                <span className="place">{i + 1}</span>
                <span className="swatch" style={{ background: r.color }} />
                <span className="mini-name">{r.name}</span>
                <span className="mini-kills">{r.kills}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="feed">
        {hud.feed.map((f) => (
          <div key={f.id} className="feed-item" style={{ color: f.color }}>
            <span className="feed-bracket">›</span> {f.text}
          </div>
        ))}
      </div>

      {hud.notice && <div className="notice">{hud.notice}</div>}

      <div className="vitals">
        <div className={`bar hull ${low ? 'critical' : ''}`}>
          <span className="bar-label">HULL</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${healthPct}%` }} />
            <div className="bar-ticks" />
          </div>
          <span className="bar-value">{Math.round(hud.health)}</span>
        </div>
        <div className="bar shield">
          <span className="bar-label">SHLD</span>
          <div className="bar-track thin">
            <div className="bar-fill" style={{ width: `${shieldPct}%` }} />
          </div>
          <span className="bar-value">{hud.shield}</span>
        </div>
        <div className={`bar boost ${hud.boost ? 'engaged' : ''}`}>
          <span className="bar-label">BOOST</span>
          <div className="bar-track thin">
            <div className="bar-fill" style={{ width: `${energyPct}%` }} />
          </div>
          <span className="bar-value">{Math.round(hud.energy)}</span>
        </div>
        <div className={`bar heat ${hud.overheat ? 'overheated' : ''}`}>
          <span className="bar-label">{hud.overheat ? 'HOT!' : 'HEAT'}</span>
          <div className="bar-track thin">
            <div className="bar-fill" style={{ width: `${heatPct}%` }} />
          </div>
        </div>
        {hud.overdrive > 0 && (
          <div className="overdrive">
            <span>OVERDRIVE</span>
            <b>{hud.overdrive.toFixed(1)}s</b>
          </div>
        )}
      </div>

      <div className="hud-bottom-left">
        <Radar blips={hud.radar} pickups={hud.radarPickups} />
      </div>

      <div className="hud-bottom-right">
        {mouseUser ? (
          <div className="key-hints">
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> MOVE</span>
            <span><kbd>SHIFT</kbd> BOOST</span>
            <span><kbd>TAB</kbd> RANKS</span>
            <span><kbd>ESC</kbd> PAUSE</span>
          </div>
        ) : (
          <div className="key-hints touch-hint">
            <span>LEFT STICK — THRUST</span>
            <span>RIGHT STICK — AIM &amp; FIRE</span>
          </div>
        )}
        <button className="icon-btn pause-btn" onClick={onPause} aria-label="Pause">
          <span />
          <span />
        </button>
      </div>

      {mouseUser && (
        <div ref={crosshairRef} className={`crosshair ${hud.overheat ? 'hot' : ''}`}>
          <div className="crosshair-ring" style={{ transform: `scale(${1 + hud.heat * 0.9})` }} />
          <div className="crosshair-dot" />
          {hud.hitMarker > 0 && <div key={`h${hud.hitMarker}`} className="hitmarker" />}
        </div>
      )}

      {!hud.alive && hud.phase === 'live' && (
        <div className="respawn">
          <div className="respawn-ring">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" className="track" />
              <circle
                cx="50"
                cy="50"
                r="44"
                className="progress"
                style={{ strokeDashoffset: 276.5 * (1 - Math.min(1, hud.respawnIn / 3.5)) }}
              />
            </svg>
            <b>{Math.max(0, hud.respawnIn).toFixed(1)}</b>
          </div>
          <p>HULL BREACH — REBUILDING</p>
        </div>
      )}

      {(board || hud.phase === 'ended') && (
        <div className="board">
          <div className="board-head">
            <span>PILOT</span>
            <span>K</span>
            <span>D</span>
          </div>
          {hud.scoreboard.map((r) => (
            <div key={r.id} className={`board-row ${r.you ? 'you' : ''}`}>
              <span className="swatch" style={{ background: r.color }} />
              <span className="board-name">
                {r.name}
                {r.bot && <i>BOT</i>}
              </span>
              <span>{r.kills}</span>
              <span>{r.deaths}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
