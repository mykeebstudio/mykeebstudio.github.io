// HID usage modifier flags live in the top byte (bits 24-31) of an encoded
// HID usage value, matching how LayerViewer/KeymapBackup decode them:
//   bit 0 LCtrl, 1 LShift, 2 LAlt, 3 LGUI, 4 RCtrl, 5 RShift, 6 RAlt, 7 RGUI
export const HID_MODIFIERS: Array<{ bit: number; label: string }> = [
  { bit: 0, label: 'LCtrl' },
  { bit: 1, label: 'LShift' },
  { bit: 2, label: 'LAlt' },
  { bit: 3, label: 'LGUI' },
  { bit: 4, label: 'RCtrl' },
  { bit: 5, label: 'RShift' },
  { bit: 6, label: 'RAlt' },
  { bit: 7, label: 'RGUI' },
];

export function modifiersFromParam(value: number): number {
  return (value >>> 24) & 0xff;
}

export function modifierNames(mask: number): string[] {
  return HID_MODIFIERS.filter((item) => mask & (1 << item.bit)).map((item) => item.label);
}

// Encode a HID usage with a modifier mask. Multiplication is used for the
// top byte so masks >= 0x80 stay positive (same pattern as KeymapBackup).
export function encodeHidUsage(page: number, usage: number, modifiers = 0): number {
  return (((modifiers & 0xff) * 0x1000000) + ((page & 0xff) << 16) + (usage & 0xffff)) >>> 0;
}

// Replace only the modifier byte of an already-encoded HID usage value.
export function withModifiers(value: number, modifiers: number): number {
  return (((modifiers & 0xff) * 0x1000000) + (value & 0xffffff)) >>> 0;
}

export function ModifierToggles({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (mask: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="modifier-toggles" role="group" aria-label="Modifiers">
      {HID_MODIFIERS.map((item) => {
        const active = (value & (1 << item.bit)) !== 0;
        return (
          <button
            type="button"
            key={item.bit}
            className={active ? 'active' : ''}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(active ? value & ~(1 << item.bit) : value | (1 << item.bit))}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
