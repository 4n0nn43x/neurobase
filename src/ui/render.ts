/**
 * NeuroBase Rich Output Renderer
 * Beautiful rendering for SQL, tables, results, and status messages
 */

import chalk from 'chalk';
import { highlight } from 'cli-highlight';
import Table from 'cli-table3';
import { colors, box, icons, termWidth, labeledSeparator } from './theme';

/**
 * Render SQL with syntax highlighting in a bordered panel
 */
export function renderSQL(sql: string, label: string = 'SQL'): void {
  const width = Math.min(termWidth() - 2, 100);

  const highlighted = highlight(sql.trim(), {
    language: 'sql',
    theme: {
      keyword: chalk.hex('#C084FC'),       // violet-400
      built_in: chalk.hex('#38BDF8'),      // sky-400
      string: chalk.hex('#34D399'),        // emerald-400
      number: chalk.hex('#FBBF24'),        // amber-400
      literal: chalk.hex('#FB923C'),       // orange-400
      comment: chalk.hex('#6B7280').italic, // gray-500
      default: chalk.hex('#E5E7EB'),       // gray-200
    },
  });

  const titleStr = ` ${icons.sql} ${colors.dim(label)} `;
  const titleLen = label.length + 5;
  const topPad = Math.max(0, width - titleLen - 4);
  const top = colors.border(box.topLeft + box.horizontal.repeat(2)) + titleStr + colors.border(box.horizontal.repeat(topPad) + box.topRight);
  const bottom = colors.border(box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight);

  console.log(top);
  for (const line of highlighted.split('\n')) {
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
    const padLen = Math.max(0, width - stripped.length - 4);
    console.log(colors.border(box.vertical) + ' ' + line + ' '.repeat(padLen) + ' ' + colors.border(box.vertical));
  }
  console.log(bottom);
}

/**
 * Render query results as a beautiful table
 */
export function renderResultTable(rows: any[], maxRows: number = 30): void {
  if (!rows || rows.length === 0) {
    console.log(colors.dim('  (no results)'));
    return;
  }

  const columns = Object.keys(rows[0]);
  const displayRows = rows.slice(0, maxRows);
  const width = termWidth();

  // Calculate column widths
  const maxColWidth = Math.floor((width - columns.length * 3 - 4) / columns.length);
  const colWidths = columns.map(col => {
    const maxVal = Math.max(
      col.length,
      ...displayRows.map(r => String(r[col] ?? '').length)
    );
    return Math.min(maxVal + 2, Math.max(maxColWidth, 8));
  });

  const table = new Table({
    head: columns.map(c => colors.secondary.bold(c)),
    colWidths: colWidths,
    style: {
      head: [],
      border: [],
      'padding-left': 1,
      'padding-right': 1,
    },
    chars: {
      top: colors.border('─'),
      'top-mid': colors.border('┬'),
      'top-left': colors.border('┌'),
      'top-right': colors.border('┐'),
      bottom: colors.border('─'),
      'bottom-mid': colors.border('┴'),
      'bottom-left': colors.border('└'),
      'bottom-right': colors.border('┘'),
      left: colors.border('│'),
      'left-mid': colors.border('├'),
      mid: colors.border('─'),
      'mid-mid': colors.border('┼'),
      right: colors.border('│'),
      'right-mid': colors.border('┤'),
      middle: colors.border('│'),
    },
  });

  for (const row of displayRows) {
    table.push(
      columns.map(col => {
        const val = row[col];
        if (val === null || val === undefined) return colors.dim('NULL');
        if (typeof val === 'number') return colors.accent(String(val));
        if (typeof val === 'boolean') return val ? colors.success('true') : colors.error('false');
        if (val instanceof Date) return colors.muted(val.toISOString());
        const str = String(val);
        return str.length > maxColWidth - 2
          ? colors.text(str.substring(0, maxColWidth - 5) + '...')
          : colors.text(str);
      })
    );
  }

  console.log(table.toString());

  if (rows.length > maxRows) {
    console.log(colors.dim(`  ... and ${rows.length - maxRows} more rows`));
  }
}

/**
 * Render result metadata (execution time, row count, etc.)
 */
export function renderResultMeta(params: {
  rowCount: number;
  executionTime: number;
  learned?: boolean;
  corrected?: boolean;
  explanation?: string;
}): void {
  const parts: string[] = [];

  parts.push(`${icons.rows} ${colors.text(String(params.rowCount))} row${params.rowCount !== 1 ? 's' : ''}`);
  parts.push(`${icons.time} ${formatTime(params.executionTime)}`);

  if (params.learned) parts.push(`${icons.learned} ${colors.dim('learned')}`);
  if (params.corrected) parts.push(`${icons.corrected} ${colors.warning('auto-corrected')}`);

  console.log('  ' + parts.join('  ' + colors.border('│') + '  '));

  if (params.explanation) {
    console.log('  ' + colors.dim(params.explanation));
  }
}

/**
 * Render an error message
 */
export function renderError(message: string, details?: string): void {
  console.log();
  console.log(`  ${icons.error} ${colors.error.bold('Error')} ${colors.text(message)}`);
  if (details) {
    console.log(`  ${colors.dim(details)}`);
  }
  console.log();
}

/**
 * Render a success message
 */
export function renderSuccess(message: string): void {
  console.log(`  ${icons.success} ${colors.success(message)}`);
}

/**
 * Render an info message
 */
export function renderInfo(message: string): void {
  console.log(`  ${icons.info} ${colors.info(message)}`);
}

/**
 * Render a warning message
 */
export function renderWarning(message: string): void {
  console.log(`  ${icons.warning} ${colors.warning(message)}`);
}

/**
 * Render conversational response in a styled way
 */
export function renderConversation(response: string): void {
  console.log();
  console.log('  ' + colors.text(response));
  console.log();
}

/**
 * Render clarification question with options
 */
export function renderClarification(
  question: string,
  options?: Array<{ description: string; sql?: string }>
): void {
  console.log();
  console.log(`  ${icons.thinking} ${colors.highlight(question)}`);

  if (options && options.length > 0) {
    console.log();
    options.forEach((opt, i) => {
      console.log(`  ${colors.accent(`${i + 1}.`)} ${colors.text(opt.description)}`);
      if (opt.sql) {
        console.log(`     ${colors.dim(opt.sql.substring(0, 80))}`);
      }
    });
  }
  console.log();
}

/**
 * Render schema overview
 */
export function renderSchemaOverview(schema: {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; nullable: boolean }>;
    foreignKeys: Array<{ column: string; referencedTable: string; referencedColumn: string }>;
    rowCount?: number;
  }>;
}): void {
  console.log();
  console.log(labeledSeparator('Database Schema'));
  console.log();

  for (const table of schema.tables) {
    const rowStr = table.rowCount ? colors.dim(` (${table.rowCount.toLocaleString()} rows)`) : '';
    console.log(`  ${icons.db} ${colors.secondary.bold(table.name)}${rowStr}`);

    for (const col of table.columns) {
      const nullable = col.nullable ? colors.dim(' ?') : '';
      console.log(`     ${colors.dim(box.teeRight + box.horizontal)} ${colors.text(col.name)} ${colors.muted(col.type)}${nullable}`);
    }

    for (const fk of table.foreignKeys) {
      console.log(`     ${colors.dim(box.bottomLeft + box.horizontal)} ${colors.accent(fk.column)} ${colors.dim(box.arrowRight)} ${colors.highlight(fk.referencedTable)}.${fk.referencedColumn}`);
    }
    console.log();
  }
}

/**
 * Render database stats
 */
export function renderStats(stats: {
  database: any;
  schema: { tables: number; views: number; functions: number };
}): void {
  console.log();
  console.log(labeledSeparator('Statistics'));
  console.log();

  const entries = [
    ['Tables', String(stats.schema.tables)],
    ['Views', String(stats.schema.views)],
    ['Functions', String(stats.schema.functions)],
  ];

  if (stats.database) {
    if (stats.database.size) entries.push(['DB Size', stats.database.size]);
    if (stats.database.connections) entries.push(['Connections', String(stats.database.connections)]);
  }

  for (const [label, value] of entries) {
    console.log(`  ${colors.muted(label.padEnd(15))} ${colors.text(value)}`);
  }
  console.log();
}

/**
 * Render the help screen
 */
export function renderHelp(): void {
  console.log();
  console.log(labeledSeparator('Commands'));
  console.log();

  const commands = [
    ['.help', 'Show this help screen'],
    ['.schema', 'Display database schema with relationships'],
    ['.stats', 'Show database statistics'],
    ['.clear', 'Clear screen and history'],
    ['.fork', 'Create a database fork (sandbox)'],
    ['.forks', 'List active forks'],
    ['.fork-delete <id>', 'Delete a fork'],
    ['.exit', 'Quit NeuroBase'],
  ];

  for (const [cmd, desc] of commands) {
    console.log(`  ${colors.accent(cmd.padEnd(22))} ${colors.dim(desc)}`);
  }

  console.log();
  console.log(labeledSeparator('Tips'));
  console.log();
  console.log(`  ${colors.dim('Ask in natural language:')} ${colors.text('"show me the top 10 customers by revenue"')}`);
  console.log(`  ${colors.dim('Works in French too:')}     ${colors.text('"combien de commandes cette semaine ?"')}`);
  console.log(`  ${colors.dim('Follow-up questions:')}     ${colors.text('"and sort by date"')} ${colors.dim('(context is preserved)')}`);
  console.log();
}

function formatTime(ms: number): string {
  if (ms < 1) return colors.success('<1ms');
  if (ms < 100) return colors.success(`${Math.round(ms)}ms`);
  if (ms < 1000) return colors.text(`${Math.round(ms)}ms`);
  if (ms < 5000) return colors.accent(`${(ms / 1000).toFixed(1)}s`);
  return colors.warning(`${(ms / 1000).toFixed(1)}s`);
}
