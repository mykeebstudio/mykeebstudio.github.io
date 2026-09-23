import { useEffect, useMemo, useRef, useState } from 'react';
import KeyPicker from './KeyPicker';
import type { BehaviorBinding } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import type { BehaviorOption } from './useStudioCore';
import {
  RMK_KEY_PRESS_BEHAVIOR,
  RMK_LAYER_BEHAVIOR,
  RMK_TRANSPARENT_BEHAVIOR,
  RMK_UNKNOWN_BEHAVIOR,
  bindingToKeyAction,
  keyActionToBinding,
  rmkPhysicalKeys,
  type RmkBinding,
  type RmkPhysicalKey,
  type RmkConnection,
} from './rmkRynk';

type Layer = { id: number; name: string; bindings: BehaviorBinding[] };
type Model = { layers: Layer[]; physicalKeys: RmkPhysicalKey[]; originalActions: any[] };

const rmkBehaviors: BehaviorOption[] = [
  {
    id: RMK_KEY_PRESS_BEHAVIOR,
    displayName: 'Key Press',
    metadata: [{ param1: [{ name: 'HID usage', hidUsage: true }], param2: [] }] as any,
  },
  {
    id: RMK_LAYER_BEHAVIOR,
    displayName: 'Layer On',
    metadata: [{ param1: [{ name: 'Layer', range: { min: 0, max: 255 } }], param2: [] }] as any,
  },
  {
    id: RMK_TRANSPARENT_BEHAVIOR,
    displayName: 'Transparent',
    metadata: [{ param1: [], param2: [] }] as any,
  },
  {
    id: RMK_UNKNOWN_BEHAVIOR,
    displayName: 'RMK action (read-only)',
    metadata: [{ param1: [{ name: 'Raw value', range: { min: 0, max: 0xffffffff } }], param2: [] }] as any,
  },
];

function makePhysicalKeys(layout: any) {
  return rmkPhysicalKeys(layout);
}

function makeModel(actions: any[], caps: any, layout: any): Model {
  const rows = Number(caps?.num_rows ?? 0);
  const cols = Number(caps?.num_cols ?? 0);
  const layers = Number(caps?.num_layers ?? 0);
  const physicalKeys = makePhysicalKeys(layout);
  const bindings: BehaviorBinding[][] = [];
  for (let layer = 0; layer < layers; layer += 1) {
    const rowBindings: BehaviorBinding[] = [];
    for (const key of physicalKeys) {
      const index = layer * rows * cols + key.row * cols + key.col;
      rowBindings.push(keyActionToBinding(actions[index]));
    }
    bindings.push(rowBindings);
  }
  return {
    layers: bindings.map((layerBindings, index) => ({
      id: index,
      name: `Layer ${index}`,
      bindings: layerBindings,
    })),
    physicalKeys,
    originalActions: actions,
  };
}

export default function RmkLayerViewer({ connection, onDebug }: { connection: RmkConnection; onDebug: (event: string, detail?: unknown) => void }) {
  const [model, setModel] = useState<Model | null>(null);
  const [activeLayer, setActiveLayer] = useState(0);
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const [selectedBinding, setSelectedBinding] = useState<BehaviorBinding | null>(null);
  const [staged, setStaged] = useState<Map<string, RmkBinding>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockStatus, setLockStatus] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const lock = await connection.client.get_lock_status();
      setLockStatus(lock);
      onDebug('RMK lock status', lock);
      // Keymap reads/writes are open by default in Rynk. The lock only
      // gates dangerous operations (matrix state, bootloader, storage reset,
      // etc.) unless firmware opts into write_requires_unlock.
      if (lock?.locked) {
        onDebug('RMK keymap access', 'locked session; keymap reads remain open');
      } else {
        onDebug('RMK keymap access', 'unlocked session');
      }

      onDebug('RMK load step', 'get_capabilities:start');
      const caps = await connection.client.get_capabilities();
      onDebug('RMK load step', 'get_capabilities:done');

      onDebug('RMK load step', 'get_layout:start');
      const layout = await connection.client.get_layout();
      onDebug('RMK load step', 'get_layout:done');

      onDebug('RMK load step', 'read_all_keymap:start');
      const actions = await connection.client.read_all_keymap();
      onDebug('RMK load step', 'read_all_keymap:done');

      const next = makeModel(actions, caps, layout);
      setModel(next);
      setStaged(new Map());
      setSaved(false);
      setActiveLayer(0);
      setSelectedPosition(null);
      setSelectedBinding(null);
      onDebug('RMK keymap loaded', {
        layers: caps?.num_layers,
        rows: caps?.num_rows,
        cols: caps?.num_cols,
        physicalKeys: next.physicalKeys.length,
        actions: actions.length,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      onDebug('RMK keymap load failed', message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void load();
    return () => {
      cancelled = true;
    };
  }, [connection]);

  const behaviorOptions = useMemo(() => rmkBehaviors, []);
  const layer = model?.layers[activeLayer];
  const stagedPositions = useMemo(() => {
    const result = new Set<number>();
    for (const key of staged.keys()) {
      const [layerIndex, position] = key.split(':').map(Number);
      if (layerIndex === activeLayer) result.add(position);
    }
    return result;
  }, [staged, activeLayer]);

  function selectPosition(position: number) {
    if (!layer || busy) return;
    const binding = layer.bindings[position];
    if (!binding) return;
    setSelectedPosition(position);
    setSelectedBinding({ ...binding });
  }

  function stageBinding(binding: BehaviorBinding) {
    if (!model || selectedPosition === null) return;
    const key = `${activeLayer}:${selectedPosition}`;
    setStaged((current) => new Map(current).set(key, { ...binding }));
    setModel((current) => {
      if (!current) return current;
      const layers = current.layers.map((item, index) => {
        if (index !== activeLayer) return item;
        const bindings = [...item.bindings];
        bindings[selectedPosition] = { ...binding };
        return { ...item, bindings };
      });
      return { ...current, layers };
    });
    setSaved(false);
    setSelectedPosition(null);
    setSelectedBinding(null);
  }

  async function save() {
    if (!model || !staged.size) return;
    setBusy(true);
    setError(null);
    try {
      const actions = [...model.originalActions];
      const caps = await connection.client.get_capabilities();
      const rows = Number(caps?.num_rows ?? 0);
      const cols = Number(caps?.num_cols ?? 0);
      for (const [token, binding] of staged) {
        const [layerIndex, position] = token.split(':').map(Number);
        const key = model.physicalKeys[position];
        if (!key) throw new Error(`Invalid physical key position ${position}.`);
        const matrixIndex = layerIndex * rows * cols + key.row * cols + key.col;
        actions[matrixIndex] = bindingToKeyAction(binding);
      }
      onDebug('RMK write_all_keymap', { actions: actions.length, changed: staged.size });
      await connection.client.write_all_keymap(actions);
      const reread = await connection.client.read_all_keymap();
      const fresh = makeModel(reread, caps, await connection.client.get_layout());
      setModel(fresh);
      setStaged(new Map());
      setSaved(true);
      onDebug('RMK keymap saved and re-read', { actions: reread.length });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      onDebug('RMK keymap save failed', message);
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!staged.size) return;
    await load();
  }

  if (loading) return <div className="panel empty"><div><h3>Reading RMK keymap…</h3><p>Rynk is reading the complete keymap from firmware.</p></div></div>;
  if (error && !model) return <div className="panel empty"><div><h3>RMK Keymap unavailable</h3><p>{error}</p><button className="button" onClick={() => void load()}>Retry</button></div></div>;
  if (!model || !layer || !model.physicalKeys.length) return <div className="panel empty"><div><h3>No RMK layout</h3><p>The firmware did not expose a physical Rynk layout.</p></div></div>;

  const g = (() => {
    const maxX = Math.max(...model.physicalKeys.map((key) => key.x + key.width));
    const maxY = Math.max(...model.physicalKeys.map((key) => key.y + key.height));
    return { width: maxX * 0.72 + 68, height: maxY * 0.72 + 100 };
  })();

  return (
    <div className="layer-viewer">
      <section className="panel layer-toolbar">
        <div>
          <h3>RMK Keymap</h3>
          <p>{model.layers.length} layer(s) · {model.physicalKeys.length} physical key(s) · USB Rynk</p>
        </div>
        <div className="layer-export-actions">
          {staged.size > 0 && <span className="layer-unsaved-badge">{staged.size} unsaved change(s)</span>}
          <button className="button secondary" onClick={() => void load()} disabled={busy || loading}>Refresh</button>
          <button className="button secondary" onClick={() => void discard()} disabled={busy || !staged.size}>Discard</button>
          <button className="button" onClick={() => void save()} disabled={busy || !staged.size}>{busy ? 'Saving…' : 'Save to firmware'}</button>
        </div>
      </section>
      {error && <div className="notice">{error}</div>}
      {saved && <div className="notice">Saved to firmware and re-read successfully.</div>}

      <div className="layer-tabs" role="tablist">
        {model.layers.map((item, index) => (
          <button key={item.id} className={`layer-tab ${activeLayer === index ? 'active' : ''}`} onClick={() => setActiveLayer(index)}>
            <strong>{index}</strong><span>{item.name}</span>
          </button>
        ))}
      </div>

      <section className="panel layer-canvas-panel">
        <div className="layer-canvas-scroll">
          <svg className="layer-svg" viewBox={`0 0 ${g.width} ${g.height}`} width={g.width} height={g.height}>
            <rect width="100%" height="100%" fill="#0b1220" />
            <text x="34" y="30" fill="#f8fafc" fontSize="20" fontWeight="700">RMK Layer {activeLayer}</text>
            {model.physicalKeys.map((key, position) => {
              const x = 34 + key.x * 0.72;
              const y = 66 + key.y * 0.72;
              const width = Math.max(32, key.width * 0.72 - 4);
              const height = Math.max(32, key.height * 0.72 - 4);
              const binding = layer.bindings[position];
              const changed = stagedPositions.has(position);
              const selected = selectedPosition === position;
              const label = binding ? (
                binding.behaviorId === RMK_KEY_PRESS_BEHAVIOR ? `HID ${binding.param1.toString(16).toUpperCase()}`
                  : binding.behaviorId === RMK_LAYER_BEHAVIOR ? `Layer ${binding.param1}`
                  : binding.behaviorId === RMK_TRANSPARENT_BEHAVIOR ? '▽'
                  : binding.behaviorId === 0 ? '—'
                  : 'RMK action'
              ) : '—';
              return (
                <g key={position} onClick={() => selectPosition(position)} className={selected ? 'selected' : ''}>
                  {changed && <rect x={x - 2} y={y - 2} width={width + 4} height={height + 4} rx="8" fill="none" stroke="#f59e0b" strokeWidth="2" />}
                  <rect x={x} y={y} width={width} height={height} rx="7" fill={selected ? '#172554' : changed ? '#2a1b08' : '#1e293b'} stroke={selected ? '#60a5fa' : changed ? '#f59e0b' : '#475569'} />
                  <text x={x + width / 2} y={y + height / 2 + 4} textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="700">{label}</text>
                  <text x={x + 5} y={y + 11} fill="#64748b" fontSize="8">{position}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      {selectedPosition !== null && selectedBinding && (
        <KeyPicker
          key={`${activeLayer}:${selectedPosition}`}
          position={selectedPosition}
          currentBinding={selectedBinding}
          behaviorOptions={behaviorOptions}
          busy={busy}
          onChooseBinding={stageBinding}
          onCancel={() => { setSelectedPosition(null); setSelectedBinding(null); }}
        />
      )}
    </div>
  );
}
