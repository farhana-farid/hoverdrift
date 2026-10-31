import { useEffect, useRef } from 'react';
import { GameSession } from './game/session';
import type { Quality } from './game/engine';
import { store, useStore, type Settings } from './store';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';
import { TouchControls } from './ui/TouchControls';
import { DisconnectedOverlay, PauseOverlay, ResultsOverlay } from './ui/Overlays';

function pickQuality(pref: Settings['quality']): Quality {
  if (pref !== 'auto') return pref;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return coarse || window.innerWidth < 900 ? 'low' : 'high';
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<GameSession | null>(null);

  const screen = useStore((s) => s.screen);
  const paused = useStore((s) => s.paused);
  const touch = useStore((s) => s.touch);
  const settings = useStore((s) => s.settings);
  const hud = useStore((s) => s.hud);

  useEffect(() => {
    if (!canvasRef.current) return;
    const session = new GameSession(canvasRef.current, pickQuality(store.get().settings.quality));
    sessionRef.current = session;
    if (import.meta.env.DEV) {
      // Dev-only handle for automated smoke checks from the browser console.
      (window as unknown as { __hoverdrift?: GameSession }).__hoverdrift = session;
    }
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    sessionRef.current?.setQuality(pickQuality(settings.quality));
  }, [settings.quality]);

  useEffect(() => {
    sessionRef.current?.applySettings();
  }, [settings]);

  const play = (name: string) => {
    store.setSettings({ name });
    sessionRef.current?.join(name);
  };

  const leave = () => sessionRef.current?.leave();
  const resume = () => sessionRef.current?.setPaused(false);
  const pause = () => sessionRef.current?.setPaused(true);

  const inGame = screen === 'game';
  const playing = inGame && !paused && hud.status === 'live' && hud.phase === 'live';
  const mouseUser = !touch;

  return (
    <div className={`app ${playing ? 'playing' : ''}`}>
      <canvas ref={canvasRef} className="viewport" />

      <div className="vignette" aria-hidden />
      <div className="scanlines" aria-hidden />

      {inGame && <Hud mouseUser={mouseUser} onPause={pause} />}

      {inGame && touch && !paused && hud.phase === 'live' && <TouchControls session={sessionRef} />}

      {screen === 'menu' && <Menu onPlay={play} />}

      {inGame && hud.status === 'connecting' && (
        <div className="overlay">
          <div className="overlay-card linking">
            <h2>ESTABLISHING UPLINK</h2>
            <p className="overlay-sub">Syncing the arena simulation…</p>
            <div className="link-bars">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      )}

      {inGame && paused && hud.status !== 'closed' && (
        <PauseOverlay onResume={resume} onLeave={leave} />
      )}

      {inGame && hud.status === 'closed' && (
        <DisconnectedOverlay reason={hud.notice} onLeave={leave} />
      )}

      {inGame && hud.phase === 'ended' && hud.status !== 'closed' && (
        <ResultsOverlay
          rows={hud.scoreboard}
          onLeave={leave}
          onRequeue={() => play(store.get().settings.name || 'Pilot')}
        />
      )}
    </div>
  );
}
