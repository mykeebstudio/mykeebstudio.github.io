import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  makeHidKeyAction,
  makeLayerOnAction,
  makeLayerTapAction,
  makeLayerToggleAction,
  makeNoAction,
  makeTransparentAction,
  openRynkSession,
  rynkActionLabel,
  type RynkSession,
} from './rmkRynkWasm';
import { RMK_JPKEYS, RMK_JPKEYS_ABI, rmkJpDisplayInfo, rmkJpDisplayLabel } from './rmkJpKeys';
import { convertZmkBackup, parseZmkBackup, type ConvertedZmkKeymap } from './zmkToRmkKeymap';
import { friendlyKeyDisplay, friendlyModifierName } from './keyDisplay';
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

function actionDisplay(action: any) {
  const jp = rmkJpDisplayInfo(action);
  if (jp) return jp;

  const label = rynkActionLabel(action);
  if (/^Transparent$/i.test(label)) return { primary: '▽', secondary: 'Transparent' };
  if (/^No$/i.test(label)) return { primary: '—', secondary: '' };

  const layerTap = /^LT\((\d+),\s*(.+)\)$/.exec(label);
  if (layerTap) {
    const tap = friendlyKeyDisplay(layerTap[2]);
    return { primary: tap.primary, secondary: `Hold → ${layerLabel(Number(layerTap[1]))}` };
  }

  const momentary = /^MO\((\d+)\)$/.exec(label);
  if (momentary) return { primary: `MO ${layerLabel(Number(momentary[1]))}`, secondary: 'Hold layer' };

  const toggle = /^TG\((\d+)\)$/.exec(label);
  if (toggle) return { primary: `TG ${layerLabel(Number(toggle[1]))}`, secondary: 'Toggle layer' };

  const modified = /^WM\((.+),\s*(.+)\)$/.exec(label);
  if (modified) {
    const key = friendlyKeyDisplay(modified[1]);
    const mods = modified[2].split('|').map((item) => friendlyModifierName(item.trim())).join('+');
    return { primary: key.primary, secondary: mods };
  }

  return friendlyKeyDisplay(label);
}

function layerLabel(index: number) {
  if (index === 0) return 'Base';
  if (index === 1) return 'Num';
  if (index === 2) return 'Sym';
  if (index === 3) return 'Sys';
  return `Layer ${index}`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
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
  const [zmkImport, setZmkImport] = useState<ConvertedZmkKeymap | null>(null);
  const zmkImportRef = useRef<HTMLInputElement | null>(null);
  const [layerActionType, setLayerActionType] = useState<'mo' | 'tg' | 'lt'>('lt');
  const [layerActionTarget, setLayerActionTarget] = useState(1);
  const [layerTapKey, setLayerTapKey] = useState('Space');

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


  async function chooseZmkJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    try {
      const backup = parseZmkBackup(JSON.parse(await file.text()));
      const converted = convertZmkBackup(backup);

      if (backup.version < 2 || !backup.behaviors?.length) {
        throw new Error('This is an older ZMK backup without behavior metadata. Re-export JSON from the current MyKeebStudio first.');
      }
      if (converted.layerNames.length > layers) {
        throw new Error(`ZMK backup has ${converted.layerNames.length} layers, but this RMK keyboard has only ${layers}.`);
      }

      const sourceKeyCounts = backup.keymap.layers.map((item) => item.bindings.length);
      const expectedPhysical = usePg1kbPhysicalLayout ? PG1KB_PHYSICAL_KEYS.length : rows * cols;
      const mismatched = sourceKeyCounts.findIndex((count) => count !== expectedPhysical);
      if (mismatched >= 0) {
        throw new Error(
          `Layer ${mismatched} has ${sourceKeyCounts[mismatched]} ZMK key positions; this RMK layout expects ${expectedPhysical}.`,
        );
      }

      setZmkImport(converted);
      setMessage(
        `ZMK JSON loaded: ${converted.keys.length} convertible key(s), ${converted.unsupported.length} unsupported binding(s).`,
      );
      onDebug('ZMK JSON converted for RMK', {
        layers: converted.layerNames.length,
        convertible: converted.keys.length,
        unsupported: converted.unsupported,
      });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setZmkImport(null);
      setError(text);
      setMessage(`ZMK JSON import failed: ${text}`);
      onDebug('ZMK JSON import failed', text);
    }
  }

  function importedMatrixPosition(position: number) {
    if (usePg1kbPhysicalLayout) {
      const key = PG1KB_PHYSICAL_KEYS[position];
      return key ? { row: key.matrix[0], col: key.matrix[1] } : null;
    }
    if (position < 0 || position >= rows * cols) return null;
    return { row: Math.floor(position / cols), col: position % cols };
  }

  async function applyZmkImport() {
    const session = sessionRef.current;
    if (!session || !zmkImport) return;

    setBusy(true);
    setError(null);
    let written = 0;
    try {
      setMessage(`Applying ${zmkImport.keys.length} converted ZMK binding(s)…`);

      for (const item of zmkImport.keys) {
        const matrix = importedMatrixPosition(item.position);
        if (!matrix) continue;
        await withTimeout(
          session.client.set_key(item.layer, matrix.row, matrix.col, item.action),
          4000,
          `Set L${item.layer} P${item.position}`,
        );
        written += 1;
      }

      const keymap = await withTimeout(
        session.client.read_all_keymap(),
        8000,
        'Read imported RMK keymap',
      );
      setActions(Array.from(keymap));
      setLayer(0);
      setSelected(null);
      setZmkImport(null);
      setMessage(
        `ZMK → RMK import complete: ${written} key(s) written${zmkImport.unsupported.length ? `; ${zmkImport.unsupported.length} unsupported binding(s) skipped` : ''}.`,
      );
      onDebug('ZMK JSON applied to RMK', {
        written,
        unsupported: zmkImport.unsupported,
      });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage(`ZMK → RMK import stopped after ${written} key(s): ${text}`);
      onDebug('ZMK JSON apply failed', { written, error: text });
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
      onDebug('Rynk key update request', { ...selected, action });
      setMessage(`Saving L${selected.layer} (${selected.row},${selected.col})…`);
      await withTimeout(
        session.client.set_key(selected.layer, selected.row, selected.col, action),
        4000,
        'Rynk SetKeyAction',
      );
      const fresh = await withTimeout(
        session.client.get_key(selected.layer, selected.row, selected.col),
        4000,
        'Rynk GetKeyAction',
      );
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
      setMessage(`Key update failed: ${text}`);
      onDebug('Rynk key update failed', { error: text, action });
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
        <button className="button secondary" type="button" disabled={busy} onClick={() => zmkImportRef.current?.click()}>Import ZMK JSON</button>
        <input ref={zmkImportRef} type="file" accept="application/json,.json" hidden onChange={chooseZmkJson} />
        <button className="button secondary" type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
      </div>

      {error && <div className="notice">{error}</div>}

      {zmkImport && (
        <section className="panel rmk-zmk-import-preview">
          <div>
            <div className="eyebrow">ZMK → RMK</div>
            <h3>Import preview</h3>
            <p>
              {zmkImport.layerNames.length} layer(s) · {zmkImport.keys.length} convertible key(s)
              {zmkImport.unsupported.length ? ` · ${zmkImport.unsupported.length} unsupported` : ' · all supported'}
            </p>
            {zmkImport.unsupported.length > 0 && (
              <details>
                <summary>Unsupported bindings</summary>
                <div className="rmk-zmk-import-unsupported">
                  {zmkImport.unsupported.slice(0, 24).map((item) => (
                    <code key={`${item.layer}:${item.position}`}>
                      L{item.layer} P{item.position}: {item.behaviorName} — {item.reason}
                    </code>
                  ))}
                  {zmkImport.unsupported.length > 24 && <span>…and {zmkImport.unsupported.length - 24} more</span>}
                </div>
              </details>
            )}
          </div>
          <div className="rmk-keymap-quick-actions">
            <button className="button secondary" type="button" disabled={busy} onClick={() => setZmkImport(null)}>Cancel</button>
            <button className="button" type="button" disabled={busy || zmkImport.keys.length === 0} onClick={() => void applyZmkImport()}>
              {zmkImport.unsupported.length ? 'Apply supported keys' : 'Apply ZMK keymap'}
            </button>
          </div>
        </section>
      )}

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
                    {(() => {
                      const info = actionDisplay(action);
                      return (
                        <>
                          <strong>{info.primary}</strong>
                          <small>{info.secondary}</small>
                        </>
                      );
                    })()}
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
                    {(() => {
                      const info = actionDisplay(action);
                      return (
                        <>
                          <strong>{info.primary}</strong>
                          <small>{info.secondary}</small>
                        </>
                      );
                    })()}
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
                  <div className="rmk-layer-actions-heading">
                    <span>
                      <strong>Layer key</strong>
                      <small>Choose what this key should do with another layer.</small>
                    </span>
                  </div>

                  <div className="rmk-layer-action-type" role="group" aria-label="Layer action type">
                    <button
                      type="button"
                      className={`button ${layerActionType === 'lt' ? '' : 'secondary'}`}
                      disabled={busy}
                      onClick={() => setLayerActionType('lt')}
                    >
                      Tap / Hold
                    </button>
                    <button
                      type="button"
                      className={`button ${layerActionType === 'mo' ? '' : 'secondary'}`}
                      disabled={busy}
                      onClick={() => setLayerActionType('mo')}
                    >
                      Hold only
                    </button>
                    <button
                      type="button"
                      className={`button ${layerActionType === 'tg' ? '' : 'secondary'}`}
                      disabled={busy}
                      onClick={() => setLayerActionType('tg')}
                    >
                      Toggle
                    </button>
                  </div>

                  <label className="rmk-setting-row vertical">
                    <span>
                      <strong>Target layer</strong>
                      <small>Layer used while held or toggled.</small>
                    </span>
                    <select
                      disabled={busy}
                      value={layerActionTarget}
                      onChange={(event) => setLayerActionTarget(Number(event.target.value))}
                    >
                      {Array.from({ length: layers }, (_, index) => index)
                        .filter((index) => index !== selected.layer)
                        .map((target) => (
                          <option key={target} value={target}>{layerLabel(target)}</option>
                        ))}
                    </select>
                  </label>

                  {layerActionType === 'lt' && (
                    <label className="rmk-setting-row vertical">
                      <span>
                        <strong>Tap key</strong>
                        <small>Short press sends this key; hold activates {layerLabel(layerActionTarget)}.</small>
                      </span>
                      <select
                        disabled={busy}
                        value={layerTapKey}
                        onChange={(event) => setLayerTapKey(event.target.value)}
                      >
                        {hidKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                      </select>
                    </label>
                  )}

                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (layerActionType === 'lt') {
                        void setSelectedAction(makeLayerTapAction(layerActionTarget, layerTapKey));
                      } else if (layerActionType === 'mo') {
                        void setSelectedAction(makeLayerOnAction(layerActionTarget));
                      } else {
                        void setSelectedAction(makeLayerToggleAction(layerActionTarget));
                      }
                    }}
                  >
                    {layerActionType === 'lt'
                      ? `Set ${layerTapKey} / hold ${layerLabel(layerActionTarget)}`
                      : layerActionType === 'mo'
                        ? `Hold for ${layerLabel(layerActionTarget)}`
                        : `Toggle ${layerLabel(layerActionTarget)}`}
                  </button>

                  <div className="rmk-layer-action-presets">
                    <span>Quick presets</span>
                    <button className="button secondary" disabled={busy || layers < 2} onClick={() => void setSelectedAction(makeLayerTapAction(1, 'Space'))}>Space / Num</button>
                    <button className="button secondary" disabled={busy || layers < 3} onClick={() => void setSelectedAction(makeLayerTapAction(2, 'Space'))}>Space / Sym</button>
                    <button className="button secondary" disabled={busy || layers < 2} onClick={() => void setSelectedAction(makeLayerOnAction(1))}>Hold Num</button>
                    <button className="button secondary" disabled={busy || layers < 3} onClick={() => void setSelectedAction(makeLayerOnAction(2))}>Hold Sym</button>
                  </div>
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
