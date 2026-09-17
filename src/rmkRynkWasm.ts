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
    const wasmUrl = '/rynk-wasm/rynk_wasm.js';
    const module = await import(/* @vite-ignore */ wasmUrl);
    await module.default();
    const client = await module.connect(link);
    return { client, module, link };
  } catch (error) {
    await link.close();
    const text = error instanceof Error ? error.message : String(error);
    if (/Failed to fetch|module/i.test(text)) {
      throw new Error('Rynk WASM is not built. Run: powershell -ExecutionPolicy Bypass -File scripts/build-rynk-wasm.ps1');
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
