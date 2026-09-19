import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RmkTrackballClient,
  type RmkLayerTrackballProfile,
  type RmkTrackballConfig,
  type RmkTrackballState,
} from './rmkTrackballProtocol';
import './rmkTrackball.css';

function cloneConfig(value: RmkTrackballConfig) { return { ...value }; }
function rotationLabel(value: number) { return `${value * 90}°`; }
function modeLabel(value: 'cursor' | 'scroll') { return value === 'cursor' ? 'Cursor' : 'Scroll'; }
function layerLabel(layer: number) {
  if (layer === 0) return 'Base';
  if (layer === 1) return 'Num';
  if (layer === 2) return 'Sym';
  return `Layer ${layer}`;
}

export default function RmkTrackballSettings({
  onDebug,
  autoConnect = false,
}: {
  onDebug: (event: string, detail?: unknown) => void;
  autoConnect?: boolean;
}) {
  const clientRef = useRef<RmkTrackballClient | null>(null);
  const [connectedLabel, setConnectedLabel] = useState('');
  const [right, setRight] = useState<RmkTrackballConfig | null>(null);
  const [left, setLeft] = useState<RmkTrackballConfig | null>(null);
  const [liveState, setLiveState] = useState<RmkTrackballState | null>(null);
  const [profileLayer, setProfileLayer] = useState(0);
  const [visibleLayerCount] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem('mykeebstudio-rmk-visible-layers') || 4);
      return Math.max(1, Math.min(8, Number.isFinite(saved) ? saved : 4));
    } catch {
      return 4;
    }
  });
  const [rightProfile, setRightProfile] = useState<RmkLayerTrackballProfile | null>(null);
  const [leftProfile, setLeftProfile] = useState<RmkLayerTrackballProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Connect the already-paired RMK keyboard over Bluetooth WebHID.');
  const [error, setError] = useState<string | null>(null);

  const connected = !!clientRef.current;
  const leftCpiWritable = !!left && (left.capabilities & 0x01) !== 0;
  const rightSpeed = useMemo(() => right ? (right.cursorGainQ8 / 256).toFixed(2) : '1.00', [right]);
  const leftSpeed = useMemo(() => left ? (left.cursorGainQ8 / 256).toFixed(2) : '1.00', [left]);

  async function loadLayerProfiles(layer: number) {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const rightLayer = await client.getLayerTrackballProfile(layer, 0);
      const leftLayer = await client.getLayerTrackballProfile(layer, 1);
      setProfileLayer(layer);
      setRightProfile(rightLayer);
      setLeftProfile(leftLayer);
      setMessage(`Loaded ${layerLabel(layer)} trackball profile.`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage(`Could not load ${layerLabel(layer)} trackball profile.`);
    } finally {
      setBusy(false);
    }
  }

  async function applyLayerProfile(next: RmkLayerTrackballProfile) {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      if (next.deviceId === 0) setRightProfile(next); else setLeftProfile(next);
      await client.setLayerTrackballProfile(next);
      if (liveState?.activeLayer === next.layer) {
        const state = await client.getTrackballState();
        setLiveState(state);
      }
      setMessage(`${layerLabel(next.layer)} ${next.deviceId === 0 ? 'Right' : 'Left'} profile applied live. Save to keyboard to persist.`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage('Layer trackball profile update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function reloadConfigs() {
    const client = clientRef.current;
    if (!client) return;
    // RmkTrackballClient intentionally allows only one in-flight Rynk request.
    // Keep these sequential so route-switch auto reconnect cannot trip
    // "Another RMK request is still pending."
    const r = await client.getTrackballConfig(0);
    const l = await client.getTrackballConfig(1);
    const state = await client.getTrackballState();
    setRight(r);
    setLeft(l);
    setLiveState(state);
  }

  useEffect(() => {
    if (!connectedLabel) return;
    const timer = window.setInterval(() => {
      const client = clientRef.current;
      if (!client || busy) return;
      void client.getTrackballState().then(setLiveState).catch(() => { /* transient BLE/WebHID miss */ });
    }, 500);
    return () => window.clearInterval(timer);
  }, [connectedLabel, busy]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!autoConnect || cancelled || clientRef.current) return;
      void connect(true);
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      const client = clientRef.current;
      clientRef.current = null;
      if (client) void client.close();
    };
  }, [autoConnect]);

  async function connect(auto = false) {
    setBusy(true);
    setError(null);
    setMessage('Opening RMK BLE WebHID…');
    try {
      const client = await RmkTrackballClient.connect(auto);
      clientRef.current = client;
      setConnectedLabel(client.label);
      const r = await client.getTrackballConfig(0);
      const l = await client.getTrackballConfig(1);
      const state = await client.getTrackballState();
      setRight(r);
      setLeft(l);
      setLiveState(state);
      const rightLayer = await client.getLayerTrackballProfile(state.activeLayer, 0);
      const leftLayer = await client.getLayerTrackballProfile(state.activeLayer, 1);
      setProfileLayer(state.activeLayer);
      setRightProfile(rightLayer);
      setLeftProfile(leftLayer);
      setMessage('RMK trackball controls ready. Layer profiles are editable live; Save is flash-verified.');
      onDebug('RMK trackball connected', { label: client.label, right: r, left: l, state });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage(auto ? 'RMK connection is ready to reopen. Use Connect if needed.' : 'RMK BLE connection failed.');
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
    try { await clientRef.current?.close(); }
    finally {
      clientRef.current = null;
      setConnectedLabel('');
      setRight(null);
      setLeft(null);
      setLiveState(null);
      setRightProfile(null);
      setLeftProfile(null);
      setProfileLayer(0);
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
      const state = await client.getTrackballState();
      if (next.deviceId === 0) setRight(fresh); else setLeft(fresh);
      setLiveState(state);
      setMessage('Applied live to the keyboard.');
      onDebug('RMK trackball config applied', fresh);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('RMK trackball config failed', text);
    } finally { setBusy(false); }
  }

  async function saveToKeyboard() {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setError(null);
    setMessage('Saving to keyboard flash…');
    try {
      await client.saveTrackballConfig();
      const status = await client.waitForSaveComplete();
      setMessage(`Saved to keyboard flash · verified generation ${status.completedGeneration}.`);
      onDebug('RMK trackball config flash-verified', status);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage('Trackball settings were not confirmed saved.');
      onDebug('RMK trackball save failed', text);
    } finally { setBusy(false); }
  }

  async function loadDefaults() {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      await client.loadTrackballDefaults();
      await reloadConfigs();
      setMessage('Firmware defaults restored live. Press Save to keyboard to keep them after reboot.');
      onDebug('RMK trackball defaults restored');
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('RMK trackball defaults failed', text);
    } finally { setBusy(false); }
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

  function layerProfileCard(profile: RmkLayerTrackballProfile, side: 'Right' | 'Left') {
    const setter = side === 'Right' ? setRightProfile : setLeftProfile;
    return (
      <section className="panel rmk-trackball-card rmk-layer-profile-card">
        <div className="panel-heading">
          <div>
            <h3>{side} Trackball</h3>
            <p>{layerLabel(profile.layer)} behavior</p>
          </div>
          <span className="pill">{modeLabel(profile.mode)}</span>
        </div>

        <div className="rmk-layer-mode-buttons" role="group" aria-label={`${side} trackball mode`}>
          {(['cursor', 'scroll'] as const).map((nextMode) => (
            <button
              type="button"
              key={nextMode}
              className={`button ${profile.mode === nextMode ? '' : 'secondary'}`}
              disabled={busy}
              onClick={() => void applyLayerProfile({ ...profile, mode: nextMode })}
            >
              {modeLabel(nextMode)}
            </button>
          ))}
        </div>

        <label className="rmk-setting-row vertical">
          <span>
            <strong>Cursor speed</strong>
            <small>{(profile.cursorGainQ8 / 256).toFixed(2)}x</small>
          </span>
          <input
            type="range"
            min={64}
            max={768}
            step={16}
            value={profile.cursorGainQ8}
            disabled={busy}
            onChange={(event) => setter({ ...profile, cursorGainQ8: Number(event.target.value) })}
            onPointerUp={(event) => void applyLayerProfile({ ...profile, cursorGainQ8: Number((event.currentTarget as HTMLInputElement).value) })}
          />
        </label>

        <label className="rmk-setting-row vertical">
          <span>
            <strong>Scroll speed</strong>
            <small>1/{profile.scrollScaleDen}</small>
          </span>
          <input
            type="range"
            min={1}
            max={16}
            step={1}
            value={profile.scrollScaleDen}
            disabled={busy}
            onChange={(event) => setter({ ...profile, scrollScaleDen: Number(event.target.value) })}
            onPointerUp={(event) => void applyLayerProfile({ ...profile, scrollScaleDen: Number((event.currentTarget as HTMLInputElement).value) })}
          />
        </label>

        <label className="rmk-setting-row">
          <span><strong>Scroll inertia</strong><small>Used when this layer is in Scroll mode</small></span>
          <input
            type="checkbox"
            checked={profile.inertiaEnabled}
            disabled={busy}
            onChange={(event) => void applyLayerProfile({ ...profile, inertiaEnabled: event.target.checked })}
          />
        </label>
      </section>
    );
  }

  function card(config: RmkTrackballConfig, side: 'Right' | 'Left') {
    const isRight = side === 'Right';
    const setter = isRight ? setRightDraft : setLeftDraft;
    const currentMode = isRight ? (liveState?.rightMode ?? config.mode) : (liveState?.leftMode ?? config.mode);
    const speed = isRight ? rightSpeed : leftSpeed;
    const cpiWritable = isRight || leftCpiWritable;

    return (
      <section className="panel rmk-trackball-card">
        <div className="panel-heading">
          <div>
            <h3>{side} Trackball</h3>
            <p>{modeLabel(currentMode)} · device {config.deviceId}</p>
          </div>
          <span className="pill">{modeLabel(currentMode)}</span>
        </div>

        <label className="rmk-setting-row">
          <span><strong>CPI</strong><small>{isRight ? 'PAW3222 sensor resolution' : 'Forwarded to split peripheral and re-synced on reconnect'}</small></span>
          <input type="number" min={100} max={5000} step={38} value={config.cpi}
            disabled={!cpiWritable || busy} readOnly={!cpiWritable}
            onChange={(event) => setter({ cpi: Number(event.target.value) })}
            onBlur={() => cpiWritable && void apply(cloneConfig(config))} />
        </label>

        <label className="rmk-setting-row vertical">
          <span><strong>Cursor Base Speed</strong><small>{speed}x · layer profiles may override this value</small></span>
          <input type="range" min={64} max={768} step={16} value={config.cursorGainQ8} disabled={busy}
            onChange={(event) => setter({ cursorGainQ8: Number(event.target.value) })}
            onPointerUp={() => void apply(cloneConfig(config))} />
        </label>

        <label className="rmk-setting-row vertical">
          <span><strong>Scroll Base Speed</strong><small>1/{config.scrollScaleDen} · layer profiles may override this value</small></span>
          <input type="range" min={2} max={16} step={1} value={config.scrollScaleDen} disabled={busy}
            onChange={(event) => setter({ scrollScaleDen: Number(event.target.value) })}
            onPointerUp={() => void apply(cloneConfig(config))} />
        </label>

        <label className="rmk-setting-row">
          <span><strong>Scroll Inertia</strong><small>Used whenever this side is in Scroll mode</small></span>
          <input type="checkbox" checked={config.inertiaEnabled} disabled={busy}
            onChange={(event) => { const next = setter({ inertiaEnabled: event.target.checked }); if (next) void apply(next); }} />
        </label>

        <label className="rmk-setting-row vertical">
          <span><strong>Inertia Strength</strong><small>Decay {config.inertiaDecayNum}/{config.inertiaDecayDen}</small></span>
          <input type="range" min={4} max={15} step={1} value={config.inertiaDecayNum} disabled={busy}
            onChange={(event) => setter({ inertiaDecayNum: Number(event.target.value), inertiaDecayDen: 16 })}
            onPointerUp={() => void apply(cloneConfig(config))} />
        </label>

        <label className="rmk-setting-row vertical">
          <span><strong>Direction Noise Filter</strong><small>Ignore reverse jitter below {config.directionNoiseThreshold}</small></span>
          <input type="range" min={1} max={8} step={1} value={config.directionNoiseThreshold} disabled={busy}
            onChange={(event) => setter({ directionNoiseThreshold: Number(event.target.value) })}
            onPointerUp={() => void apply(cloneConfig(config))} />
        </label>

        <label className="rmk-setting-row vertical">
          <span><strong>Intentional Reverse Threshold</strong><small>Reverse direction at {config.directionReverseThreshold} or more</small></span>
          <input type="range" min={2} max={16} step={1} value={config.directionReverseThreshold} disabled={busy}
            onChange={(event) => setter({ directionReverseThreshold: Number(event.target.value) })}
            onPointerUp={() => void apply(cloneConfig(config))} />
        </label>

        <label className="rmk-setting-row">
          <span><strong>Sensor Rotation</strong><small>Applied before cursor / scroll processing</small></span>
          <select value={config.rotation} disabled={busy}
            onChange={(event) => { const next = setter({ rotation: Number(event.target.value) as 0 | 1 | 2 | 3 }); if (next) void apply(next); }}>
            {[0, 1, 2, 3].map((value) => <option key={value} value={value}>{rotationLabel(value)}</option>)}
          </select>
        </label>
      </section>
    );
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
          <button className="button" type="button" disabled={busy} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Connect RMK BLE'}</button>
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

      {liveState && (
        <div className="panel rmk-trackball-footnote">
          <strong>Active profile: {layerLabel(liveState.activeLayer)}</strong>
          <span>
            Left {modeLabel(liveState.leftMode)} · Right {modeLabel(liveState.rightMode)} ·
            {' '}effective gains L {(liveState.leftEffectiveGainQ8 / 256).toFixed(2)}x / R {(liveState.rightEffectiveGainQ8 / 256).toFixed(2)}x ·
            {' '}scroll L 1/{liveState.leftEffectiveScrollDen} / R 1/{liveState.rightEffectiveScrollDen}
          </span>
          <small>Layer behavior is now editable from Trackball Layer Profiles below.</small>
        </div>
      )}

      <section className="panel rmk-layer-profile-editor">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">Per-layer behavior</div>
            <h3>Trackball Layer Profiles</h3>
            <p>Choose a layer, then set Cursor / Scroll, speed and inertia independently for each side.</p>
          </div>
          {liveState && <span className="pill">Active: {layerLabel(liveState.activeLayer)}</span>}
        </div>

        <div className="rmk-trackball-layer-tabs">
          {Array.from({ length: visibleLayerCount }, (_, index) => (
            <button
              type="button"
              key={index}
              className={`button ${profileLayer === index ? '' : 'secondary'}`}
              disabled={busy}
              onClick={() => void loadLayerProfiles(index)}
            >
              {layerLabel(index)}
              {liveState?.activeLayer === index ? ' •' : ''}
            </button>
          ))}
        </div>

        {rightProfile && leftProfile ? (
          <div className="rmk-trackball-grid rmk-layer-profile-grid">
            {layerProfileCard(rightProfile, 'Right')}
            {layerProfileCard(leftProfile, 'Left')}
          </div>
        ) : (
          <div className="empty">Layer profile is loading…</div>
        )}
      </section>

      <div className="panel rmk-trackball-footnote">
        <strong>Sensor-wide settings</strong>
        <span>CPI, rotation, noise filtering and inertia strength below are hardware-wide settings. Layer-specific mode/speed/inertia are controlled above.</span>
      </div>

      <div className="rmk-trackball-grid">
        {card(right, 'Right')}
        {card(left, 'Left')}
      </div>

      <div className="panel rmk-trackball-footnote">
        <strong>Keyboard storage</strong>
        <span>Live changes take effect immediately. Save waits for RMK flash write completion before reporting success.</span>
        <div className="rmk-trackball-actions">
          <button className="button" type="button" disabled={busy} onClick={() => void saveToKeyboard()}>{busy ? 'Working…' : 'Save to keyboard'}</button>
          <button className="button secondary" type="button" disabled={busy} onClick={() => void loadDefaults()}>Load defaults</button>
        </div>
      </div>
    </div>
  );
}
