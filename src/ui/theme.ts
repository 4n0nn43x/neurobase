/**
 * NeuroBase Terminal Theme
 * Centralized color palette and styling constants
 */

import chalk from 'chalk';

// Color palette
export const colors = {
  primary: chalk.hex('#7C3AED'),      // violet
  secondary: chalk.hex('#06B6D4'),    // cyan
  accent: chalk.hex('#F59E0B'),       // amber
  success: chalk.hex('#10B981'),      // emerald
  error: chalk.hex('#EF4444'),        // red
  warning: chalk.hex('#F59E0B'),      // amber
  info: chalk.hex('#3B82F6'),         // blue
  muted: chalk.hex('#6B7280'),        // gray-500
  dim: chalk.hex('#9CA3AF'),          // gray-400
  text: chalk.hex('#E5E7EB'),         // gray-200
  highlight: chalk.hex('#A78BFA'),    // violet-400
  sql: chalk.hex('#38BDF8'),          // sky-400
  border: chalk.hex('#4B5563'),       // gray-600
};

// Unicode box-drawing characters
export const box = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
  teeDown: '┬',
  teeUp: '┴',
  cross: '┼',
  // Heavy
  hHeavy: '━',
  vHeavy: '┃',
  // Dashes
  hDash: '╌',
  // Arrows
  arrowRight: '→',
  arrowDown: '↓',
  bullet: '●',
  smallBullet: '•',
  check: '✓',
  cross_mark: '✗',
  star: '★',
  diamond: '◆',
  triangle: '▸',
  // Blocks
  fullBlock: '█',
  lightBlock: '░',
  mediumBlock: '▒',
};

// Spinner frames
export const spinnerFrames = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  thinking: ['◐', '◓', '◑', '◒'],
  pulse: ['◉', '◎', '◉', '◎', '●', '○'],
  braille: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  neural: ['🧠', '💭', '⚡', '🔮'],
};

// Status icons
export const icons = {
  success: colors.success('✓'),
  error: colors.error('✗'),
  warning: colors.warning('⚠'),
  info: colors.info('ℹ'),
  query: colors.sql('⟐'),
  thinking: colors.highlight('◉'),
  sql: colors.sql('⟩'),
  result: colors.secondary('◈'),
  time: colors.muted('⏱'),
  rows: colors.muted('⊞'),
  learned: colors.success('◉'),
  corrected: colors.warning('⟳'),
  db: colors.primary('⛁'),
  separator: colors.border('─'),
};

/**
 * Get terminal width, clamped to reasonable bounds
 */
export function termWidth(): number {
  return Math.min(process.stdout.columns || 80, 120);
}

/**
 * Create a horizontal separator line
 */
export function separator(char?: string, width?: number): string {
  const w = width || termWidth();
  const c = char || box.horizontal;
  return colors.border(c.repeat(w));
}

/**
 * Create a labeled separator
 */
export function labeledSeparator(label: string, width?: number): string {
  const w = width || termWidth();
  const labelLen = label.length + 2; // space on each side
  const remaining = w - labelLen - 4; // 2 for edges
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return colors.border(
    box.horizontal.repeat(left) + ' '
  ) + colors.dim(label) + colors.border(
    ' ' + box.horizontal.repeat(right)
  );
}
