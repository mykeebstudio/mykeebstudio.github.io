import { useEffect, useMemo, useRef, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import type { BehaviorParameterValueDescription } from '@zmkfirmware/zmk-studio-ts-client/behaviors';
import type { BehaviorBinding, KeyPhysicalAttrs, Keymap } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import { useBehaviorOptions, type BehaviorOption } from './useStudioCore';
import { friendlyDecodedHidDisplay } from './keyDisplay';
import { rynkActionLabel } from './rmkRynkWasm';

type BackupFile = {
  format: 'my-zmk-studio-keymap';
  version: 1 | 2;
  exportedAt: string;
  keymap: Keymap;
  behaviors?: BehaviorOption[];
  physicalKeys?: KeyPhysicalAttrs[];
};

type HoverDiff = {
  position: number;
  current: BehaviorBinding;
  imported: BehaviorBinding;
  x: number;
  y: number;
};

type FriendlyBinding = {
  primary: string;
  secondary: string;
  raw: string;
};

const KEY_UNIT_PX = 46;

const KEYBOARD_USAGE: Record<number, string> = {
  40: 'Enter', 41: 'Esc', 42: 'Backspace', 43: 'Tab', 44: 'Space',
  45: '-', 46: '=', 47: '[', 48: ']', 49: '\\', 50: '#', 51: ';', 52: "'",
  53: '`', 54: ',', 55: '.', 56: '/', 57: 'Caps Lock',
  70: 'Print Screen', 71: 'Scroll Lock', 72: 'Pause', 73: 'Insert', 74: 'Home',
  75: 'Page Up', 76: 'Delete', 77: 'End', 78: 'Page Down', 79: 'Right', 80: 'Left',
  81: 'Down', 82: 'Up', 83: 'Num Lock', 84: 'KP /', 85: 'KP *', 86: 'KP -',
  87: 'KP +', 88: 'KP Enter', 89: 'KP 1', 90: 'KP 2', 91: 'KP 3', 92: 'KP 4',
  93: 'KP 5', 94: 'KP 6', 95: 'KP 7', 96: 'KP 8', 97: 'KP 9', 98: 'KP 0', 99: 'KP .',
  0xe0: 'LCtrl', 0xe1: 'LShift', 0xe2: 'LAlt', 0xe3: 'LGUI',
  0xe4: 'RCtrl', 0xe5: 'RShift', 0xe6: 'RAlt', 0xe7: 'RGUI',
};

const CONSUMER_USAGE: Record<number, string> = {
  0xB5: 'Next', 0xB6: 'Previous', 0xB7: 'Stop', 0xCD: 'Play/Pause',
  0xE2: 'Mute', 0xE9: 'Volume +', 0xEA: 'Volume -',
};

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sameBinding(a: BehaviorBinding, b: BehaviorBinding) {
  return a.behaviorId === b.behaviorId && a.param1 === b.param1 && a.param2 === b.param2;
}

function rawBindingText(binding: BehaviorBinding) {
  return `#${binding.behaviorId} · p1=${binding.param1} · p2=${binding.param2}`;
}

function keyboardUsageName(usage: number) {
  if (usage >= 4 && usage <= 29) return String.fromCharCode(65 + usage - 4);
  if (usage >= 30 && usage <= 38) return String(usage - 29);
  if (usage === 39) return '0';
  if (usage >= 58 && usage <= 69) return `F${usage - 57}`;
  return KEYBOARD_USAGE[usage] ?? `Key 0x${usage.toString(16).toUpperCase()}`;
}

function decodeHidUsage(value: number) {
  const modifiers = (value >>> 24) & 0xff;
  const page = (value >>> 16) & 0xff;
  const usage = value & 0xffff;
  const modifierNames = ['LCtrl', 'LShift', 'LAlt', 'LGUI', 'RCtrl', 'RShift', 'RAlt', 'RGUI'];
  const names = modifierNames.filter((_, bit) => modifiers & (1 << bit));

  let key: string;
  if (page === 0x07) key = keyboardUsageName(usage);
  else if (page === 0x0c) key = CONSUMER_USAGE[usage] ?? `Consumer 0x${usage.toString(16).toUpperCase()}`;
  else key = `HID ${page.toString(16).toUpperCase()}:${usage.toString(16).toUpperCase()}`;

  if (page === 0x07 && usage >= 0xe0 && usage <= 0xe7) {
    const modifier = keyboardUsageName(usage);
    return names.includes(modifier) ? names.join('+') : [...names, modifier].join('+');
  }
  return [...names, key].join('+');
}

function describeMetadataValue(value: number, descriptions: BehaviorParameterValueDescription[]): string | null {
  for (const description of descriptions) {
    if (description.constant !== undefined && description.constant === value) {
      return description.name || String(value);
    }
  }
  for (const description of descriptions) {
    if (description.hidUsage) return decodeHidUsage(value);
  }
  for (const description of descriptions) {
    if (description.layerId) return `Layer ${value}`;
  }
  for (const description of descriptions) {
    if (description.range && value >= description.range.min && value <= description.range.max) {
      return description.name ? `${description.name} ${value}` : String(value);
    }
  }
  for (const description of descriptions) {
    if (description.nil && value === 0) return '';
  }
  return null;
}

function describeParam(option: BehaviorOption | undefined, param: 1 | 2, value: number) {
  if (!option) return value === 0 ? '' : String(value);
  for (const set of option.metadata) {
    const descriptions = param === 1 ? set.param1 : set.param2;
    const result = describeMetadataValue(value, descriptions);
    if (result !== null) return result;
  }
  return value === 0 ? '' : String(value);
}

function friendlyBinding(binding: BehaviorBinding, options: BehaviorOption[] | null): FriendlyBinding {
  const raw = rawBindingText(binding);
  if (binding.behaviorId === 0 && !options?.some((option) => option.id === 0)) {
    return { primary: '—', secondary: 'Empty', raw };
  }

  const option = options?.find((item) => item.id === binding.behaviorId);
  const name = option?.displayName || `Behavior #${binding.behaviorId}`;
  const p1 = describeParam(option, 1, binding.param1);
  const p2 = describeParam(option, 2, binding.param2);
  const args = [p1, p2].filter(Boolean);

  if (/transparent/i.test(name)) return { primary: '▽', secondary: 'Transparent', raw };
  if (/none|disabled/i.test(name)) return { primary: '—', secondary: name, raw };
  if (/key press|keypress/i.test(name) && p1 && !p2) {
    const friendly = friendlyDecodedHidDisplay(p1);
    return { primary: friendly.primary, secondary: friendly.secondary || name, raw };
  }

  return {
    primary: args.length ? args.join(' · ') : name,
    secondary: args.length ? name : '',
    raw,
  };
}

function FriendlyBindingView({ binding, options }: { binding: BehaviorBinding; options: BehaviorOption[] | null }) {
  const label = friendlyBinding(binding, options);
  return (
    <div className="diff-binding-label">
      <strong>{label.primary}</strong>
      {label.secondary && <span>{label.secondary}</span>}
      <small>{label.raw}</small>
    </div>
  );
}

function validateBackup(value: unknown): BackupFile {
  if (!value || typeof value !== 'object') throw new Error('Invalid backup file.');
  const candidate = value as Partial<BackupFile>;
  if (
    candidate.format !== 'my-zmk-studio-keymap'
    || (candidate.version !== 1 && candidate.version !== 2)
    || !candidate.keymap
  ) {
    throw new Error('This is not a My ZMK Studio keymap backup.');
  }
  if (!Array.isArray(candidate.keymap.layers)) throw new Error('Backup contains no layers.');
  return candidate as BackupFile;
}

type LegacyRmkBackup = {
  format: 'mykeebstudio-rmk-keymap'; version: 1; exportedAt?: string;
  capabilities: { num_layers: number; num_rows: number; num_cols: number };
  keymap: unknown[]; combos?: unknown[];
};
const PG1KB_MATRIX_BY_POSITION: readonly (readonly [number, number])[] = [
  [1,5], [1,4], [0,1], [0,0], [0,6], [0,7], [1,10], [1,11],
  [2,5], [2,4], [1,3], [1,2], [1,1], [1,0], [1,6], [1,7], [1,8], [1,9], [2,10], [2,11],
  [3,5], [3,4], [2,3], [2,2], [2,1], [2,0], [2,6], [2,7], [2,8], [2,9], [3,10], [3,11],
  [4,5], [4,4], [3,3], [3,2], [3,1], [3,0], [3,6], [3,7], [3,8], [3,9], [4,10], [4,11],
  [4,3], [4,2], [4,1], [4,0], [4,6], [4,7], [4,8], [4,9],
];
const RMK_USAGE: Record<string, number> = {
  Escape:41, Esc:41, Enter:40, Backspace:42, Tab:43, Space:44, Minus:45, Equal:46,
  LeftBracket:47, RightBracket:48, Backslash:49, NonusHash:50, Semicolon:51, Quote:52,
  Grave:53, Comma:54, Dot:55, Slash:56, CapsLock:57, PrintScreen:70, ScrollLock:71, Pause:72,
  Insert:73, Home:74, PageUp:75, Delete:76, Del:76, End:77, PageDown:78, Right:79, Left:80, Down:81, Up:82,
  ...Object.fromEntries(Array.from({length:26}, (_,i) => [String.fromCharCode(65+i),4+i])),
  ...Object.fromEntries(Array.from({length:10}, (_,i) => ['Kc'+(i===9?0:i+1),30+i])),
  ...Object.fromEntries(Array.from({length:12}, (_,i) => ['F'+(i+1),58+i])),
};
function convertLegacyRmkAction(action: unknown, options: BehaviorOption[]): BehaviorBinding | null {
  let label = '';
  try { label = rynkActionLabel(action as never).trim(); } catch { return null; }
  const option = (needle: string) => options.find((item) => item.displayName.toLowerCase().includes(needle));
  if (label.toLowerCase() === 'transparent') { const b = option('transparent'); return b ? { behaviorId:b.id, param1:0, param2:0 } : null; }
  if (label.toLowerCase() === 'no') { const b = option('no action') || option('none'); return b ? { behaviorId:b.id, param1:0, param2:0 } : null; }
  const layerTap = label.startsWith('LT(') ? label.slice(3,-1).split(',') : null;
  if (layerTap && layerTap.length >= 2) {
    const b = option('layer tap'); const usage = RMK_USAGE[layerTap.slice(1).join(',').trim()];
    const kp = option('key press') || option('keypress');
    if (!b || usage === undefined || !kp) return null;
    return { behaviorId:b.id, param1:Number(layerTap[0]), param2:(0x070000 + usage) >>> 0 };
  }
  const layerAction = (prefix: string, needle: string) => {
    if (!label.startsWith(prefix + '(')) return null;
    const b = option(needle); const target = Number(label.slice(prefix.length+1,-1));
    return b && Number.isInteger(target) ? { behaviorId:b.id, param1:target, param2:0 } : null;
  };
  const mo = layerAction('MO','momentary'); if (mo) return mo;
  const tg = layerAction('TG','toggle'); if (tg) return tg;
  const modified = label.startsWith('WM(') ? label.slice(3,-1).split(',') : null;
  let keyName = label;
  let modifiers = 0;
  if (modified && modified.length >= 2) {
    keyName = modified[0].trim();
    const names: Record<string,number> = {left_ctrl:1,left_shift:2,left_alt:4,left_gui:8,right_ctrl:16,right_shift:32,right_alt:64,right_gui:128};
    modifiers = modified.slice(1).join(',').split('|').reduce((sum,name) => sum | (names[name.trim().toLowerCase()] || 0), 0);
    if (!modifiers) return null;
  }
  const usage = RMK_USAGE[keyName.replace(/^KC_/,'')];
  const kp = option('key press') || option('keypress');
  if (usage === undefined || !kp) return null;
  return { behaviorId:kp.id, param1:(modifiers*0x1000000 + 0x070000 + usage) >>> 0, param2:0 };
}
function convertLegacyRmkBackup(raw: unknown, current: Keymap, options: BehaviorOption[], physicalKeys: KeyPhysicalAttrs[] | null): { backup: BackupFile; unsupported: number; comboCount: number; unmappedLayers: number } {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid RMK JSON.');
  const source = raw as Partial<LegacyRmkBackup>;
  if (source.format !== 'mykeebstudio-rmk-keymap' || source.version !== 1) throw new Error('Unsupported RMK JSON version. Expected version 1.');
  const caps = source.capabilities;
  if (!caps || caps.num_rows !== 5 || caps.num_cols !== 12 || !Array.isArray(source.keymap)) throw new Error('Expected a PG1KB RMK 5×12 keymap JSON.');
  if (source.keymap.length !== caps.num_layers * 60) throw new Error('RMK key action count does not match the declared geometry.');
  if (current.layers.some((layer) => layer.bindings.length !== PG1KB_MATRIX_BY_POSITION.length)) throw new Error('ZMK firmware does not match the PG1KB 52-key layout.');
  let unsupported = 0;
  const mappedLayers = Math.min(caps.num_layers, current.layers.length);
  const layers = current.layers.map((layer, layerIndex) => {
    if (layerIndex >= mappedLayers) return layer;
    return {
      ...layer,
      bindings: layer.bindings.map((existing, position) => {
        const pair = PG1KB_MATRIX_BY_POSITION[position];
        const index = layerIndex * 60 + pair[0] * 12 + pair[1];
        const converted = convertLegacyRmkAction(source.keymap?.[index], options);
        if (!converted) { unsupported += 1; return existing; }
        return converted;
      }),
    };
  });
  return { backup: { format:'my-zmk-studio-keymap', version:2, exportedAt:source.exportedAt || new Date().toISOString(), keymap:{...current,layers}, behaviors:options, physicalKeys:physicalKeys ?? [] }, unsupported, comboCount:Array.isArray(source.combos) ? source.combos.length : 0, unmappedLayers:Math.abs(caps.num_layers-current.layers.length) };
}
function PhysicalDiffMap({
  keys,
  currentBindings,
  importedBindings,
  behaviorOptions,
}: {
  keys: KeyPhysicalAttrs[];
  currentBindings: BehaviorBinding[];
  importedBindings: BehaviorBinding[];
  behaviorOptions: BehaviorOption[] | null;
}) {
  const [hovered, setHovered] = useState<HoverDiff | null>(null);
  const u = (value: number) => value / 100;
  const maxX = Math.max(...keys.map((key) => u(key.x) + u(key.width)));
  const maxY = Math.max(...keys.map((key) => u(key.y) + u(key.height)));
  const width = Math.ceil(maxX * KEY_UNIT_PX);
  const height = Math.ceil(maxY * KEY_UNIT_PX);

  return (
    <div className="backup-keymap-map-scroll">
      <div className="backup-keymap-map" style={{ width, height }} onMouseLeave={() => setHovered(null)}>
        {keys.map((key, position) => {
          const current = currentBindings[position];
          const imported = importedBindings[position];
          if (!current || !imported) return null;
          const changed = !sameBinding(current, imported);
          const left = u(key.x) * KEY_UNIT_PX;
          const top = u(key.y) * KEY_UNIT_PX;
          const keyWidth = Math.max(30, u(key.width) * KEY_UNIT_PX - 3);
          const keyHeight = Math.max(30, u(key.height) * KEY_UNIT_PX - 3);
          const visible = friendlyBinding(changed ? imported : current, behaviorOptions);

          return (
            <button
              key={position}
              type="button"
              className={`backup-keymap-key ${changed ? 'changed' : 'same'}`}
              style={{ left, top, width: keyWidth, height: keyHeight }}
              onMouseEnter={() => setHovered({ position, current, imported, x: left + keyWidth / 2, y: top })}
              title={changed ? `Position ${position}: will change` : `Position ${position}: unchanged`}
            >
              <small>{position}</small>
              <span>{visible.primary}</span>
              {changed && <strong>→</strong>}
            </button>
          );
        })}

        {hovered && (
          <div
            className={`backup-keymap-tooltip ${sameBinding(hovered.current, hovered.imported) ? 'same' : 'changed'}`}
            style={{ left: Math.max(8, Math.min(width - 330, hovered.x - 155)), top: Math.max(8, hovered.y - 120) }}
          >
            <strong>Position {hovered.position}</strong>
            <div className="tooltip-binding-row"><span>Before</span><FriendlyBindingView binding={hovered.current} options={behaviorOptions} /></div>
            <div className="tooltip-binding-row"><span>After</span><FriendlyBindingView binding={hovered.imported} options={behaviorOptions} /></div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function KeymapBackup({
  connection,
  physicalKeys,
  onDebug,
}: {
  connection: RpcConnection;
  physicalKeys?: KeyPhysicalAttrs[] | null;
  onDebug: (event: string, detail?: unknown) => void;
}) {
  const behaviorOptions = useBehaviorOptions(connection);
  const [current, setCurrent] = useState<Keymap | null>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [previewLayer, setPreviewLayer] = useState(0);
  const [changedOnly, setChangedOnly] = useState(true);
  const [resolvedPhysicalKeys, setResolvedPhysicalKeys] = useState<KeyPhysicalAttrs[] | null>(physicalKeys ?? null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function readKeymap() {
    onDebug('RPC -> keymap.getKeymap (backup)');
    const response = await call_rpc(connection, { keymap: { getKeymap: true } });
    const keymap = response.keymap?.getKeymap;
    if (!keymap) throw new Error('Firmware returned no keymap.');
    setCurrent(keymap);
    onDebug('Backup keymap loaded', {
      layers: keymap.layers.length,
      bindings: keymap.layers.map((layer) => layer.bindings.length),
    });
    return keymap;
  }

  async function readPhysicalLayout() {
    if (physicalKeys?.length) {
      setResolvedPhysicalKeys(physicalKeys);
      return physicalKeys;
    }
    onDebug('RPC -> keymap.getPhysicalLayouts (backup)');
    const response = await call_rpc(connection, { keymap: { getPhysicalLayouts: true } });
    const layouts = response.keymap?.getPhysicalLayouts;
    if (!layouts) return null;
    const keys = layouts.layouts[layouts.activeLayoutIndex]?.keys ?? null;
    setResolvedPhysicalKeys(keys);
    onDebug('Backup physical layout loaded', { activeLayoutIndex: layouts.activeLayoutIndex, keyCount: keys?.length ?? 0 });
    return keys;
  }

  useEffect(() => {
    void Promise.all([
      readKeymap(),
      readPhysicalLayout(),
    ]).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [connection, physicalKeys]);

  async function exportBackup() {
    setBusy(true);
    try {
      if (behaviorOptions === null) throw new Error('Behavior metadata is still loading. Try Export JSON again in a moment.');
      const keymap = current ?? await readKeymap();
      const backup: BackupFile = {
        format: 'my-zmk-studio-keymap',
        version: 2,
        exportedAt: new Date().toISOString(),
        keymap,
        behaviors: behaviorOptions ?? [],
        physicalKeys: resolvedPhysicalKeys ?? [],
      };
      downloadJson(backup, `my-zmk-studio-keymap-${new Date().toISOString().slice(0, 10)}.json`);
      setMessage(`Exported ${keymap.layers.length} layer(s).`);
      onDebug('Keymap JSON exported', {
        version: 2,
        layers: keymap.layers.length,
        behaviors: behaviorOptions?.length ?? 0,
        physicalKeys: resolvedPhysicalKeys?.length ?? 0,
      });
    } finally {
      setBusy(false);
    }
  }

  async function chooseImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const raw: unknown = JSON.parse(await file.text());
      const live = current ?? await readKeymap();
      let parsed: BackupFile;
      let warning = '';
      if (raw && typeof raw === 'object' && (raw as { format?: string }).format === 'mykeebstudio-rmk-keymap') {
        if (behaviorOptions === null) throw new Error('ZMK behavior metadata is still loading. Try importing again in a moment.');
        const converted = convertLegacyRmkBackup(raw, live, behaviorOptions, resolvedPhysicalKeys);
        parsed = converted.backup;
        warning = 'RMK → ZMK: ' + converted.unsupported + ' unsupported key action(s) were left unchanged; ' + converted.comboCount + ' RMK combo slot(s) are not imported; ' + converted.unmappedLayers + ' unmatched layer(s) were preserved on the ZMK side.';
      } else {
        parsed = validateBackup(raw);
      }
      if (parsed.keymap.layers.length !== live.layers.length) throw new Error('Layer count mismatch between backup and firmware.');
      parsed.keymap.layers.forEach((layer, index) => {
        const liveLayer = live.layers[index];
        if (!liveLayer || layer.bindings.length !== liveLayer.bindings.length) throw new Error('Layer ' + index + ' key count mismatch.');
      });
      setPending(parsed);
      setPreviewLayer(0);
      setMessage(warning || 'Backup loaded. Orange keys are the keys that will change if you apply this backup.');
      onDebug('Keymap backup selected', { exportedAt: parsed.exportedAt, layers: parsed.keymap.layers.length, convertedFromRmk: !!warning });
    } catch (error) {
      setPending(null);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const diff = useMemo(() => {
    if (!current || !pending) return { bindings: 0, names: 0, byLayer: [] as number[] };
    let bindings = 0;
    let names = 0;
    const byLayer = pending.keymap.layers.map((layer, layerIndex) => {
      const live = current.layers[layerIndex];
      if (layer.name !== live.name) names += 1;
      let layerChanges = 0;
      layer.bindings.forEach((binding, position) => {
        if (!sameBinding(binding, live.bindings[position])) {
          bindings += 1;
          layerChanges += 1;
        }
      });
      return layerChanges;
    });
    return { bindings, names, byLayer };
  }, [current, pending]);

  const previewRows = useMemo(() => {
    if (!current || !pending) return [];
    const liveLayer = current.layers[previewLayer];
    const importLayer = pending.keymap.layers[previewLayer];
    if (!liveLayer || !importLayer) return [];
    return importLayer.bindings.map((binding, position) => ({
      position,
      current: liveLayer.bindings[position],
      imported: binding,
      changed: !sameBinding(binding, liveLayer.bindings[position]),
    })).filter((row) => !changedOnly || row.changed);
  }, [current, pending, previewLayer, changedOnly]);

  async function applyImport() {
    if (!pending) return;
    setBusy(true);
    setMessage('Applying backup…');
    try {
      const live = await readKeymap();
      if (pending.keymap.layers.length !== live.layers.length) throw new Error('Firmware layout changed since preview.');
      let bindingWrites = 0;
      let nameWrites = 0;

      for (let layerIndex = 0; layerIndex < pending.keymap.layers.length; layerIndex += 1) {
        const sourceLayer = pending.keymap.layers[layerIndex];
        const liveLayer = live.layers[layerIndex];
        if (sourceLayer.bindings.length !== liveLayer.bindings.length) throw new Error(`Layer ${layerIndex} key count changed.`);

        if (sourceLayer.name !== liveLayer.name) {
          onDebug('RPC -> keymap.setLayerProps', { layerId: liveLayer.id, name: sourceLayer.name });
          const response = await call_rpc(connection, {
            keymap: { setLayerProps: { layerId: liveLayer.id, name: sourceLayer.name } },
          });
          if (response.keymap?.setLayerProps !== 0) throw new Error(`Failed to set layer ${layerIndex} name.`);
          nameWrites += 1;
        }

        for (let position = 0; position < sourceLayer.bindings.length; position += 1) {
          const desired = sourceLayer.bindings[position];
          if (sameBinding(desired, liveLayer.bindings[position])) continue;
          onDebug('RPC -> keymap.setLayerBinding', { layerIndex, position, behaviorId: desired.behaviorId });
          const response = await call_rpc(connection, {
            keymap: {
              setLayerBinding: {
                layerId: liveLayer.id,
                keyPosition: position,
                binding: desired,
              },
            },
          });
          if (response.keymap?.setLayerBinding !== 0) {
            throw new Error(`Layer ${layerIndex}, position ${position}: setLayerBinding failed (${response.keymap?.setLayerBinding}).`);
          }
          bindingWrites += 1;
        }
      }

      onDebug('RPC -> keymap.saveChanges');
      const save = await call_rpc(connection, { keymap: { saveChanges: true } });
      if (!save.keymap?.saveChanges?.ok) {
        throw new Error(`saveChanges failed (${save.keymap?.saveChanges?.err ?? 'unknown'}).`);
      }

      const refreshed = await readKeymap();
      setPending(null);
      setMessage(`Restore complete: ${bindingWrites} binding(s), ${nameWrites} layer name(s). Re-read ${refreshed.layers.length} layer(s).`);
      onDebug('Keymap restore complete', { bindingWrites, nameWrites });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(text);
      onDebug('Keymap restore failed', text);
    } finally {
      setBusy(false);
    }
  }

  const liveLayer = current?.layers[previewLayer];
  const importLayer = pending?.keymap.layers[previewLayer];

  return (
    <div className="keymap-backup">
      <section className="panel backup-toolbar">
        <div>
          <h3>Keymap Backup</h3>
          <p>Export the live firmware keymap to JSON, or compare and restore a matching backup.</p>
        </div>
        <div className="backup-actions">
          <button className="button secondary" onClick={() => void Promise.all([readKeymap(), readPhysicalLayout()])} disabled={busy}>Refresh</button>
          <button className="button" onClick={exportBackup} disabled={busy || !current || behaviorOptions === null}>Export JSON</button>
          <button className="button secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>Import JSON</button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={chooseImport} />
        </div>
      </section>

      {current && (
        <section className="panel backup-summary">
          <strong>Live firmware</strong>
          <span>{current.layers.length} layers</span>
          <span>{current.layers.reduce((sum, layer) => sum + layer.bindings.length, 0)} bindings</span>
        </section>
      )}

      {pending && current && (
        <>
          <section className="panel import-preview">
            <div>
              <h3>Import preview</h3>
              <p>Exported {pending.exportedAt}</p>
              <p>{pending.keymap.layers.length} layers · {diff.bindings} key change(s) · {diff.names} layer name change(s)</p>
            </div>
            <div className="backup-actions">
              <button className="button secondary" onClick={() => setPending(null)} disabled={busy}>Cancel</button>
              <button className="button danger" onClick={applyImport} disabled={busy || (diff.bindings === 0 && diff.names === 0)}>
                Apply imported keymap
              </button>
            </div>
          </section>

          <section className="panel backup-diff-guide">
            <div className="diff-flow-card before">
              <small>BEFORE</small>
              <strong>Current firmware</strong>
              <span>The keymap that is in the keyboard now</span>
            </div>
            <div className="diff-flow-arrow">→</div>
            <div className="diff-flow-card after">
              <small>AFTER APPLY</small>
              <strong>Imported backup</strong>
              <span>The keymap that will be written</span>
            </div>
            <div className="diff-legend-box">
              <span><i className="diff-swatch changed" /> Orange = will change</span>
              <span><i className="diff-swatch same" /> Gray = unchanged</span>
              <span>Hover a key to see Before → After</span>
            </div>
          </section>

          <div className="backup-layer-tabs">
            {pending.keymap.layers.map((layer, index) => (
              <button
                key={layer.id}
                className={`layer-tab ${previewLayer === index ? 'active' : ''} ${diff.byLayer[index] > 0 ? 'has-diff' : ''}`}
                onClick={() => setPreviewLayer(index)}
              >
                <strong>{index}</strong>
                <span>{layer.name || `Layer ${index}`}</span>
                {diff.byLayer[index] > 0 && <em>{diff.byLayer[index]}</em>}
              </button>
            ))}
          </div>

          <section className="panel backup-diff-panel">
            <div className="backup-diff-header">
              <div>
                <h3>Layer {previewLayer}: what will change</h3>
                <p>
                  <strong>{liveLayer?.name || `Layer ${previewLayer}`}</strong>
                  {' → '}
                  <strong>{importLayer?.name || `Layer ${previewLayer}`}</strong>
                  {' · '}{diff.byLayer[previewLayer] ?? 0} key change(s)
                </p>
              </div>
              <div className="backup-view-toggle" role="group" aria-label="Diff rows">
                <button type="button" className={changedOnly ? 'active' : ''} onClick={() => setChangedOnly(true)}>Changes only</button>
                <button type="button" className={!changedOnly ? 'active' : ''} onClick={() => setChangedOnly(false)}>All keys</button>
              </div>
            </div>

            {liveLayer && importLayer && liveLayer.name !== importLayer.name && (
              <div className="layer-name-diff">
                <span>Layer name will change</span>
                <code>{liveLayer.name || '(empty)'}</code>
                <span>→</span>
                <code>{importLayer.name || '(empty)'}</code>
              </div>
            )}

            {liveLayer && importLayer && resolvedPhysicalKeys?.length ? (
              <div className="backup-physical-diff">
                <div className="backup-physical-diff-heading">
                  <strong>Keyboard layout</strong>
                  <span><i className="diff-swatch changed" /> Will change</span>
                  <span><i className="diff-swatch same" /> Unchanged</span>
                  <span>Hover a key for Before → After</span>
                </div>
                <PhysicalDiffMap
                  keys={resolvedPhysicalKeys}
                  currentBindings={liveLayer.bindings}
                  importedBindings={importLayer.bindings}
                  behaviorOptions={behaviorOptions}
                />
              </div>
            ) : (
              <div className="backup-no-diff">Physical layout is unavailable for this firmware.</div>
            )}

            <div className="backup-diff-table-wrap">
              <table className="backup-diff-table">
                <thead>
                  <tr><th>Position</th><th>Before: current key</th><th>After: imported key</th><th>Result</th></tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.position} className={row.changed ? 'changed' : ''}>
                      <td>#{row.position}</td>
                      <td><FriendlyBindingView binding={row.current} options={behaviorOptions} /></td>
                      <td><FriendlyBindingView binding={row.imported} options={behaviorOptions} /></td>
                      <td>{row.changed ? <strong className="diff-result-change">→ Will change</strong> : 'Unchanged'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewRows.length === 0 && (
                <div className="backup-no-diff">No key changes in this layer.</div>
              )}
            </div>
          </section>
        </>
      )}

      {message && <div className="notice backup-message">{message}</div>}
    </div>
  );
}
