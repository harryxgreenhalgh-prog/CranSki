// Display names for keys and controller buttons (Settings and the tutorial).

// Standard Gamepad button names (Xbox labels).
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L-stick', 'R-stick', 'D-up', 'D-down', 'D-left', 'D-right', 'Home'];

const NICE = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt', Escape: 'Esc', Space: 'Space', Enter: 'Enter' };

// A KeyboardEvent.code as printed on the key.
export function keyName(code) {
  if (!code) return '—';
  return NICE[code] || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}
