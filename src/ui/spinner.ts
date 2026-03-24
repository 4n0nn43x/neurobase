/**
 * NeuroBase Rich Spinner
 * Animated thinking indicator with status updates
 */

import logUpdate from 'log-update';
import { colors, spinnerFrames } from './theme';

export class NeuroSpinner {
  private frameIndex = 0;
  private timer: NodeJS.Timeout | null = null;
  private text: string;
  private subText: string = '';
  private frames: string[];
  private startTime: number = 0;

  constructor(text: string = 'Thinking', frames?: string[]) {
    this.text = text;
    this.frames = frames || spinnerFrames.dots;
  }

  start(): this {
    this.startTime = Date.now();
    this.frameIndex = 0;

    this.timer = setInterval(() => {
      const frame = this.frames[this.frameIndex % this.frames.length];
      this.frameIndex++;

      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      const elapsedStr = colors.dim(`${elapsed}s`);

      let output = `  ${colors.highlight(frame)} ${colors.text(this.text)}  ${elapsedStr}`;
      if (this.subText) {
        output += `\n  ${colors.dim('  ' + this.subText)}`;
      }

      logUpdate(output);
    }, 80);

    return this;
  }

  update(text: string, subText?: string): this {
    this.text = text;
    if (subText !== undefined) this.subText = subText;
    return this;
  }

  succeed(text?: string): void {
    this.stop();
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    logUpdate(`  ${colors.success('✓')} ${colors.text(text || this.text)}  ${colors.dim(elapsed + 's')}`);
    logUpdate.done();
  }

  fail(text?: string): void {
    this.stop();
    logUpdate(`  ${colors.error('✗')} ${colors.error(text || this.text)}`);
    logUpdate.done();
  }

  warn(text?: string): void {
    this.stop();
    logUpdate(`  ${colors.warning('⚠')} ${colors.warning(text || this.text)}`);
    logUpdate.done();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  clear(): void {
    this.stop();
    logUpdate.clear();
  }
}

/**
 * Show a step-by-step pipeline visualization
 */
export function renderPipeline(steps: Array<{
  name: string;
  status: 'pending' | 'active' | 'done' | 'error' | 'skipped';
}>): void {
  const statusIcons = {
    pending: colors.dim('○'),
    active: colors.highlight('◉'),
    done: colors.success('●'),
    error: colors.error('●'),
    skipped: colors.dim('◌'),
  };

  const statusColors = {
    pending: colors.dim,
    active: colors.highlight,
    done: colors.success,
    error: colors.error,
    skipped: colors.dim,
  };

  const parts = steps.map((step, i) => {
    const icon = statusIcons[step.status];
    const colorFn = statusColors[step.status];
    const connector = i < steps.length - 1 ? colors.dim(' → ') : '';
    return `${icon} ${colorFn(step.name)}${connector}`;
  });

  logUpdate('  ' + parts.join(''));
}
