import { store, useStore } from '../store';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="set-row">
      <span className="set-label">
        {label}
        {hint && <i>{hint}</i>}
      </span>
      {children}
    </label>
  );
}

export function SettingsPanel() {
  const s = useStore((st) => st.settings);
  const set = store.setSettings.bind(store);

  return (
    <div className="settings">
      <Row label="MASTER VOLUME" hint={`${Math.round(s.volume * 100)}%`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={s.volume}
          onChange={(e) => set({ volume: Number(e.target.value) })}
        />
      </Row>
      <Row label="AIM SMOOTHING" hint={s.sensitivity < 0.8 ? 'SMOOTH' : s.sensitivity > 1.4 ? 'SNAPPY' : 'BALANCED'}>
        <input
          type="range"
          min={0.2}
          max={2}
          step={0.05}
          value={s.sensitivity}
          onChange={(e) => set({ sensitivity: Number(e.target.value) })}
        />
      </Row>
      <Row label="SCREEN SHAKE" hint={`${Math.round(s.shake * 100)}%`}>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={s.shake}
          onChange={(e) => set({ shake: Number(e.target.value) })}
        />
      </Row>
      <Row label="RENDER QUALITY">
        <div className="segmented">
          {(['auto', 'high', 'low'] as const).map((q) => (
            <button
              key={q}
              className={s.quality === q ? 'on' : ''}
              onClick={() => set({ quality: q })}
            >
              {q.toUpperCase()}
            </button>
          ))}
        </div>
      </Row>
      <Row label="CAMERA">
        <div className="segmented">
          {(['chase', 'fixed'] as const).map((c) => (
            <button key={c} className={s.camera === c ? 'on' : ''} onClick={() => set({ camera: c })}>
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      </Row>
      <Row label="INVERT STICK Y">
        <button
          className={`toggle ${s.invertStick ? 'on' : ''}`}
          onClick={() => set({ invertStick: !s.invertStick })}
          aria-pressed={s.invertStick}
        >
          <span />
        </button>
      </Row>
      <Row label="PERFORMANCE READOUT">
        <button
          className={`toggle ${s.showFps ? 'on' : ''}`}
          onClick={() => set({ showFps: !s.showFps })}
          aria-pressed={s.showFps}
        >
          <span />
        </button>
      </Row>
    </div>
  );
}
