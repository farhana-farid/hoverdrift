import { useState } from 'react';
import { audio } from '../game/audio';
import type { ScoreRow } from '../store';
import { SettingsPanel } from './SettingsPanel';

export function PauseOverlay({ onResume, onLeave }: { onResume: () => void; onLeave: () => void }) {
  const [tab, setTab] = useState<'pause' | 'settings'>('pause');
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2>{tab === 'pause' ? 'SYSTEM HOLD' : 'CALIBRATION'}</h2>
        <p className="overlay-sub">Simulation keeps running while you hold.</p>

        {tab === 'pause' ? (
          <div className="overlay-actions">
            <button
              className="cta small"
              onClick={() => {
                audio.ui();
                onResume();
              }}
            >
              RESUME FLIGHT
            </button>
            <button
              className="ghost-btn wide"
              onClick={() => {
                audio.ui();
                setTab('settings');
              }}
            >
              SETTINGS
            </button>
            <button
              className="ghost-btn wide danger"
              onClick={() => {
                audio.ui(false);
                onLeave();
              }}
            >
              ABANDON MATCH
            </button>
          </div>
        ) : (
          <>
            <SettingsPanel />
            <button
              className="ghost-btn wide"
              onClick={() => {
                audio.ui();
                setTab('pause');
              }}
            >
              BACK
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function DisconnectedOverlay({ reason, onLeave }: { reason: string | null; onLeave: () => void }) {
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2 className="danger-text">LINK LOST</h2>
        <p className="overlay-sub">
          {reason ?? 'The arena server stopped responding.'}
          <br />
          Is the game server running on port 8080?
        </p>
        <div className="overlay-actions">
          <button className="cta small" onClick={onLeave}>
            BACK TO MENU
          </button>
        </div>
      </div>
    </div>
  );
}

export function ResultsOverlay({
  rows,
  onLeave,
  onRequeue,
}: {
  rows: ScoreRow[];
  onLeave: () => void;
  onRequeue: () => void;
}) {
  const winner = rows[0];
  return (
    <div className="overlay results">
      <div className="overlay-card wide-card">
        <div className="results-head">
          <span className="results-kicker">ROUND COMPLETE</span>
          <h2>{winner ? `${winner.name} TAKES THE ARENA` : 'DRAW'}</h2>
        </div>
        <div className="results-table">
          {rows.map((r, i) => (
            <div key={r.id} className={`result-row ${r.you ? 'you' : ''}`}>
              <span className="place">{i + 1}</span>
              <span className="swatch" style={{ background: r.color }} />
              <span className="result-name">
                {r.name}
                {r.bot && <i>BOT</i>}
              </span>
              <span className="result-k">{r.kills} K</span>
              <span className="result-d">{r.deaths} D</span>
            </div>
          ))}
        </div>
        <p className="overlay-sub">A fresh round starts automatically. Requeue for a new lobby now.</p>
        <div className="overlay-actions row">
          <button className="cta small" onClick={onRequeue}>
            REQUEUE
          </button>
          <button className="ghost-btn wide" onClick={onLeave}>
            BACK TO MENU
          </button>
        </div>
      </div>
    </div>
  );
}
