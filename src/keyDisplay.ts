export type KeyDisplay = {
  primary: string;
  secondary: string;
};

const SIMPLE: Record<string, KeyDisplay> = {
  Escape: { primary: 'Esc', secondary: '' },
  Backspace: { primary: 'Bksp', secondary: '' },
  Tab: { primary: 'Tab', secondary: '' },
  Space: { primary: 'Space', secondary: '' },
  Enter: { primary: 'Enter', secondary: '' },
  CapsLock: { primary: 'Caps', secondary: '' },
  PrintScreen: { primary: 'PrtSc', secondary: '' },
  ScrollLock: { primary: 'ScrLk', secondary: '' },
  Insert: { primary: 'Ins', secondary: '' },
  Delete: { primary: 'Del', secondary: '' },
  PageUp: { primary: 'PgUp', secondary: '' },
  PageDown: { primary: 'PgDn', secondary: '' },
  Home: { primary: 'Home', secondary: '' },
  End: { primary: 'End', secondary: '' },
  Left: { primary: '←', secondary: '' },
  Right: { primary: '→', secondary: '' },
  Up: { primary: '↑', secondary: '' },
  Down: { primary: '↓', secondary: '' },

  LShift: { primary: '⇧', secondary: 'L Shift' },
  RShift: { primary: '⇧', secondary: 'R Shift' },
  LCtrl: { primary: 'Ctrl', secondary: 'Left' },
  RCtrl: { primary: 'Ctrl', secondary: 'Right' },
  LAlt: { primary: 'Alt', secondary: 'Left' },
  RAlt: { primary: 'Alt', secondary: 'Right' },
  LGui: { primary: '⊞', secondary: 'Left GUI' },
  RGui: { primary: '⊞', secondary: 'Right GUI' },

  Minus: { primary: '-  _', secondary: '' },
  Equal: { primary: '=  +', secondary: '' },
  LeftBracket: { primary: '[  {', secondary: '' },
  RightBracket: { primary: ']  }', secondary: '' },
  Backslash: { primary: '\\  |', secondary: '' },
  Semicolon: { primary: ';  :', secondary: '' },
  Quote: { primary: "'  \"", secondary: '' },
  Grave: { primary: '`  ~', secondary: '' },
  Comma: { primary: ',  <', secondary: '' },
  Dot: { primary: '.  >', secondary: '' },
  Slash: { primary: '/  ?', secondary: '' },

  KpSlash: { primary: 'KP/', secondary: '' },
  KpAsterisk: { primary: 'KP*', secondary: '' },
  KpMinus: { primary: 'KP-', secondary: '' },
  KpPlus: { primary: 'KP+', secondary: '' },
  KpEnter: { primary: 'KP Enter', secondary: '' },
  KpDot: { primary: 'KP.', secondary: '' },
  KpEqual: { primary: 'KP=', secondary: '' },

  International1: { primary: 'INT1', secondary: '' },
  International3: { primary: '¥', secondary: 'INT3' },
  Language1: { primary: 'かな', secondary: 'Lang1' },
  Language2: { primary: '英数', secondary: 'Lang2' },

  MouseBtn1: { primary: 'LCLK', secondary: 'Mouse' },
  MouseBtn2: { primary: 'RCLK', secondary: 'Mouse' },
  MouseBtn3: { primary: 'MCLK', secondary: 'Mouse' },
  MouseBtn4: { primary: 'BTN4', secondary: 'Mouse' },
  MouseBtn5: { primary: 'BTN5', secondary: 'Mouse' },
};

const US_NUMBER_LEGENDS: Record<string, string> = {
  Kc1: '1 !',
  Kc2: '2 @',
  Kc3: '3 #',
  Kc4: '4 $',
  Kc5: '5 %',
  Kc6: '6 ^',
  Kc7: '7 &',
  Kc8: '8 *',
  Kc9: '9 (',
  Kc0: '0 )',
};

export function friendlyKeyDisplay(name: string): KeyDisplay {
  if (SIMPLE[name]) return SIMPLE[name];
  if (US_NUMBER_LEGENDS[name]) return { primary: US_NUMBER_LEGENDS[name], secondary: '' };
  if (/^Kp[0-9]$/.test(name)) return { primary: name.replace('Kp', 'KP'), secondary: '' };
  if (/^F([1-9]|1[0-2])$/.test(name)) return { primary: name, secondary: '' };
  if (/^[A-Z]$/.test(name)) return { primary: name, secondary: '' };
  return { primary: name, secondary: '' };
}

export function friendlyModifierName(name: string) {
  const display = friendlyKeyDisplay(name);
  if (name === 'LShift' || name === 'RShift') return 'Shift';
  if (name === 'LCtrl' || name === 'RCtrl') return 'Ctrl';
  if (name === 'LAlt' || name === 'RAlt') return 'Alt';
  if (name === 'LGui' || name === 'RGui') return 'GUI';
  return display.primary;
}


const NORMALIZED_ALIASES: Record<string, string> = {
  Esc: 'Escape',
  'Caps Lock': 'CapsLock',
  'Print Screen': 'PrintScreen',
  'Scroll Lock': 'ScrollLock',
  'Page Up': 'PageUp',
  'Page Down': 'PageDown',
  'KP /': 'KpSlash',
  'KP *': 'KpAsterisk',
  'KP -': 'KpMinus',
  'KP +': 'KpPlus',
  'KP Enter': 'KpEnter',
  'KP .': 'KpDot',
  LGUI: 'LGui',
  RGUI: 'RGui',
};

for (let i = 0; i <= 9; i += 1) NORMALIZED_ALIASES[String(i)] = `Kc${i}`;
for (let i = 0; i <= 9; i += 1) NORMALIZED_ALIASES[`KP ${i}`] = `Kp${i}`;

export function friendlyDecodedHidDisplay(text: string): KeyDisplay {
  const parts = text.split('+').map((item) => item.trim()).filter(Boolean);
  if (parts.length <= 1) {
    const raw = parts[0] ?? text;
    return friendlyKeyDisplay(NORMALIZED_ALIASES[raw] ?? raw);
  }

  const rawKey = parts[parts.length - 1];
  const key = friendlyKeyDisplay(NORMALIZED_ALIASES[rawKey] ?? rawKey);
  const mods = parts.slice(0, -1).map((mod) =>
    friendlyModifierName(NORMALIZED_ALIASES[mod] ?? mod)
  );
  return { primary: key.primary, secondary: mods.join('+') };
}
