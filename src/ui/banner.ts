/**
 * NeuroBase Banner & Branding
 * ASCII art header with gradient coloring
 */

import gradient from 'gradient-string';
import { colors, termWidth, box } from './theme';

// Custom gradient: violet → cyan
const neuroGradient = gradient(['#7C3AED', '#06B6D4', '#10B981']);

const BANNER_ART = `
 ███╗   ██╗███████╗██╗   ██╗██████╗  ██████╗ ██████╗  █████╗ ███████╗███████╗
 ████╗  ██║██╔════╝██║   ██║██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔════╝
 ██╔██╗ ██║█████╗  ██║   ██║██████╔╝██║   ██║██████╔╝███████║███████╗█████╗
 ██║╚██╗██║██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══██╗██╔══██║╚════██║██╔══╝
 ██║ ╚████║███████╗╚██████╔╝██║  ██║╚██████╔╝██████╔╝██║  ██║███████║███████╗
 ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝`;

const BANNER_COMPACT = `
 ╔╗╔┌─┐┬ ┬┬─┐┌─┐┌┐ ┌─┐┌─┐┌─┐
 ║║║├┤ │ │├┬┘│ │├┴┐├─┤└─┐├┤
 ╝╚╝└─┘└─┘┴└─└─┘└─┘┴ ┴└─┘└─┘`;

const BANNER_MINI = ' ⟐ NeuroBase';

/**
 * Show the startup banner
 */
export function showBanner(version: string = '3.0.0'): void {
  const width = termWidth();

  if (width >= 85) {
    console.log(neuroGradient.multiline(BANNER_ART));
  } else if (width >= 40) {
    console.log(neuroGradient.multiline(BANNER_COMPACT));
  } else {
    console.log(neuroGradient(BANNER_MINI));
  }

  const tagline = 'Intelligent conversational database engine';
  const versionStr = `v${version}`;

  console.log();
  console.log(
    '  ' + colors.dim(tagline) +
    '  ' + colors.primary(versionStr)
  );
  console.log();
}

/**
 * Show connection info in a styled box
 */
export function showConnectionInfo(params: {
  provider: string;
  model?: string;
  database: string;
  engine: string;
  mode: string;
  features: string[];
}): void {
  const width = Math.min(termWidth() - 4, 70);
  const topBorder = colors.border(box.topLeft + box.horizontal.repeat(width - 2) + box.topRight);
  const bottomBorder = colors.border(box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight);

  const pad = (text: string, len: number) => {
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    const padLen = Math.max(0, len - stripped.length);
    return text + ' '.repeat(padLen);
  };

  const line = (left: string, right: string) => {
    const innerWidth = width - 4;
    const leftStr = pad(left, 18);
    const rightStr = right;
    const stripped = (leftStr + rightStr).replace(/\x1b\[[0-9;]*m/g, '');
    const padRight = Math.max(0, innerWidth - stripped.length);
    return colors.border(box.vertical) + ' ' + leftStr + rightStr + ' '.repeat(padRight) + ' ' + colors.border(box.vertical);
  };

  const midBorder = colors.border(box.teeRight + box.hDash.repeat(width - 2) + box.teeLeft);

  console.log(topBorder);
  console.log(line(colors.muted('LLM Provider'), colors.highlight(params.provider + (params.model ? ` (${params.model})` : ''))));
  console.log(line(colors.muted('Database'), colors.secondary(params.database)));
  console.log(line(colors.muted('Engine'), colors.text(params.engine)));
  console.log(line(colors.muted('Mode'), colors.text(params.mode)));
  console.log(midBorder);
  console.log(line(colors.muted('Features'), colors.success(params.features.join(', '))));
  console.log(bottomBorder);
  console.log();
}

/**
 * Show a quick help reference
 */
export function showQuickHelp(): void {
  const entries = [
    [colors.accent('.help'), 'Show all commands'],
    [colors.accent('.schema'), 'Display database schema'],
    [colors.accent('.stats'), 'Show statistics'],
    [colors.accent('.exit'), 'Quit NeuroBase'],
  ];

  const parts = entries.map(([cmd, desc]) => `${cmd} ${colors.dim(desc)}`);
  console.log('  ' + parts.join('   '));
  console.log();
}
