import { useMemo, useRef, useState } from 'react';
import { RmkTrackballClient, type RmkTrackballConfig } from './rmkTrackballProtocol';
import './rmkTrackball.css';

function cloneConfig(value: RmkTrackballConfig) {
  return { ...value };
}

function rotationLabel(value: number) {
  return `${value * 90}°`;
}

export default function RmkTrackballSettings({ onDebug }: { onDebug: (event: string, detail?: unknown) => void }) {
  const clientRef = useRef<RmkTrackballClient | null>(null);
  const [connectedLabel, setConnectedLabel] = useState('');
  const [right, setRight] = useState<RmkTrackballConfig | null>(null);
  const [left, setLeft] = useState<RmkTrackballConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Connect the already-paired RMK keyboard over Bluetooth WebHID.');
  const [error, setError] = useState<string | null>(null);

  const connected = !!clientRef.current;
  const leftCpiWritable = !!left && (left.capabilities & 0x01) !== 0;

  const rightSpeed = useMemo(() => right ? (right.cursorGainQ8 / 256).toFixed(2) : '1.00', [right]);
  const leftScroll = useMemo(() => left ? (1 / Math.max(1, left.scrollScaleDen)).toFixed(2) : '0.17', [left]);

  async function connect() {
    setBusy(true);
    setError(null);
    setMessage('Opening RMK BLE WebHID…');
    try {
      const client = await RmkTrackballClient.connect();
      clientRef.current = client;
      setConnectedLabel(client.label);
      // Rynk uses one request/response slot; read each device sequentially.
      const r = await client.getTrackballConfig(0);
      const l = await client.getTrackballConfig(1);
      setRight(r);
      setLeft(l);
      setMessage('RMK trackball runtime controls ready. Changes apply immediately and reset after reboot.');
      onDebug('RMK trackball connected', { label: client.label, right: r, left: l });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage('RMK BLE connection failed.');
      onDebug('RMK trackball connect failed', text);
      if (clientRef.current) await clientRef.current.close();
      clientRef.current = null;
      setConnectedLabel('');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await clientRef.current?.close();
    } finally {
      clientRef.current = null;
      setConnectedLabel('');
      setRight(null);
      setLeft(null);
      setError(null);
      setMessage('Disconnected from RMK WebHID.');
      setBusy(false);
    }
  }

  async function apply(next: RmkTrackballConfig) {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      await client.setTrackballConfig(next);
      const fresh = await client.getTrackballConfig(next.deviceId);
      if (next.deviceId === 0) setRight(fresh);
      else setLeft(fresh);
      setMessage('Applied live to the keyboard.');
      onDebug('RMK trackball config applied', fresh);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('RMK trackball config failed', text);
    } finally {
      setBusy(false);
    }
  }

  function setRightDraft(patch: Partial<RmkTrackballConfig>) {
    if (!right) return null;
    const next = { ...right, ...patch };
    setRight(next);
    return next;
  }

  function setLeftDraft(patch: Partial<RmkTrackballConfig>) {
    if (!left) return null;
    const next = { ...left, ...patch };
    setLeft(next);
    return next;
  }

  if (!connected || !right || !left) {
    return (
      <div className="panel rmk-trackball-connect">
        <div>
          <div className="eyebrow">RMK / Rynk</div>
          <h3>Trackball Live Tuning</h3>
          <p>{message}</p>
          <p className="rmk-trackball-note">Windows must already be connected to <strong>PG1KB-PH3</strong> over Bluetooth. Chrome / Edge only.</p>
          {error && <div className="notice">{error}</div>}
          <button className="button" type="button" disabled={busy} onClick={() => void connect()}>
            {busy ? 'Connecting…' : 'Connect RMK BLE'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rmk-trackball-root">
      <div className="status-strip panel rmk-trackball-status">
        <span>RMK Rynk WebHID live</span>
        <code>{connectedLabel}</code>
        <span>{message}</span>
        <button className="button secondary" type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="rmk-trackball-grid">
        <section className="panel rmk-trackball-card">
          <div className="panel-heading">
            <div><h3>Right Trackball</h3><p>Cursor · device 0</p></div>
            <span className="pill">Live</span>
          </div>

          <label className="rmk-setting-row">
            <span><strong>CPI</strong><small>PAW3222 sensor resolution</small></span>
            <input
              type="number" min={100} max={5000} step={38} value={right.cpi} disabled={busy}
              onChange={(event) => setRightDraft({ cpi: Number(event.target.value) })}
              onBlur={() => right && void apply(cloneConfig(right))}
            />
          </label>

          <label className="rmk-setting-row vertical">
            <span><strong>Cursor Speed</strong><small>{rightSpeed}x software gain</small></span>
            <input
              type="range" min={64} max={768} step={16} value={right.cursorGainQ8} disabled={busy}
              onChange={(event) => setRightDraft({ cursorGainQ8: Number(event.target.value) })}
              onPointerUp={() => right && void apply(cloneConfig(right))}
            />
          </label>

          <label className="rmk-setting-row">
            <span><strong>Sensor Rotation</strong><small>Apply before cursor processing</small></span>
            <select
              value={right.rotation} disabled={busy}
              onChange={(event) => {
                const next = setRightDraft({ rotation: Number(event.target.value) as 0 | 1 | 2 | 3 });
                if (next) void apply(next);
              }}
            >
              {[0, 1, 2, 3].map((value) => <option key={value} value={value}>{rotationLabel(value)}</option>)}
            </select>
          </label>
        </section>

        <section className="panel rmk-trackball-card">
          <div className="panel-heading">
            <div><h3>Left Trackball</h3><p>Scroll · device 1</p></div>
            <span className="pill">Live</span>
          </div>

          <label className="rmk-setting-row">
            <span><strong>CPI</strong><small>{leftCpiWritable ? 'Sensor resolution' : 'Fixed on split peripheral for now'}</small></span>
            <input type="number" value={left.cpi} disabled={!leftCpiWritable || busy} readOnly={!leftCpiWritable} />
          </label>

          <label className="rmk-setting-row vertical">
            <span><strong>Scroll Speed</strong><small>{leftScroll}x · current 1/{left.scrollScaleDen}</small></span>
            <input
              type="range" min={2} max={16} step={1} value={left.scrollScaleDen} disabled={busy}
              onChange={(event) => setLeftDraft({ scrollScaleDen: Number(event.target.value) })}
              onPointerUp={() => left && void apply(cloneConfig(left))}
            />
          </label>

          <label className="rmk-setting-row">
            <span><strong>Scroll Inertia</strong><small>Continue scrolling after the ball stops</small></span>
            <input
              type="checkbox" checked={left.inertiaEnabled} disabled={busy}
              onChange={(event) => {
                const next = setLeftDraft({ inertiaEnabled: event.target.checked });
                if (next) void apply(next);
              }}
            />
          </label>

          <label className="rmk-setting-row vertical">
            <span><strong>Inertia Strength</strong><small>Decay {left.inertiaDecayNum}/{left.inertiaDecayDen}</small></span>
            <input
              type="range" min={4} max={15} step={1} value={left.inertiaDecayNum} disabled={busy || !left.inertiaEnabled}
              onChange={(event) => setLeftDraft({ inertiaDecayNum: Number(event.target.value), inertiaDecayDen: 16 })}
              onPointerUp={() => left && void apply(cloneConfig(left))}
            />
          </label>

          <label className="rmk-setting-row">
            <span><strong>Sensor Rotation</strong><small>Use this to correct a 90°/180°/270° sensor mount</small></span>
            <select
              value={left.rotation} disabled={busy}
              onChange={(event) => {
                const next = setLeftDraft({ rotation: Number(event.target.value) as 0 | 1 | 2 | 3 });
                if (next) void apply(next);
              }}
            >
              {[0, 1, 2, 3].map((value) => <option key={value} value={value}>{rotationLabel(value)}</option>)}
            </select>
          </label>
        </section>
      </div>

      <div className="panel rmk-trackball-footnote">
        <strong>Runtime preview</strong>
        <span>These values apply immediately but are not stored in flash yet. Reboot restores the firmware defaults.</span>
      </div>
    </div>
  );
}
