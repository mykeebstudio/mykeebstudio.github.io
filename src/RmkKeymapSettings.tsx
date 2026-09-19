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
import './rmkKeymap.css';

type Caps = {
  num_layers?: number;
  num_rows?: number;
  num_cols?: number;
};

type SelectedKey = { layer: number; row: number; col: number; index: number } | null;
type MatrixPos = readonly [row: number, col: number];

// PG1KB physical order, left-to-right / top-to-bottom.
// The left matrix columns are mirrored in hardware, so logical col = 5 - local col.
const PG1KB_PHYSICAL_ROWS: readonly (readonly MatrixPos[])[] = [
  [[1, 0], [1, 1], [0, 4], [0, 5], [0, 6], [0, 7], [1, 10], [1, 11]],
  [[2, 0], [2, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [2, 10], [2, 11]],
  [[3, 0], [3, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8], [2, 9], [3, 10], [3, 11]],
  [[4, 0], [4, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7], [3, 8], [3, 9], [4, 10], [4, 11]],
  [[4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7], [4, 8], [4, 9]],
];

function actionIndex(layer: number, row: number, col: number, rows: number, cols: number) {
  return layer * rows * cols + row * cols + col;
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
      setMessage(`Saved L${selected.layer} (${selected.row},${selected.col}) → ${rynkActionLabel(fresh)}.`);
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
            {index === 0 ? 'Base' : index === 1 ? 'Num' : index === 2 ? 'Sym' : `Layer ${index}`}
          </button>
        ))}
      </div>

      <div className="rmk-keymap-workspace">
        <section className="panel rmk-keymap-board">
          <div className="panel-heading">
            <div><h3>{layer === 0 ? 'Base' : layer === 1 ? 'Num' : layer === 2 ? 'Sym' : `Layer ${layer}`}</h3><p>{usePg1kbPhysicalLayout ? 'PG1KB physical layout · click a key to edit' : `${rows} rows × ${cols} columns · click a key to edit`}</p></div>
            <span className="pill">Live</span>
          </div>
          {usePg1kbPhysicalLayout ? (
            <div className="rmk-pg1kb-layout" aria-label="PG1KB physical key layout">
              {PG1KB_PHYSICAL_ROWS.map((physicalRow, physicalRowIndex) => (
                <div
                  className={`rmk-pg1kb-row rmk-pg1kb-row-${physicalRowIndex}`}
                  key={physicalRowIndex}
                >
                  {physicalRow.map(([row, col], physicalColIndex) => {
                    const index = actionIndex(layer, row, col, rows, cols);
                    const action = actions[index];
                    const isSelected = selected?.index === index;
                    const halfClass = physicalColIndex < physicalRow.length / 2 ? 'left-half' : 'right-half';
                    return (
                      <button
                        key={`${row}-${col}`}
                        type="button"
                        className={`rmk-key ${halfClass} ${isSelected ? 'selected' : ''}`}
                        disabled={busy}
                        onClick={() => setSelected({ layer, row, col, index })}
                      >
                        <strong>{rynkActionLabel(action)}</strong>
                        <small>{row},{col}</small>
                      </button>
                    );
                  })}
                </div>
              ))}
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
                    <strong>{rynkActionLabel(action)}</strong>
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
              <div className="rmk-selected-action">Current: <strong>{rynkActionLabel(actions[selected.index])}</strong></div>
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
