import { makeHidKeyAction, makeHidKeyWithModifierAction } from './rmkRynkWasm';

export type RmkJpKeyChoice = {
  id: string;
  label: string;
  description: string;
  action: () => any;
};

const shifted = (name: string) => makeHidKeyWithModifierAction(name, { left_shift: true });

export const RMK_JPKEYS_ABI = 1;

export const RMK_JPKEYS: readonly RmkJpKeyChoice[] = [
  { id: 'JP_MINUSUNDER', label: '- / _', description: 'JP_MINUSUNDER', action: () => makeHidKeyAction('F13') },
  { id: 'JP_EQUALPLUS', label: '= / +', description: 'JP_EQUALPLUS', action: () => makeHidKeyAction('F14') },
  { id: 'JP_SEMICOLONCOLON', label: '; / :', description: 'JP_SEMICOLONCOLON', action: () => makeHidKeyAction('F15') },
  { id: 'JP_QUOTEDQUOTE', label: "' / \"", description: 'JP_QUOTEDQUOTE', action: () => makeHidKeyAction('F16') },
  { id: 'JP_YENPIPE', label: '¥ / |', description: 'JP_YENPIPE', action: () => makeHidKeyAction('F17') },
  { id: 'JP_BAQTTILDE', label: '` / ~', description: 'JP_BAQTTILDE', action: () => makeHidKeyAction('F18') },
  { id: 'JP_LBRACELBRACKET', label: '{ / [', description: 'JP_LBRACELBRACKET', action: () => makeHidKeyAction('F19') },
  { id: 'JP_RBRACERBRACKET', label: '} / ]', description: 'JP_RBRACERBRACKET', action: () => makeHidKeyAction('F20') },

  { id: 'JP_AT', label: '@', description: 'JP_AT', action: () => makeHidKeyAction('LeftBracket') },
  { id: 'JP_CARET', label: '^', description: 'JP_CARET', action: () => makeHidKeyAction('Equal') },
  { id: 'JP_AMP', label: '&', description: 'JP_AMP', action: () => shifted('Kc6') },
  { id: 'JP_ASTER', label: '*', description: 'JP_ASTER', action: () => shifted('Quote') },
  { id: 'JP_BAQT', label: '`', description: 'JP_BAQT', action: () => shifted('LeftBracket') },
  { id: 'JP_TILDE', label: '~', description: 'JP_TILDE', action: () => shifted('Equal') },
  { id: 'JP_QUOTE', label: "'", description: 'JP_QUOTE', action: () => shifted('Kc7') },
  { id: 'JP_DQUOTE', label: '"', description: 'JP_DQUOTE', action: () => shifted('Kc2') },
  { id: 'JP_EQUAL', label: '=', description: 'JP_EQUAL', action: () => shifted('Minus') },
  { id: 'JP_PLUS', label: '+', description: 'JP_PLUS', action: () => shifted('Semicolon') },
  { id: 'JP_COLON', label: ':', description: 'JP_COLON', action: () => makeHidKeyAction('Quote') },
  { id: 'JP_YEN', label: '¥', description: 'JP_YEN', action: () => makeHidKeyAction('International3') },
  { id: 'JP_PIPE', label: '|', description: 'JP_PIPE', action: () => shifted('International3') },
  { id: 'JP_UNDER', label: '_', description: 'JP_UNDER', action: () => shifted('International1') },
  { id: 'JP_LBRACE', label: '{', description: 'JP_LBRACE', action: () => makeHidKeyAction('RightBracket') },
  { id: 'JP_LBRACKET', label: '[', description: 'JP_LBRACKET', action: () => shifted('RightBracket') },
  { id: 'JP_RBRACE', label: '}', description: 'JP_RBRACE', action: () => makeHidKeyAction('Backslash') },
  { id: 'JP_RBRACKET', label: ']', description: 'JP_RBRACKET', action: () => shifted('Backslash') },
  { id: 'JP_LPAREN', label: '(', description: 'JP_LPAREN', action: () => shifted('Kc8') },
  { id: 'JP_RPAREN', label: ')', description: 'JP_RPAREN', action: () => shifted('Kc9') },
  { id: 'JP_KANA', label: 'かな', description: 'JP_KANA', action: () => makeHidKeyAction('Language1') },
  { id: 'JP_EISU', label: '英数', description: 'JP_EISU', action: () => makeHidKeyAction('Language2') },
  { id: 'JP_HANZEN', label: '半角/全角', description: 'JP_HANZEN', action: () => makeHidKeyAction('Grave') },
];

const ABI_TRIGGER_LABELS: Record<string, string> = {
  F13: 'JP_MINUSUNDER',
  F14: 'JP_EQUALPLUS',
  F15: 'JP_SEMICOLONCOLON',
  F16: 'JP_QUOTEDQUOTE',
  F17: 'JP_YENPIPE',
  F18: 'JP_BAQTTILDE',
  F19: 'JP_LBRACELBRACKET',
  F20: 'JP_RBRACERBRACKET',
};

export function rmkJpDisplayLabel(action: any): string | null {
  const key = action?.Single?.Key?.Hid;
  return typeof key === 'string' ? ABI_TRIGGER_LABELS[key] ?? null : null;
}
