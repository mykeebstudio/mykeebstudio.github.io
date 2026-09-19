export type RynkSession = {
  client: any;
  module: any;
  link: { label: string; send: (bytes: Uint8Array) => Promise<void>; recv: () => Promise<Uint8Array>; close: () => Promise<void> };
};

const REPORT_SIZE = 32;

export async function openRynkSession(): Promise<RynkSession> {
  const hid = (navigator as any).hid;
  if (!hid) throw new Error('WebHID is unavailable. Use Chrome or Edge.');

  const devices = await hid.requestDevice({ filters: [{ usagePage: 0xff14, usage: 0x61 }] });
  if (!devices.length) throw new Error('No RMK Rynk HID device selected.');
  const device = devices[0];
  if (!device.opened) await device.open();

  let closed = false;
  const queue: Uint8Array[] = [];
  let wake: (() => void) | null = null;

  const onReport = (event: any) => {
    const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    queue.push(data.slice());
    if (wake) {
      const fn = wake;
      wake = null;
      fn();
    }
  };
  device.addEventListener('inputreport', onReport);

  const link = {
    label: device.productName || 'RMK keyboard',
    async send(bytes: Uint8Array) {
      for (let offset = 0; offset < bytes.length; offset += REPORT_SIZE) {
        const report = new Uint8Array(REPORT_SIZE);
        report.set(bytes.subarray(offset, offset + REPORT_SIZE));
        await device.sendReport(0, report);
      }
    },
    async recv() {
      while (!queue.length && !closed) {
        await new Promise<void>((resolve) => { wake = resolve; });
      }
      if (!queue.length) return new Uint8Array(0);
      return queue.shift()!;
    },
    async close() {
      closed = true;
      device.removeEventListener('inputreport', onReport);
      if (wake) {
        const fn = wake;
        wake = null;
        fn();
      }
      try { await device.close(); } catch { /* ignore */ }
    },
  };

  try {
    const wasmUrl = new URL('/rynk-wasm/rynk_wasm.js', window.location.origin).href;
    // Files under Vite's public/ directory are served verbatim and must not be
    // resolved by Vite's module graph. Use native runtime import so dev/build
    // both load the generated Rynk module directly from /rynk-wasm/.
    const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
    const module = await nativeImport(wasmUrl);
    await module.default();
    const client = await module.connect(link);
    return { client, module, link };
  } catch (error) {
    await link.close();
    const text = error instanceof Error ? error.message : String(error);
    if (/Failed to fetch|module/i.test(text)) {
      throw new Error('Rynk WASM is not built. Run: npm run build:rynk-wasm');
    }
    throw error;
  }
}

export function rynkActionLabel(action: any): string {
  if (action == null) return 'Unknown';
  if (typeof action === 'string') return action;
  if (typeof action !== 'object') return String(action);

  if ('Single' in action) return actionLabel(action.Single);
  if ('Tap' in action) return `Tap(${actionLabel(action.Tap)})`;
  if ('TapHold' in action) return 'TapHold';
  if ('Morse' in action) return `Morse ${action.Morse}`;
  return Object.keys(action)[0] || 'Unknown';
}

function actionLabel(action: any): string {
  if (typeof action === 'string') return action;
  if (!action || typeof action !== 'object') return String(action ?? 'Unknown');
  if ('Key' in action) return keyCodeLabel(action.Key);
  if ('KeyWithModifier' in action) {
    const value = action.KeyWithModifier;
    const key = Array.isArray(value) ? value[0] : value?.[0] ?? value?.key ?? 'Key';
    const mods = Array.isArray(value) ? value[1] : value?.[1] ?? value?.modifiers ?? {};
    const names = [
      mods.left_ctrl && 'LCtrl',
      mods.left_shift && 'LShift',
      mods.left_alt && 'LAlt',
      mods.left_gui && 'LGui',
      mods.right_ctrl && 'RCtrl',
      mods.right_shift && 'RShift',
      mods.right_alt && 'RAlt',
      mods.right_gui && 'RGui',
    ].filter(Boolean);
    return `WM(${key}, ${names.join('|') || 'Mod'})`;
  }
  if ('LayerOn' in action) return `MO(${action.LayerOn})`;
  if ('LayerToggle' in action) return `TG(${action.LayerToggle})`;
  if ('DefaultLayer' in action) return `DF(${action.DefaultLayer})`;
  if ('PersistentDefaultLayer' in action) return `PDF(${action.PersistentDefaultLayer})`;
  if ('OneShotLayer' in action) return `OSL(${action.OneShotLayer})`;
  return Object.keys(action)[0] || 'Action';
}

function keyCodeLabel(value: any): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return String(value ?? 'Key');
  if ('Hid' in value) return String(value.Hid);
  if ('Consumer' in value) return String(value.Consumer);
  if ('SystemControl' in value) return String(value.SystemControl);
  return Object.keys(value)[0] || 'Key';
}

export function makeNoAction() { return 'No'; }
export function makeTransparentAction() { return 'Transparent'; }
export function makeHidKeyAction(name: string) { return { Single: { Key: { Hid: name } } }; }
export function makeLayerOnAction(layer: number) { return { Single: { LayerOn: layer } }; }
export function makeLayerToggleAction(layer: number) { return { Single: { LayerToggle: layer } }; }

export type RmkModifierCombination = {
  left_ctrl: boolean;
  left_shift: boolean;
  left_alt: boolean;
  left_gui: boolean;
  right_ctrl: boolean;
  right_shift: boolean;
  right_alt: boolean;
  right_gui: boolean;
};

export function makeHidKeyWithModifierAction(
  name: string,
  modifiers: Partial<RmkModifierCombination>,
) {
  const value: RmkModifierCombination = {
    left_ctrl: false,
    left_shift: false,
    left_alt: false,
    left_gui: false,
    right_ctrl: false,
    right_shift: false,
    right_alt: false,
    right_gui: false,
    ...modifiers,
  };
  return { Single: { KeyWithModifier: [name, value] } };
}
