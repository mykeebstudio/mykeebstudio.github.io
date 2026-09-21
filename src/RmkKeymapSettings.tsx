import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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
  max_combos?: number;
  max_combo_keys?: number;
};

type RmkKeymapBackup = {
  format: 'mykeebstudio-rmk-keymap';
  version: 1;
  exportedAt: string;
  source: {
    deviceName: string;
  };
  capabilities: {
    num_layers: number;
    num_rows: number;
    num_cols: number;
    max_combos: number;
    max_combo_keys: number;
  };
  keymap: any[];
  combos: any[];
};

type PendingRmkImport = {
  fileName: string;
  backup: RmkKeymapBackup;
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

type ComboOutputCategory = 'keyboard' | 'japanese' | 'layers' | 'mouse';

const RMK_OUTPUT_ROWS: string[][] = [
  ['Escape','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'],
  ['Grave','Kc1','Kc2','Kc3','Kc4','Kc5','Kc6','Kc7','Kc8','Kc9','Kc0','Minus','Equal','Backspace'],
  ['Tab','Q','W','E','R','T','Y','U','I','O','P','LeftBracket','RightBracket','Backslash'],
  ['CapsLock','A','S','D','F','G','H','J','K','L','Semicolon','Quote','Enter'],
  ['LShift','Z','X','C','V','B','N','M','Comma','Dot','Slash','RShift'],
  ['LCtrl','LGui','LAlt','Space','RAlt','RGui','RCtrl'],
];

const RMK_NAV_KEYS = ['Insert','Home','PageUp','Delete','End','PageDown','Left','Down','Up','Right'];
const RMK_MOUSE_KEYS = ['MouseBtn1','MouseBtn2','MouseBtn3','MouseBtn4','MouseBtn5'];

const POSITION_COMBO_TAG = 0x80;

function makeComboPositionAction(row: number, col: number) {
  if (row < 0 || row > 7 || col < 0 || col > 15) {
    throw new Error(`Combo position out of range: row ${row}, col ${col}`);
  }
  return { Morse: POSITION_COMBO_TAG | ((row & 0x07) << 4) | (col & 0x0f) };
}

function comboPositionFromAction(action: any): { row: number; col: number } | null {
  const raw = action?.Morse;
  if (typeof raw !== 'number' || (raw & POSITION_COMBO_TAG) === 0) return null;
  const pos = raw & 0x7f;
  return { row: (pos >> 4) & 0x07, col: pos & 0x0f };
}

function layerLabel(index: number) {
  if (index === 0) return 'Base';
  if (index === 1) return 'Num';
  if (index === 2) return 'Sym';
  if (index === 3) return 'Sys';
  return `Layer ${index}`;
}

function safeFilePart(value: string) {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'rmk-keyboard';
}

function downloadJsonFile(fileName: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function parseRmkBackup(value: unknown): RmkKeymapBackup {
  if (!value || typeof value !== 'object') throw new Error('Invalid RMK backup JSON.');
  const backup = value as Partial<RmkKeymapBackup>;
  if (backup.format !== 'mykeebstudio-rmk-keymap' || backup.version !== 1) {
    throw new Error('This is not a supported MyKeebStudio RMK backup.');
  }

  const capabilities = backup.capabilities as Partial<RmkKeymapBackup['capabilities']> | undefined;
  const numericCaps = ['num_layers', 'num_rows', 'num_cols', 'max_combos', 'max_combo_keys'] as const;
  if (!capabilities || numericCaps.some((key) => {
    const value = capabilities[key];
    return typeof value !== 'number' || !Number.isInteger(value) || value < 0;
  })) {
    throw new Error('RMK backup capabilities are missing or invalid.');
  }
  if (!backup.source || typeof backup.source.deviceName !== 'string') {
    throw new Error('RMK backup source information is missing.');
  }
  if (!Array.isArray(backup.keymap) || !Array.isArray(backup.combos)) {
    throw new Error('RMK backup keymap/combo data is missing.');
  }

  return backup as RmkKeymapBackup;
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

export default function RmkKeymapSettings({
  onDebug,
  onConnectionChange,
}: {
  onDebug: (event: string, detail?: unknown) => void;
  onConnectionChange?: (connected: boolean) => void;
}) {
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
  const [zmkImportName, setZmkImportName] = useState('');
  const zmkImportRef = useRef<HTMLInputElement | null>(null);
  const [rmkImport, setRmkImport] = useState<PendingRmkImport | null>(null);
  const rmkImportRef = useRef<HTMLInputElement | null>(null);
  const [layerActionType, setLayerActionType] = useState<'mo' | 'tg' | 'lt'>('lt');
  const [layerActionTarget, setLayerActionTarget] = useState(1);
  const [layerTapKey, setLayerTapKey] = useState('Space');
  const [combos, setCombos] = useState<any[]>([]);
  const [comboSlot, setComboSlot] = useState(0);
  const [comboTriggers, setComboTriggers] = useState<any[]>([]);
  const [comboLayer, setComboLayer] = useState(-1);
  const [comboOutputAction, setComboOutputAction] = useState<any>(() => makeHidKeyAction('Escape'));
  const [showComboOutputPicker, setShowComboOutputPicker] = useState(false);
  const [comboOutputCategory, setComboOutputCategory] = useState<ComboOutputCategory>('keyboard');
  const [visibleLayerCount, setVisibleLayerCount] = useState(4);

  const rows = caps?.num_rows ?? 0;
  const cols = caps?.num_cols ?? 0;
  const layers = caps?.num_layers ?? 0;
  const connected = !!sessionRef.current;

  const usePg1kbPhysicalLayout = rows === 5 && cols === 12;

  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void session.link.close();
    };
  }, []);

  useEffect(() => {
    if (!selected || visibleLayerCount <= 1) return;
    if (layerActionTarget < visibleLayerCount && layerActionTarget !== selected.layer) return;
    const next = Array.from({ length: visibleLayerCount }, (_, index) => index)
      .find((index) => index !== selected.layer);
    if (next !== undefined) setLayerActionTarget(next);
  }, [selected?.layer, visibleLayerCount, layerActionTarget]);

  async function connect() {
    setBusy(true);
    setError(null);
    setMessage('Opening official Rynk WASM session…');
    try {
      const session = await openRynkSession();
      sessionRef.current = session;
      onConnectionChange?.(true);
      const [nextCaps, deviceInfo, keymap] = await Promise.all([
        session.client.get_capabilities(),
        session.client.get_device_info(),
        session.client.read_all_keymap(),
      ]);
      const comboList: any[] = nextCaps.max_combos
        ? Array.from((await session.client.read_all_combos()) as Iterable<any>)
        : [];
      const catalog = Array.from(session.module.all_hid_keycodes?.() ?? []).map(String);
      setCaps(nextCaps);
      const savedVisibleLayers = Number(window.localStorage.getItem('mykeebstudio-rmk-visible-layers') || 4);
      setVisibleLayerCount(Math.max(1, Math.min(nextCaps.num_layers ?? 1, Number.isFinite(savedVisibleLayers) ? savedVisibleLayers : 4)));
      setActions(Array.from(keymap));
      setHidKeys(catalog);
      setCombos(comboList);
      setComboSlot(0);
      setComboTriggers(Array.from(comboList[0]?.actions ?? []));
      setComboLayer(typeof comboList[0]?.layer === 'number' ? comboList[0].layer : -1);
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
      onConnectionChange?.(false);
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
      onConnectionChange?.(false);
      setLabel('');
      setCaps(null);
      setActions([]);
      setHidKeys([]);
      setCombos([]);
      setComboTriggers([]);
      setRmkImport(null);
      setZmkImport(null);
      setZmkImportName('');
      setSelected(null);
      setError(null);
      setMessage('Disconnected from Rynk WebHID.');
      setBusy(false);
    }
  }

  function addLayer() {
    if (!caps?.num_layers) return;
    setVisibleLayerCount((current) => {
      const next = Math.min(caps.num_layers ?? current, current + 1);
      try {
        window.localStorage.setItem('mykeebstudio-rmk-visible-layers', String(next));
      } catch { /* browser storage is optional */ }
      setLayer(next - 1);
      setSelected(null);
      setMessage(`${layerLabel(next - 1)} added. RMK reserved layer ${next - 1} is now available for editing.`);
      return next;
    });
  }

  async function deleteLastLayer() {
    const session = sessionRef.current;
    if (!session || !caps || visibleLayerCount <= 4) return;

    const deleteLayer = visibleLayerCount - 1;
    setBusy(true);
    setError(null);
    try {
      const nextActions = [...actions];
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          nextActions[actionIndex(deleteLayer, row, col, rows, cols)] = makeTransparentAction();
        }
      }

      setMessage(`Clearing ${layerLabel(deleteLayer)} before removing it…`);
      await withTimeout(
        session.client.write_all_keymap(nextActions),
        30000,
        'Rynk ClearRemovedLayer',
      );

      const nextVisible = visibleLayerCount - 1;
      try {
        window.localStorage.setItem('mykeebstudio-rmk-visible-layers', String(nextVisible));
      } catch { /* browser storage is optional */ }

      setActions(nextActions);
      setVisibleLayerCount(nextVisible);
      if (layer >= nextVisible) setLayer(nextVisible - 1);
      setSelected(null);
      setMessage(`${layerLabel(deleteLayer)} removed and cleared to Transparent.`);
      onDebug('RMK reserved layer removed', { layer: deleteLayer });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage(`Layer removal failed: ${text}`);
    } finally {
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


  async function exportRmkBackup() {
    const session = sessionRef.current;
    if (!session || !caps) return;

    setBusy(true);
    setError(null);
    try {
      setMessage('Reading RMK keymap and combos for backup…');
      const [freshKeymap, freshCombos] = await Promise.all([
        withTimeout<any[]>(session.client.read_all_keymap(), 15000, 'Rynk ReadKeymap'),
        (caps.max_combos ?? 0) > 0
          ? withTimeout<any[]>(session.client.read_all_combos(), 10000, 'Rynk ReadCombos')
          : Promise.resolve([]),
      ]);

      const backup: RmkKeymapBackup = {
        format: 'mykeebstudio-rmk-keymap',
        version: 1,
        exportedAt: new Date().toISOString(),
        source: { deviceName: label || session.link.label || 'RMK keyboard' },
        capabilities: {
          num_layers: caps.num_layers ?? 0,
          num_rows: caps.num_rows ?? 0,
          num_cols: caps.num_cols ?? 0,
          max_combos: caps.max_combos ?? 0,
          max_combo_keys: caps.max_combo_keys ?? 0,
        },
        keymap: Array.from(freshKeymap),
        combos: Array.from(freshCombos),
      };

      setActions(backup.keymap);
      setCombos(backup.combos);
      const date = new Date().toISOString().slice(0, 10);
      const fileName = `${safeFilePart(backup.source.deviceName)}-rmk-${date}.json`;
      downloadJsonFile(fileName, backup);
      setMessage(`RMK backup exported: ${backup.keymap.length} key actions and ${backup.combos.length} combo slots.`);
      onDebug('RMK backup exported', { fileName, capabilities: backup.capabilities });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage(`RMK backup export failed: ${text}`);
      onDebug('RMK backup export failed', text);
    } finally {
      setBusy(false);
    }
  }

  async function chooseRmkJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    try {
      const backup = parseRmkBackup(JSON.parse(await file.text()));
      const expectedActions = layers * rows * cols;
      const maxCombos = caps?.max_combos ?? 0;

      if (
        backup.capabilities.num_layers !== layers ||
        backup.capabilities.num_rows !== rows ||
        backup.capabilities.num_cols !== cols
      ) {
        throw new Error(
          `RMK backup geometry is ${backup.capabilities.num_layers} layer(s), ${backup.capabilities.num_rows}×${backup.capabilities.num_cols}; ` +
          `this keyboard is ${layers} layer(s), ${rows}×${cols}.`,
        );
      }
      if (backup.keymap.length !== expectedActions) {
        throw new Error(`RMK backup has ${backup.keymap.length} key actions; this keyboard expects ${expectedActions}.`);
      }
      if (backup.capabilities.max_combos !== maxCombos || backup.combos.length !== maxCombos) {
        throw new Error(
          `RMK backup has ${backup.combos.length}/${backup.capabilities.max_combos} combo slots; this keyboard expects ${maxCombos}.`,
        );
      }

      setZmkImport(null);
      setZmkImportName('');
      setRmkImport({ fileName: file.name, backup });
      setMessage(`RMK backup loaded: ${backup.source.deviceName || file.name}.`);
      onDebug('RMK backup validated', { fileName: file.name, capabilities: backup.capabilities });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setRmkImport(null);
      setError(text);
      setMessage(`RMK backup import failed: ${text}`);
      onDebug('RMK backup import failed', text);
    }
  }

  async function applyRmkImport() {
    const session = sessionRef.current;
    if (!session || !rmkImport) return;

    setBusy(true);
    setError(null);
    try {
      setMessage('Restoring RMK keymap…');
      await withTimeout(
        session.client.write_all_keymap(rmkImport.backup.keymap),
        30000,
        'Rynk WriteKeymap',
      );

      if ((caps?.max_combos ?? 0) > 0) {
        setMessage('Restoring RMK combos…');
        await withTimeout(
          session.client.write_all_combos(rmkImport.backup.combos),
          15000,
          'Rynk WriteCombos',
        );
      }

      const [freshKeymap, freshCombos] = await Promise.all([
        withTimeout<any[]>(session.client.read_all_keymap(), 15000, 'Rynk VerifyKeymap'),
        (caps?.max_combos ?? 0) > 0
          ? withTimeout<any[]>(session.client.read_all_combos(), 10000, 'Rynk VerifyCombos')
          : Promise.resolve([]),
      ]);

      const nextActions = Array.from(freshKeymap);
      const nextCombos = Array.from(freshCombos);
      setActions(nextActions);
      setCombos(nextCombos);
      const activeCombo = nextCombos[comboSlot];
      setComboTriggers(Array.from(activeCombo?.actions ?? []));
      setComboLayer(typeof activeCombo?.layer === 'number' ? activeCombo.layer : -1);
      if (activeCombo?.output) setComboOutputAction(activeCombo.output);
      setLayer(0);
      setSelected(null);
      setRmkImport(null);
      setMessage(`RMK backup restored and verified: ${nextActions.length} key actions, ${nextCombos.length} combo slots.`);
      onDebug('RMK backup restored', { keyActions: nextActions.length, comboSlots: nextCombos.length });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage(`RMK backup restore failed: ${text}`);
      onDebug('RMK backup restore failed', text);
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

      setRmkImport(null);
      setZmkImport(converted);
      setZmkImportName(file.name);
      setMessage(
        `ZMK backup ready for RMK: ${converted.keys.length} convertible key(s), ${converted.unsupported.length} unsupported binding(s).`,
      );
      onDebug('ZMK JSON converted for RMK', {
        fileName: file.name,
        layers: converted.layerNames.length,
        convertible: converted.keys.length,
        unsupported: converted.unsupported,
      });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setZmkImport(null);
      setZmkImportName('');
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
      setMessage(`Preparing ${zmkImport.keys.length} converted ZMK binding(s)…`);
      const nextActions = [...actions];

      for (const item of zmkImport.keys) {
        const matrix = importedMatrixPosition(item.position);
        if (!matrix) continue;
        const index = actionIndex(item.layer, matrix.row, matrix.col, rows, cols);
        if (index < 0 || index >= nextActions.length) continue;
        nextActions[index] = item.action;
        written += 1;
      }

      await withTimeout(
        session.client.write_all_keymap(nextActions),
        30000,
        'Rynk WriteConvertedKeymap',
      );

      const keymap = await withTimeout<any[]>(
        session.client.read_all_keymap(),
        15000,
        'Read imported RMK keymap',
      );
      setActions(Array.from(keymap));
      setLayer(0);
      setSelected(null);
      setZmkImport(null);
      setZmkImportName('');
      setMessage(
        `ZMK → RMK import complete: ${written} key(s) written${zmkImport.unsupported.length ? `; ${zmkImport.unsupported.length} unsupported binding(s) preserved from the current RMK keymap` : ''}. Combos were not changed.`,
      );
      onDebug('ZMK JSON applied to RMK', {
        written,
        unsupported: zmkImport.unsupported,
        combosChanged: false,
      });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage(`ZMK → RMK import failed: ${text}`);
      onDebug('ZMK JSON apply failed', { written, error: text });
    } finally {
      setBusy(false);
    }
  }


  function sameAction(a: any, b: any) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function loadComboSlot(index: number) {
    const combo = combos[index];
    setComboSlot(index);
    setComboTriggers(Array.from(combo?.actions ?? []));
    setComboLayer(typeof combo?.layer === 'number' ? combo.layer : -1);
    const out = combo?.output;
    if (out) setComboOutputAction(out);
  }

  function toggleComboTrigger(row: number, col: number) {
    const token = makeComboPositionAction(row, col);
    setComboTriggers((current) => {
      const exists = current.some((item) => sameAction(item, token));
      if (exists) return current.filter((item) => !sameAction(item, token));
      const max = caps?.max_combo_keys ?? 4;
      if (current.length >= max) return current;
      return [...current, token];
    });
  }

  function comboTriggerDisplay(token: any) {
    const pos = comboPositionFromAction(token);
    if (!pos) {
      const info = actionDisplay(token);
      return { ...info, position: null as { row: number; col: number } | null };
    }
    const idx = actionIndex(layer, pos.row, pos.col, rows, cols);
    const info = actionDisplay(actions[idx]);
    return { ...info, position: pos };
  }

  async function saveCombo() {
    const session = sessionRef.current;
    if (!session) return;
    if (comboTriggers.length < 2) {
      setError('A combo needs at least 2 trigger keys.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const config = {
        actions: comboTriggers,
        output: comboOutputAction,
        layer: comboLayer < 0 ? undefined : comboLayer,
      };
      await withTimeout(session.client.set_combo(comboSlot, config), 4000, 'Rynk SetCombo');
      const fresh = await withTimeout<any[]>(session.client.read_all_combos(), 8000, 'Rynk ReadCombos');
      const next = Array.from(fresh);
      setCombos(next);
      setMessage(`Saved Combo ${comboSlot + 1}: ${comboTriggers.length} trigger key(s) → ${actionDisplay(comboOutputAction).primary}.`);
      onDebug('RMK combo saved', { slot: comboSlot, config });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage(`Combo save failed: ${text}`);
      onDebug('RMK combo save failed', { slot: comboSlot, error: text });
    } finally {
      setBusy(false);
    }
  }

  async function clearCombo() {
    const session = sessionRef.current;
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const config = { actions: [], output: makeNoAction(), layer: undefined };
      await withTimeout(session.client.set_combo(comboSlot, config), 4000, 'Rynk ClearCombo');
      const fresh = await withTimeout<any[]>(session.client.read_all_combos(), 8000, 'Rynk ReadCombos');
      const next = Array.from(fresh);
      setCombos(next);
      setComboTriggers([]);
      setComboLayer(-1);
      setMessage(`Cleared Combo ${comboSlot + 1}.`);
      onDebug('RMK combo cleared', { slot: comboSlot });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage(`Combo clear failed: ${text}`);
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
        <button className="button secondary" type="button" disabled={busy} onClick={() => void exportRmkBackup()}>Export RMK</button>
        <button className="button secondary" type="button" disabled={busy} onClick={() => rmkImportRef.current?.click()}>Import RMK</button>
        <input ref={rmkImportRef} type="file" accept="application/json,.json" hidden onChange={chooseRmkJson} />
        <button className="button secondary" type="button" disabled={busy} onClick={() => zmkImportRef.current?.click()}>Import ZMK</button>
        <input ref={zmkImportRef} type="file" accept="application/json,.json" hidden onChange={chooseZmkJson} />
        <button className="button secondary" type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
      </div>

      {error && <div className="notice">{error}</div>}

      {rmkImport && (
        <section className="panel rmk-zmk-import-preview">
          <div>
            <div className="eyebrow">RMK native backup</div>
            <h3>Restore preview</h3>
            <p>
              {rmkImport.fileName} · {rmkImport.backup.source.deviceName} · {rmkImport.backup.capabilities.num_layers} layer(s)
              {' · '}{rmkImport.backup.capabilities.num_rows}×{rmkImport.backup.capabilities.num_cols}
              {' · '}{rmkImport.backup.combos.filter((combo) => (combo?.actions?.length ?? 0) >= 2).length} configured combo(s)
            </p>
            <p>Restores the full RMK keymap and all combo slots, then reads them back from the keyboard for verification.</p>
          </div>
          <div className="rmk-keymap-quick-actions">
            <button className="button secondary" type="button" disabled={busy} onClick={() => setRmkImport(null)}>Cancel</button>
            <button className="button" type="button" disabled={busy} onClick={() => void applyRmkImport()}>
              Restore keymap + combos
            </button>
          </div>
        </section>
      )}

      {zmkImport && (
        <section className="panel rmk-zmk-import-preview">
          <div>
            <div className="eyebrow">Cross-firmware import</div>
            <h3>ZMK → RMK migration preview</h3>
            <p>
              {zmkImportName ? `${zmkImportName} · ` : ''}{zmkImport.layerNames.length} layer(s) · {zmkImport.keys.length} convertible key(s)
              {zmkImport.unsupported.length ? ` · ${zmkImport.unsupported.length} unsupported` : ' · all supported'}
            </p>
            <p>Supported bindings are converted and written in one Rynk keymap update. Unsupported bindings keep the current RMK value. RMK combos are not changed.</p>
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
            <button className="button secondary" type="button" disabled={busy} onClick={() => { setZmkImport(null); setZmkImportName(''); }}>Cancel</button>
            <button className="button" type="button" disabled={busy || zmkImport.keys.length === 0} onClick={() => void applyZmkImport()}>
              {zmkImport.unsupported.length ? 'Write supported keys to RMK' : 'Write ZMK keymap to RMK'}
            </button>
          </div>
        </section>
      )}

      {(caps.max_combos ?? 0) > 0 && (
        <section className="panel rmk-combo-editor">
          <div className="combo-editor-guided">
            <div className="combo-editor-title">
              <div>
                <span>RMK Combo #{comboSlot + 1}</span>
                <h3>Combo {comboSlot + 1}</h3>
                <p>Choose physical key positions, output and active layer. Changing the keymap later will not change which switches trigger the combo.</p>
              </div>
              <div className="rmk-combo-slot-select">
                <label>
                  <span>Combo slot</span>
                  <select
                    disabled={busy}
                    value={comboSlot}
                    onChange={(event) => loadComboSlot(Number(event.target.value))}
                  >
                    {Array.from({ length: caps.max_combos ?? 0 }, (_, index) => (
                      <option key={index} value={index}>
                        Combo {index + 1}{(combos[index]?.actions?.length ?? 0) >= 2 ? ' • configured' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <section className="combo-step">
              <div className="combo-step-number">1</div>
              <div className="combo-step-body">
                <div className="combo-step-heading">
                  <div>
                    <h4>Combo keys</h4>
                    <p>Click two or more keys on the keyboard. Selected order is shown on each key.</p>
                  </div>
                  <span className={`combo-count ${comboTriggers.length >= 2 ? 'ok' : ''}`}>
                    {comboTriggers.length} selected
                  </span>
                </div>

                {usePg1kbPhysicalLayout ? (
                  <div className="combo-position-scroll">
                    <div
                      className="combo-position-picker rmk-combo-position-picker"
                      style={{ width: 600, height: 252 }}
                    >
                      {PG1KB_PHYSICAL_KEYS.map(({ matrix: [row, col], x, y }, position) => {
                        const index = actionIndex(layer, row, col, rows, cols);
                        const action = actions[index];
                        if (!action) return null;
                        const token = makeComboPositionAction(row, col);
                        const selectedOrder = comboTriggers.findIndex((item) => sameAction(item, token));
                        const isSelected = selectedOrder >= 0;
                        const info = actionDisplay(action);
                        return (
                          <button
                            key={position}
                            type="button"
                            className={`combo-position-key rmk-combo-position-key ${isSelected ? 'selected' : ''}`}
                            style={{
                              left: (x / 100) * 48,
                              top: (y / 100) * 48,
                              width: 45,
                              height: 45,
                            }}
                            disabled={busy}
                            onClick={() => toggleComboTrigger(row, col)}
                            title={`${info.primary}${info.secondary ? ` · ${info.secondary}` : ''}`}
                          >
                            <span>{info.primary}</span>
                            {isSelected && <strong>{selectedOrder + 1}</strong>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rmk-combo-choice-grid">
                    {Array.from({ length: rows * cols }, (_, position) => {
                      const row = Math.floor(position / cols);
                      const col = position % cols;
                      const index = actionIndex(layer, row, col, rows, cols);
                      const action = actions[index];
                      const token = makeComboPositionAction(row, col);
                      const chosen = comboTriggers.some((item) => sameAction(item, token));
                      const info = actionDisplay(action);
                      return (
                        <button
                          type="button"
                          key={position}
                          className={`button rmk-combo-choice ${chosen ? '' : 'secondary'}`}
                          disabled={busy}
                          onClick={() => toggleComboTrigger(row, col)}
                        >
                          <strong>{info.primary}</strong>
                          <small>R{row} C{col}{info.secondary ? ` · ${info.secondary}` : ''}</small>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="combo-selected-list">
                  {comboTriggers.length
                    ? comboTriggers.map((token, index) => {
                        const display = comboTriggerDisplay(token);
                        return (
                          <span key={index}>
                            {index + 1}. {display.primary}
                            {display.position ? ` · R${display.position.row} C${display.position.col}` : ' · legacy action'}
                          </span>
                        );
                      })
                    : <span>Select at least 2 keys</span>}
                </div>
              </div>
            </section>

            <section className="combo-step">
              <div className="combo-step-number">2</div>
              <div className="combo-step-body">
                <div className="combo-step-heading">
                  <div><h4>Output</h4><p>What should the combo send?</p></div>
                </div>

                {(() => {
                  const current = actionDisplay(comboOutputAction);
                  return (
                    <button
                      type="button"
                      className="combo-output-card"
                      disabled={busy}
                      onClick={() => setShowComboOutputPicker((value) => !value)}
                    >
                      <span>Current output</span>
                      <strong>{current.primary}</strong>
                      <small>{current.secondary || rynkActionLabel(comboOutputAction)}</small>
                      <em>{showComboOutputPicker ? 'Close ↑' : 'Change output →'}</em>
                    </button>
                  );
                })()}

                {showComboOutputPicker && (
                  <div className="rmk-combo-output-picker rmk-combo-output-picker-guided">
                    <div className="binding-category-tabs rmk-combo-output-tabs" role="tablist" aria-label="Combo output category">
                      {[
                        ['keyboard', 'Keyboard'],
                        ['japanese', 'Japanese'],
                        ['layers', 'Layers'],
                        ['mouse', 'Mouse'],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          role="tab"
                          aria-selected={comboOutputCategory === id}
                          className={comboOutputCategory === id ? 'active' : ''}
                          onClick={() => setComboOutputCategory(id as ComboOutputCategory)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {comboOutputCategory === 'keyboard' && (
                      <>
                        <div className="rmk-combo-keyboard-picker">
                          {RMK_OUTPUT_ROWS.map((row, rowIndex) => (
                            <div className="rmk-combo-keyboard-row" key={rowIndex}>
                              {row.map((key) => {
                                const info = friendlyKeyDisplay(key);
                                return (
                                  <button
                                    type="button"
                                    className="key-picker-key keyboard-layout-key"
                                    key={key}
                                    disabled={busy}
                                    onClick={() => {
                                      setComboOutputAction(makeHidKeyAction(key));
                                      setShowComboOutputPicker(false);
                                    }}
                                  >
                                    {info.secondary && <small>{info.secondary}</small>}
                                    <strong>{info.primary}</strong>
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                        <div className="binding-quick-section">
                          <div className="binding-quick-heading"><strong>Navigation</strong><span>Quick choices</span></div>
                          <div className="rmk-combo-output-picker-grid">
                            {RMK_NAV_KEYS.map((key) => {
                              const info = friendlyKeyDisplay(key);
                              return (
                                <button
                                  type="button"
                                  className="button secondary rmk-combo-choice"
                                  key={key}
                                  onClick={() => {
                                    setComboOutputAction(makeHidKeyAction(key));
                                    setShowComboOutputPicker(false);
                                  }}
                                >
                                  <strong>{info.primary}</strong>
                                  <small>{info.secondary || key}</small>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}

                    {comboOutputCategory === 'japanese' && (
                      <div className="rmk-jpkeys-grid rmk-combo-jp-grid">
                        {RMK_JPKEYS.map((choice) => (
                          <button
                            className="button secondary rmk-jpkey-button"
                            type="button"
                            key={choice.id}
                            disabled={busy}
                            title={choice.description}
                            onClick={() => {
                              setComboOutputAction(choice.action());
                              setShowComboOutputPicker(false);
                            }}
                          >
                            <strong>{choice.label}</strong>
                            <small>{choice.id.replace('JP_', '')}</small>
                          </button>
                        ))}
                      </div>
                    )}

                    {comboOutputCategory === 'layers' && (
                      <div className="rmk-combo-layer-output-grid">
                        {Array.from({ length: visibleLayerCount }, (_, target) => (
                          <div className="rmk-combo-layer-output-card" key={target}>
                            <strong>{layerLabel(target)}</strong>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setComboOutputAction(makeLayerOnAction(target));
                                setShowComboOutputPicker(false);
                              }}
                            >
                              Hold {layerLabel(target)}
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setComboOutputAction(makeLayerToggleAction(target));
                                setShowComboOutputPicker(false);
                              }}
                            >
                              Toggle {layerLabel(target)}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {comboOutputCategory === 'mouse' && (
                      <div className="rmk-combo-output-picker-grid">
                        {RMK_MOUSE_KEYS.map((key) => {
                          const info = friendlyKeyDisplay(key);
                          return (
                            <button
                              type="button"
                              className="button secondary rmk-combo-choice"
                              key={key}
                              disabled={busy}
                              onClick={() => {
                                setComboOutputAction(makeHidKeyAction(key));
                                setShowComboOutputPicker(false);
                              }}
                            >
                              <strong>{info.primary}</strong>
                              <small>{info.secondary || key}</small>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="combo-step">
              <div className="combo-step-number">3</div>
              <div className="combo-step-body">
                <div className="combo-step-heading">
                  <div><h4>Active layer</h4><p>Choose where this combo is active.</p></div>
                </div>
                <div className="combo-segmented rmk-combo-layer-segmented">
                  <button
                    type="button"
                    className={comboLayer === -1 ? 'active' : ''}
                    disabled={busy}
                    onClick={() => setComboLayer(-1)}
                  >
                    Any layer
                  </button>
                  {Array.from({ length: visibleLayerCount }, (_, index) => (
                    <button
                      type="button"
                      key={index}
                      className={comboLayer === index ? 'active' : ''}
                      disabled={busy}
                      onClick={() => setComboLayer(index)}
                    >
                      {layerLabel(index)}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <div className="combo-save-bar">
              <div>
                <strong>Ready to save?</strong>
                <span>
                  {comboTriggers.length >= 2
                    ? `${comboTriggers.map((token) => comboTriggerDisplay(token).primary).join(' + ')} → ${actionDisplay(comboOutputAction).primary}`
                    : 'Select at least two combo keys.'}
                </span>
              </div>
              <div className="rmk-keymap-quick-actions">
                <button className="button secondary" type="button" disabled={busy} onClick={() => void clearCombo()}>
                  Clear
                </button>
                <button className="button" type="button" disabled={busy || comboTriggers.length < 2} onClick={() => void saveCombo()}>
                  {busy ? 'Saving…' : 'Save combo to firmware'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="rmk-keymap-layer-tabs">
        {Array.from({ length: visibleLayerCount }, (_, index) => (
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
        {visibleLayerCount < layers && (
          <button
            className="button secondary rmk-add-layer"
            type="button"
            disabled={busy}
            onClick={addLayer}
          >
            + Add layer
          </button>
        )}
        {visibleLayerCount > 4 && (
          <button
            className="button secondary rmk-delete-layer"
            type="button"
            disabled={busy}
            onClick={() => void deleteLastLayer()}
            title="Remove the highest added RMK layer and clear it to Transparent"
          >
            − Delete layer
          </button>
        )}
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
                      {Array.from({ length: visibleLayerCount }, (_, index) => index)
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
