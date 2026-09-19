import { useMemo, useRef, useState } from 'react';
import {
  makeHidKeyAction,
  makeLayerOnAction,
  makeLayerToggleAction,
  makeNoAction,
  makeTransparentAction,
  openRynkSession,
  rynkActionLabel,
  type RynkSession,
} from './rmkRynkWasm';
import { RMK_JPKEYS, RMK_JPKEYS_ABI, rmkJpDisplayLabel } from './rmkJpKeys';
import './rmkKeymap.css';

type Caps = {
  num_layers?: number;
  num_rows?: number;
  num_cols?: number;
};

type SelectedKey = { layer: number; row: number; col: number; index: number } | null;
type MatrixPos = readonly [row: number, col: number];
type PhysicalKey = { matrix: MatrixPos; x: number; y: number };

// Exact PG1KB physical layout from the ZMK shield's physical-layout + matrix-transform.
// Coordinates use the same 100-unit key size / 25-unit stagger system as pg1kb_proto.dtsi.
const PG1KB_PHYSICAL_KEYS: readonly PhysicalKey[] = [
  { matrix: [1,5], x: 0,    y: 75 }, { matrix: [1,4], x: 100,  y: 75 },
  { matrix: [0,1], x: 400,  y: 0  }, { matrix: [0,0], x: 500,  y: 25 },
  { matrix: [0,6], x: 650,  y: 25 }, { matrix: [0,7], x: 750,  y: 0  },
  { matrix: [1,10],x: 1050, y: 75 }, { matrix: [1,11],x: 1150, y: 75 },

  { matrix: [2,5], x: 0,    y: 175 }, { matrix: [2,4], x: 100,  y: 175 },
  { matrix: [1,3], x: 200,  y: 100 }, { matrix: [1,2], x: 300,  y: 100 },
  { matrix: [1,1], x: 400,  y: 100 }, { matrix: [1,0], x: 500,  y: 125 },
  { matrix: [1,6], x: 650,  y: 125 }, { matrix: [1,7], x: 750,  y: 100 },
  { matrix: [1,8], x: 850,  y: 100 }, { matrix: [1,9], x: 950,  y: 100 },
  { matrix: [2,10],x: 1050, y: 175 }, { matrix: [2,11],x: 1150, y: 175 },

  { matrix: [3,5], x: 0,    y: 275 }, { matrix: [3,4], x: 100,  y: 275 },
  { matrix: [2,3], x: 200,  y: 200 }, { matrix: [2,2], x: 300,  y: 200 },
  { matrix: [2,1], x: 400,  y: 200 }, { matrix: [2,0], x: 500,  y: 225 },
  { matrix: [2,6], x: 650,  y: 225 }, { matrix: [2,7], x: 750,  y: 200 },
  { matrix: [2,8], x: 850,  y: 200 }, { matrix: [2,9], x: 950,  y: 200 },
  { matrix: [3,10],x: 1050, y: 275 }, { matrix: [3,11],x: 1150, y: 275 },

  { matrix: [4,5], x: 0,    y: 375 }, { matrix: [4,4], x: 100,  y: 375 },
  { matrix: [3,3], x: 200,  y: 300 }, { matrix: [3,2], x: 300,  y: 300 },
  { matrix: [3,1], x: 400,  y: 300 }, { matrix: [3,0], x: 500,  y: 325 },
  { matrix: [3,6], x: 650,  y: 325 }, { matrix: [3,7], x: 750,  y: 300 },
  { matrix: [3,8], x: 850,  y: 300 }, { matrix: [3,9], x: 950,  y: 300 },
  { matrix: [4,10],x: 1050, y: 375 }, { matrix: [4,11],x: 1150, y: 375 },

  { matrix: [4,3], x: 200,  y: 400 }, { matrix: [4,2], x: 300,  y: 400 },
  { matrix: [4,1], x: 400,  y: 400 }, { matrix: [4,0], x: 500,  y: 425 },
  { matrix: [4,6], x: 650,  y: 425 }, { matrix: [4,7], x: 750,  y: 400 },
  { matrix: [4,8], x: 850,  y: 400 }, { matrix: [4,9], x: 950,  y: 400 },
];

function actionIndex(layer: number, row: number, col: number, rows: number, cols: number) {
  return layer * rows * cols + row * cols + col;
}

function displayActionLabel(action: any) {
  return rmkJpDisplayLabel(action) ?? rynkActionLabel(action);
}

function layerLabel(index: number) {
  if (index === 0) return 'Base';
  if (index === 1) return 'Num';
  if (index === 2) return 'Sym';
  if (index === 3) return 'Sys';
  return `Layer ${index}`;
}

export default function RmkKeymapSettings({ onDebug }: { onDebug: (event: string, detail?: unknown) => void }) {
  const sessionRef = useRef<RynkSession | null>(null);
  const [label, setLabel] = useState('');
  const [caps, setCaps] = useState<Caps | null>(null);
  const [actions, setActions] = useState<any[]>([]);
  const [hidKeys, setHidKeys] = useState<string[]>([]);
  const [layer, setLayer] = useState(0);
  const [selected, setSelected] = useState<SelectedKey>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Connect the already-paired RMK keyboard over Rynk WebHID.');
  const [error, setError] = useState<string | null>(null);

  const rows = caps?.num_rows ?? 0;
  const cols = caps?.num_cols ?? 0;
  const layers = caps?.num_layers ?? 0;
  const connected = !!sessionRef.current;

  const usePg1kbPhysicalLayout = rows === 5 && cols === 12;

  async function connect() {
    setBusy(true);
    setError(null);
    setMessage('Opening official Rynk WASM session…');
    try {
      const session = await openRynkSession();
      sessionRef.current = session;
      const [nextCaps, deviceInfo, keymap] = await Promise.all([
        session.client.get_capabilities(),
        session.client.get_device_info(),
        session.client.read_all_keymap(),
      ]);
      const catalog = Array.from(session.module.all_hid_keycodes?.() ?? []).map(String);
      setCaps(nextCaps);
      setActions(Array.from(keymap));
      setHidKeys(catalog);
      setLabel(deviceInfo?.product_name || deviceInfo?.name || session.link.label);
      setLayer(0);
      setSelected(null);
      setMessage(`Loaded ${nextCaps.num_layers} layer(s), ${nextCaps.num_rows}×${nextCaps.num_cols}.`);
      onDebug('Rynk keymap connected', { caps: nextCaps, keyCount: keymap.length, label: session.link.label });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage('Rynk keymap connection failed.');
      if (sessionRef.current) await sessionRef.current.link.close();
      sessionRef.current = null;
      onDebug('Rynk keymap connect failed', text);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await sessionRef.current?.link.close();
    } finally {
      sessionRef.current = null;
      setLabel('');
      setCaps(null);
      setActions([]);
      setHidKeys([]);
      setSelected(null);
      setError(null);
      setMessage('Disconnected from Rynk WebHID.');
      setBusy(false);
    }
  }

  async function refresh() {
    const session = sessionRef.current;
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const keymap = await session.client.read_all_keymap();
      setActions(Array.from(keymap));
      setMessage('Keymap refreshed from keyboard.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function setSelectedAction(action: any) {
    const session = sessionRef.current;
    if (!session || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await session.client.set_key(selected.layer, selected.row, selected.col, action);
      const fresh = await session.client.get_key(selected.layer, selected.row, selected.col);
      setActions((current) => {
        const next = [...current];
        next[selected.index] = fresh;
        return next;
      });
      setMessage(`Saved L${selected.layer} (${selected.row},${selected.col}) → ${displayActionLabel(fresh)}.`);
      onDebug('Rynk key updated', { ...selected, action: fresh });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Rynk key update failed', text);
    } finally {
      setBusy(false);
    }
  }

  if (!connected || !caps) {
    return (
      <div className="panel rmk-keymap-connect">
        <div>
          <div className="eyebrow">RMK / Rynk</div>
          <h3>Keymap Editor</h3>
          <p>{message}</p>
          <p className="rmk-trackball-note">Uses RMK's official <code>rynk-wasm</code> client and standard Get/Set Keymap endpoints.</p>
          {error && <div className="notice">{error}</div>}
          <button className="button" type="button" disabled={busy} onClick={() => void connect()}>
            {busy ? 'Connecting…' : 'Connect RMK BLE'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rmk-keymap-root">
      <div className="status-strip panel rmk-keymap-status">
        <span>Rynk keymap live</span>
        <code>{label}</code>
        <span>{message}</span>
        <button className="button secondary" type="button" disabled={busy} onClick={() => void refresh()}>Refresh</button>
        <button className="button secondary" type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="rmk-keymap-layer-tabs">
        {Array.from({ length: layers }, (_, index) => (
          <button
            key={index}
            className={`button ${layer === index ? '' : 'secondary'}`}
            type="button"
            disabled={busy}
            onClick={() => { setLayer(index); setSelected(null); }}
          >
            {layerLabel(index)}
          </button>
        ))}
      </div>

      <div className="rmk-keymap-workspace">
        <section className="panel rmk-keymap-board">
          <div className="panel-heading">
            <div><h3>{layerLabel(layer)}</h3><p>{usePg1kbPhysicalLayout ? 'PG1KB physical layout · click a key to edit' : `${rows} rows × ${cols} columns · click a key to edit`}</p></div>
            <span className="pill">Live</span>
          </div>
          {usePg1kbPhysicalLayout ? (
            <div className="rmk-pg1kb-physical" aria-label="PG1KB physical key layout">
              {PG1KB_PHYSICAL_KEYS.map(({ matrix: [row, col], x, y }) => {
                const index = actionIndex(layer, row, col, rows, cols);
                const action = actions[index];
                const isSelected = selected?.index === index;
                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    className={`rmk-key rmk-pg1kb-physical-key ${isSelected ? 'selected' : ''}`}
                    style={{
                      left: `${(x / 1250) * 100}%`,
                      top: `${(y / 525) * 100}%`,
                      width: `${(100 / 1250) * 100}%`,
                      height: `${(100 / 525) * 100}%`,
                    }}
                    disabled={busy}
                    onClick={() => setSelected({ layer, row, col, index })}
                  >
                    <strong>{displayActionLabel(action)}</strong>
                    <small>{row},{col}</small>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rmk-key-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(48px, 1fr))` }}>
              {Array.from({ length: rows * cols }, (_, localIndex) => {
                const row = Math.floor(localIndex / cols);
                const col = localIndex % cols;
                const index = actionIndex(layer, row, col, rows, cols);
                const action = actions[index];
                const isSelected = selected?.index === index;
                return (
                  <button
                    key={index}
                    type="button"
                    className={`rmk-key ${isSelected ? 'selected' : ''}`}
                    disabled={busy}
                    onClick={() => setSelected({ layer, row, col, index })}
                  >
                    <strong>{displayActionLabel(action)}</strong>
                    <small>{row},{col}</small>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel rmk-keymap-editor">
          {selected ? (
            <>
              <div className="panel-heading"><div><h3>Edit key</h3><p>L{selected.layer} · row {selected.row} · col {selected.col}</p></div></div>
              <div className="rmk-selected-action">Current: <strong>{displayActionLabel(actions[selected.index])}</strong></div>
              <div className="rmk-keymap-quick-actions">
                <button className="button secondary" disabled={busy} onClick={() => void setSelectedAction(makeNoAction())}>No</button>
                <button className="button secondary" disabled={busy} onClick={() => void setSelectedAction(makeTransparentAction())}>Transparent</button>
              </div>
              <label className="rmk-setting-row vertical">
                <span><strong>Keyboard key</strong><small>Standard HID keycodes from RMK itself</small></span>
                <select disabled={busy} defaultValue="" onChange={(event) => event.target.value && void setSelectedAction(makeHidKeyAction(event.target.value))}>
                  <option value="">Choose key…</option>
                  {hidKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                </select>
              </label>
              <div className="rmk-jpkeys-section">
                <div className="rmk-jpkeys-heading">
                  <span>
                    <strong>Japanese</strong>
                    <small>RMK JP Keys ABI v{RMK_JPKEYS_ABI} · reusable across supported RMK keyboards</small>
                  </span>
                </div>
                <div className="rmk-jpkeys-grid">
                  {RMK_JPKEYS.map((choice) => (
                    <button
                      className="button secondary rmk-jpkey-button"
                      type="button"
                      key={choice.id}
                      disabled={busy}
                      title={choice.description}
                      onClick={() => void setSelectedAction(choice.action())}
                    >
                      <strong>{choice.label}</strong>
                      <small>{choice.id.replace('JP_', '')}</small>
                    </button>
                  ))}
                </div>
                <p className="rmk-trackball-note">
                  Shift-dependent JP keys use the shared <code>rmk-jpkeys-for-us-layout</code> ABI.
                  The keyboard firmware must include that module.
                </p>
              </div>
              {layers > 1 && (
                <div className="rmk-layer-actions">
                  <strong>Layer actions</strong>
                  {Array.from({ length: layers }, (_, index) => index).filter((index) => index !== selected.layer).map((target) => (
                    <div className="rmk-keymap-quick-actions" key={target}>
                      <button className="button secondary" disabled={busy} onClick={() => void setSelectedAction(makeLayerOnAction(target))}>MO({target})</button>
                      <button className="button secondary" disabled={busy} onClick={() => void setSelectedAction(makeLayerToggleAction(target))}>TG({target})</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="rmk-trackball-note">Each change is sent with Rynk <code>SetKeyAction</code>; RMK's keymap storage path persists the update.</p>
            </>
          ) : (
            <div className="empty">Choose a key from the keyboard layout.</div>
          )}
        </section>
      </div>
    </div>
  );
}
