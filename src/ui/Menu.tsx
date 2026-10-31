import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { SettingsPanel } from './SettingsPanel';
import { audio } from '../game/audio';

const defaultCallsign = () => `PILOT-${Math.floor(1000 + Math.random() * 9000)}`;

function Controls() {
  const touch = useStore((s) => s.touch);
  return (
    <div className="controls-grid">
      <div className="ctrl-col">
        <h4>KEYBOARD + MOUSE</h4>
        <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> thrust</p>
        <p><kbd>MOUSE</kbd> aim turret</p>
        <p><kbd>LMB</kbd> / <kbd>SPACE</kbd> fire</p>
        <p><kbd>SHIFT</kbd> boost</p>
        <p><kbd>TAB</kbd> standings · <kbd>ESC</kbd> pause</p>
      </div>
      <div className="ctrl-col">
        <h4>GAMEPAD</h4>
        <p><kbd>L-STICK</kbd> thrust</p>
        <p><kbd>R-STICK</kbd> aim turret</p>
        <p><kbd>RT</kbd> / <kbd>A</kbd> fire</p>
        <p><kbd>LT</kbd> / <kbd>X</kbd> boost</p>
        <p><kbd>START</kbd> pause</p>
      </div>
      {touch && (
        <div className="ctrl-col">
          <h4>TOUCH</h4>
          <p>Left thumb — thrust</p>
          <p>Right thumb — aim &amp; auto-fire</p>
          <p>Boost pad — thrust afterburner</p>
        </div>
      )}
    </div>
  );
}

export function Menu({ onPlay }: { onPlay: (name: string) => void }) {
  const settings = useStore((s) => s.settings);
  const touch = useStore((s) => s.touch);
  const [tab, setTab] = useState<'deploy' | 'controls' | 'settings'>('deploy');
  const [name, setName] = useState(settings.name || defaultCallsign());

  const deploy = () => {
    audio.resume();
    audio.ui();
    onPlay(name.trim() || defaultCallsign());
  };

  // Enter / Space deploys, as advertised in the footer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      deploy();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const toggleFullscreen = () => {
    audio.ui();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className="menu">
      <div className="menu-hero">
        <div className="logo">
          HOVER<span>DRIFT</span>
        </div>
        <p className="tagline">
          Simulation-grade hover combat in a closed arena.
          <br />
          Physics props, plasma turrets, live pilots — and bots that mean it.
        </p>

        <div className="hero-stats">
          <div>
            <b>60</b>
            <span>HZ AUTHORITATIVE SIM</span>
          </div>
          <div>
            <b>20</b>
            <span>HZ SNAPSHOTS</span>
          </div>
          <div>
            <b>8</b>
            <span>PILOTS PER ARENA</span>
          </div>
        </div>
      </div>

      <div className="menu-panel">
        <nav className="tabs">
          {(
            [
              ['deploy', 'DEPLOY'],
              ['controls', 'CONTROLS'],
              ['settings', 'SETTINGS'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              onClick={() => {
                audio.ui();
                setTab(key);
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === 'deploy' && (
          <div className="deploy">
            <label className="field">
              <span>CALLSIGN</span>
              <input
                value={name}
                maxLength={14}
                spellCheck={false}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') deploy();
                }}
                placeholder="PILOT"
              />
            </label>

            <button className="cta" onClick={deploy}>
              <span className="cta-glow" />
              ENTER ARENA
            </button>

            <div className="mode-card">
              <div className="mode-head">
                <span>DEATHMATCH</span>
                <em>BOT-FILLED · 3:00</em>
              </div>
              <p>
                Free-for-all with resupply drops and overdrive. Three bots deploy instantly; every pilot who
                opens this page lands in the same arena.
              </p>
            </div>

            <div className="quick-row">
              <button className="ghost-btn" onClick={toggleFullscreen}>
                FULLSCREEN
              </button>
              <span className="quick-note">{touch ? 'Touch controls detected' : 'Mouse + keyboard ready'}</span>
            </div>
          </div>
        )}

        {tab === 'controls' && <Controls />}
        {tab === 'settings' && <SettingsPanel />}
      </div>

      <footer className="menu-footer">
        <span className="pulse-dot" /> SERVER MESH ONLINE
        <span className="sep">/</span> WEBGL2 + REAL-TIME PHYSICS
        <span className="sep">/</span> SPACE OR ENTER TO DEPLOY
      </footer>
    </div>
  );
}
