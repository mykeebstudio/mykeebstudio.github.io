import {
  makeHidKeyAction,
  makeHidKeyWithModifierAction,
  makeLayerOnAction,
  makeLayerTapAction,
  makeLayerToggleAction,
  makeNoAction,
  makeTransparentAction,
} from './rmkRynkWasm';
import { RMK_JPKEYS } from './rmkJpKeys';

export type ZmkBackupBehavior = {
  id: number;
  displayName: string;
  metadata?: unknown[];
};

export type ZmkBackupBinding = {
  behaviorId: number;
  param1: number;
  param2: number;
};

export type ZmkBackup = {
  format: 'my-zmk-studio-keymap';
  version: 1 | 2;
  exportedAt?: string;
  keymap: {
    layers: Array<{
      id?: number;
      name?: string;
      bindings: ZmkBackupBinding[];
    }>;
  };
  behaviors?: ZmkBackupBehavior[];
};

export type ConvertedZmkKey = {
  layer: number;
  position: number;
  action: any;
  source: string;
};

export type UnsupportedZmkKey = {
  layer: number;
  position: number;
  behaviorId: number;
  behaviorName: string;
  reason: string;
};

export type ConvertedZmkKeymap = {
  layerNames: string[];
  keys: ConvertedZmkKey[];
  unsupported: UnsupportedZmkKey[];
};

function hidKeyName(usage: number): string | null {
  if (usage >= 4 && usage <= 29) return String.fromCharCode(65 + usage - 4);
  if (usage >= 30 && usage <= 38) return `Kc${usage - 29}`;
  if (usage === 39) return 'Kc0';
  if (usage >= 58 && usage <= 81) {
    if (usage <= 69) return `F${usage - 57}`;
  }

  const names: Record<number, string> = {
    40: 'Enter', 41: 'Escape', 42: 'Backspace', 43: 'Tab', 44: 'Space',
    45: 'Minus', 46: 'Equal', 47: 'LeftBracket', 48: 'RightBracket',
    49: 'Backslash', 50: 'NonusHash', 51: 'Semicolon', 52: 'Quote',
    53: 'Grave', 54: 'Comma', 55: 'Dot', 56: 'Slash', 57: 'CapsLock',
    70: 'PrintScreen', 71: 'ScrollLock', 72: 'Pause', 73: 'Insert',
    74: 'Home', 75: 'PageUp', 76: 'Delete', 77: 'End', 78: 'PageDown',
    79: 'Right', 80: 'Left', 81: 'Down', 82: 'Up',
    83: 'NumLock', 84: 'KpSlash', 85: 'KpAsterisk', 86: 'KpMinus',
    87: 'KpPlus', 88: 'KpEnter', 89: 'Kp1', 90: 'Kp2', 91: 'Kp3',
    92: 'Kp4', 93: 'Kp5', 94: 'Kp6', 95: 'Kp7', 96: 'Kp8',
    97: 'Kp9', 98: 'Kp0', 99: 'KpDot', 103: 'KpEqual',
    0x87: 'International1', 0x89: 'International3',
    0x90: 'Language1', 0x91: 'Language2',
    0xe0: 'LCtrl', 0xe1: 'LShift', 0xe2: 'LAlt', 0xe3: 'LGui',
    0xe4: 'RCtrl', 0xe5: 'RShift', 0xe6: 'RAlt', 0xe7: 'RGui',
  };
  return names[usage] ?? null;
}

function decodeKeyboardUsage(value: number) {
  const modifiers = (value >>> 24) & 0xff;
  const page = (value >>> 16) & 0xff;
  const usage = value & 0xffff;
  if (page !== 0x07) return null;

  const key = hidKeyName(usage);
  if (!key) return null;

  if (!modifiers) return makeHidKeyAction(key);
  return makeHidKeyWithModifierAction(key, {
    left_ctrl: !!(modifiers & 0x01),
    left_shift: !!(modifiers & 0x02),
    left_alt: !!(modifiers & 0x04),
    left_gui: !!(modifiers & 0x08),
    right_ctrl: !!(modifiers & 0x10),
    right_shift: !!(modifiers & 0x20),
    right_alt: !!(modifiers & 0x40),
    right_gui: !!(modifiers & 0x80),
  });
}

function behaviorName(backup: ZmkBackup, id: number) {
  return backup.behaviors?.find((behavior) => behavior.id === id)?.displayName?.trim() || '';
}

function convertBinding(backup: ZmkBackup, binding: ZmkBackupBinding): { action?: any; source: string; reason?: string } {
  const name = behaviorName(backup, binding.behaviorId);
  const lower = name.toLowerCase();

  const jp = RMK_JPKEYS.find((choice) => choice.id.toLowerCase() === lower);
  if (jp) return { action: jp.action(), source: jp.id };

  if (/transparent/.test(lower)) return { action: makeTransparentAction(), source: name };
  if (/none|disabled|no action/.test(lower)) return { action: makeNoAction(), source: name };

  if (/layer.?tap|layer tap/.test(lower)) {
    const tap = decodeKeyboardUsage(binding.param2);
    const tapKey = tap?.Single?.Key?.Hid;
    if (!tapKey) return { source: name, reason: 'Layer-Tap tap key is not a plain keyboard HID key.' };
    return { action: makeLayerTapAction(binding.param1, tapKey), source: name };
  }

  if (/momentary.*layer|layer.*momentary/.test(lower)) {
    return { action: makeLayerOnAction(binding.param1), source: name };
  }
  if (/toggle.*layer|layer.*toggle/.test(lower)) {
    return { action: makeLayerToggleAction(binding.param1), source: name };
  }

  if (/mouse.*key.*press|mouse button/.test(lower)) {
    const button = binding.param1 & 0xff;
    if (button >= 1 && button <= 5) {
      return { action: makeHidKeyAction(`MouseBtn${button}`), source: name };
    }
    return { source: name, reason: `Unsupported mouse button value ${binding.param1}.` };
  }

  if (/key.?press|keypress/.test(lower)) {
    const action = decodeKeyboardUsage(binding.param1);
    if (action) return { action, source: name };
    return { source: name, reason: 'Only keyboard-page HID Key Press bindings are supported.' };
  }

  if (!name) {
    return { source: `Behavior #${binding.behaviorId}`, reason: 'Backup has no behavior metadata. Re-export it with MyKeebStudio v2.' };
  }
  return { source: name, reason: 'No RMK converter for this ZMK behavior yet.' };
}

export function parseZmkBackup(value: unknown): ZmkBackup {
  if (!value || typeof value !== 'object') throw new Error('Invalid JSON file.');
  const backup = value as Partial<ZmkBackup>;
  if (backup.format !== 'my-zmk-studio-keymap' || !backup.keymap || !Array.isArray(backup.keymap.layers)) {
    throw new Error('This is not a MyKeebStudio ZMK keymap JSON.');
  }
  if (backup.version !== 1 && backup.version !== 2) throw new Error('Unsupported keymap JSON version.');
  return backup as ZmkBackup;
}

export function convertZmkBackup(backup: ZmkBackup): ConvertedZmkKeymap {
  const keys: ConvertedZmkKey[] = [];
  const unsupported: UnsupportedZmkKey[] = [];

  backup.keymap.layers.forEach((layer, layerIndex) => {
    layer.bindings.forEach((binding, position) => {
      const converted = convertBinding(backup, binding);
      if (converted.action !== undefined) {
        keys.push({ layer: layerIndex, position, action: converted.action, source: converted.source });
      } else {
        unsupported.push({
          layer: layerIndex,
          position,
          behaviorId: binding.behaviorId,
          behaviorName: converted.source,
          reason: converted.reason || 'Unsupported binding.',
        });
      }
    });
  });

  return {
    layerNames: backup.keymap.layers.map((layer, index) => layer.name || `Layer ${index}`),
    keys,
    unsupported,
  };
}
