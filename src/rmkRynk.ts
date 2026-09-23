import { clearConnectedDevice, setConnectedDeviceName } from './deviceIdentity';

type RynkLink = {
  label: string;
  send(bytes: Uint8Array): Promise<void>;
  recv(): Promise<Uint8Array>;
  close(): Promise<void>;
};

export type RmkConnection = {
  kind: 'rmk-usb';
  link: RynkLink;
  client: any;
  device: USBDevice;
};

type UsbEndpoint = { endpointNumber: number; direction: 'in' | 'out'; type: string };

function findRynkInterface(device: USBDevice) {
  const interfaces = device.configuration?.interfaces ?? [];
  for (const iface of interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass === 0xff && alt.interfaceSubclass === 0x52 && alt.interfaceProtocol === 0x52) {
        return { interfaceNumber: iface.interfaceNumber, alternate: alt };
      }
    }
  }
  return null;
}

function makeUsbLink(device: USBDevice, interfaceNumber: number, endpoints: { input: UsbEndpoint; output: UsbEndpoint }): RynkLink {
  const REPORT_SIZE = 4096;
  const rx: Uint8Array[] = [];
  let waiter: (() => void) | null = null;
  let closed = false;
  let reading = false;

  const pump = async () => {
    if (reading || closed) return;
    reading = true;
    try {
      while (!closed) {
        const result = await device.transferIn(endpoints.input.endpointNumber, REPORT_SIZE);
        if (closed) break;
        const data = result.data;
        if (!data || data.byteLength === 0) continue;
        rx.push(new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
        if (waiter) {
          const wake = waiter;
          waiter = null;
          wake();
        }
      }
    } catch (error) {
      if (!closed) console.warn('[MyKeebStudio] RMK USB receive stopped', error);
      closed = true;
      if (waiter) {
        const wake = waiter;
        waiter = null;
        wake();
      }
    } finally {
      reading = false;
    }
  };

  return {
    label: device.productName || `RMK USB ${device.vendorId.toString(16)}:${device.productId.toString(16)}`,
    async send(bytes) {
      if (closed) throw new Error('RMK USB device is closed.');
      await device.transferOut(endpoints.output.endpointNumber, bytes);
    },
    async recv() {
      void pump();
      while (!rx.length && !closed) {
        await new Promise<void>((resolve) => { waiter = resolve; });
      }
      if (!rx.length) return new Uint8Array();
      return rx.shift()!;
    },
    async close() {
      if (closed) {
        try { if (device.opened) await device.close(); } catch { /* ignore */ }
        return;
      }
      closed = true;
      if (waiter) {
        const wake = waiter;
        waiter = null;
        wake();
      }
      try { if (device.opened) await device.close(); } catch (error) {
        console.debug('[MyKeebStudio] RMK USB close ignored', error);
      }
    },
  };
}

async function loadRynkWasm() {
  const moduleUrl = '/rynk-wasm/rynk_wasm.js';
  const wasm = await import(/* @vite-ignore */ moduleUrl);
  await wasm.default();
  return wasm;
}

export async function connectRmkUsb(): Promise<RmkConnection> {
  if (!('usb' in navigator)) {
    throw new Error('WebUSB is unavailable. Use Chrome or Edge over HTTPS or localhost.');
  }

  const usb = (navigator as Navigator & { usb: USB }).usb;
  const device = await usb.requestDevice({
    filters: [{ classCode: 0xff, subclassCode: 0x52, protocolCode: 0x52 }],
  });

  try {
    if (!device.opened) await device.open();
    if (!device.configuration) await device.selectConfiguration(1);

    const found = findRynkInterface(device);
    if (!found) {
      throw new Error('Selected USB device has no RMK Rynk interface (FF/52/52).');
    }

    await device.claimInterface(found.interfaceNumber);
    if (found.alternate.alternateSetting !== 0) {
      await device.selectAlternateInterface(found.interfaceNumber, found.alternate.alternateSetting);
    }

    const endpoints = found.alternate.endpoints.filter((ep) => ep.type === 'bulk');
    const input = endpoints.find((ep) => ep.direction === 'in');
    const output = endpoints.find((ep) => ep.direction === 'out');
    if (!input || !output) throw new Error('RMK Rynk interface has no bulk IN/OUT endpoint pair.');

    const link = makeUsbLink(device, found.interfaceNumber, {
      input: { endpointNumber: input.endpointNumber, direction: 'in', type: input.type },
      output: { endpointNumber: output.endpointNumber, direction: 'out', type: output.type },
    });

    const wasm = await loadRynkWasm();
    const client = await wasm.connect(link);
    const info = await client.get_device_info();
    const name = String(info?.product_name || info?.name || link.label);
    setConnectedDeviceName(name);

    return { kind: 'rmk-usb', link, client, device };
  } catch (error) {
    try { if (device.opened) await device.close(); } catch { /* ignore */ }
    throw error;
  }
}

export async function disconnectRmk(connection: RmkConnection) {
  clearConnectedDevice();
  await connection.link.close();
}

export type RmkPhysicalKey = {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
  r: number;
};

export type RmkBinding = { behaviorId: number; param1: number; param2: number };

export const RMK_KEY_PRESS_BEHAVIOR = 0x7fff0001;
export const RMK_LAYER_BEHAVIOR = 0x7fff0002;
export const RMK_TRANSPARENT_BEHAVIOR = 0x7fff0003;
export const RMK_UNKNOWN_BEHAVIOR = 0x7fff0004;

function variant<T>(value: any, name: string): T | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value[name] as T | undefined;
}

export function keyActionToBinding(action: any): RmkBinding {
  if (action?.No !== undefined) return { behaviorId: 0, param1: 0, param2: 0 };
  if (action?.Transparent !== undefined) return { behaviorId: RMK_TRANSPARENT_BEHAVIOR, param1: 0, param2: 0 };

  const single = variant<any>(action, 'Single') ?? variant<any>(action, 'Tap');
  if (single) {
    const key = variant<any>(single, 'Key');
    if (key) {
      const hid = variant<any>(key, 'Hid');
      if (typeof hid === 'number') return { behaviorId: RMK_KEY_PRESS_BEHAVIOR, param1: hid & 0xffff, param2: 0 };
    }
    const layerOn = variant<any>(single, 'LayerOn');
    if (typeof layerOn === 'number') return { behaviorId: RMK_LAYER_BEHAVIOR, param1: layerOn, param2: 0 };
  }

  const morse = variant<number>(action, 'Morse');
  if (typeof morse === 'number') return { behaviorId: RMK_UNKNOWN_BEHAVIOR, param1: morse, param2: 0 };
  return { behaviorId: RMK_UNKNOWN_BEHAVIOR, param1: 0, param2: 0 };
}

export function bindingToKeyAction(binding: RmkBinding): any {
  switch (binding.behaviorId) {
    case 0: return { No: null };
    case RMK_TRANSPARENT_BEHAVIOR: return { Transparent: null };
    case RMK_LAYER_BEHAVIOR: return { Single: { LayerOn: binding.param1 & 0xff } };
    case RMK_KEY_PRESS_BEHAVIOR: return { Single: { Key: { Hid: binding.param1 & 0xffff } } };
    default:
      throw new Error('This RMK key action is read-only in MyKeebStudio. Choose a standard keyboard key before saving.');
  }
}

export function rmkPhysicalKeys(layout: any): RmkPhysicalKey[] {
  const variantData = layout?.variants?.[layout.default_variant ?? 0] ?? layout?.variants?.[0];
  const keys = variantData?.keys ?? [];
  return keys.map((key: any) => {
    const rect = key.rect ?? {};
    return {
      row: Number(key.row),
      col: Number(key.col),
      x: Number(rect.x) * 100,
      y: Number(rect.y) * 100,
      width: Number(rect.w) * 100,
      height: Number(rect.h) * 100,
      rx: Number(rect.x) * 100 + Number(rect.w) * 50,
      ry: Number(rect.y) * 100 + Number(rect.h) * 50,
      r: Number(key.r) * 100,
    };
  });
}
