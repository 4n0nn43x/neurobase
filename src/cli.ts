#!/usr/bin/env node

/**
 * NeuroBase Interactive CLI
 * Rich terminal interface with syntax highlighting, gradient branding, and interactive prompts
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { NeuroBase } from './core/neurobase';
import { config } from './config';
import { AdapterFactory } from './database/adapter-factory';
import { DatabaseForkManager } from './database/fork';
import {
  showBanner,
  showConnectionInfo,
  showQuickHelp,
  renderSQL,
  renderResultTable,
  renderResultMeta,
  renderError,
  renderSuccess,
  renderInfo,
  renderConversation,
  renderClarification,
  renderSchemaOverview,
  renderStats,
  renderHelp,
  colors,
  separator,
  NeuroSpinner,
} from './ui';
import { runSetupWizard } from './ui/setup-wizard';

const program = new Command();

program
  .name('neurobase')
  .description('Intelligent, self-learning conversational database')
  .version('3.0.0');

program
  .command('interactive')
  .alias('i')
  .description('Start interactive query session')
  .action(async () => {
    await runInteractiveMode();
  });

program
  .command('query <text>')
  .alias('q')
  .description('Run a single query')
  .option('--sql', 'Show generated SQL')
  .option('--explain', 'Show explanation')
  .action(async (text: string, options: { sql?: boolean; explain?: boolean }) => {
    await runSingleQuery(text, options);
  });

program
  .command('setup')
  .description('Interactive setup wizard — configure database and LLM')
  .action(async () => {
    await runSetupWizard();
  });

program
  .command('init')
  .description('Initialize NeuroBase database tables')
  .action(async () => {
    await initializeDatabase();
  });

program
  .command('stats')
  .description('Show database statistics')
  .action(async () => {
    await showStatsCommand();
  });

program
  .command('serve')
  .description('Start the REST API server')
  .action(async () => {
    // Delegate to the API module
    await import('./api');
  });

program.parse();

// Conversation context
const conversationHistory: Array<{ query: string; sql?: string; timestamp: Date }> = [];

// History persistence
const HISTORY_FILE = path.join(process.cwd(), '.neurobase', 'history.txt');
const HISTORY_DIR = path.dirname(HISTORY_FILE);

function loadHistory(): string[] {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    if (fs.existsSync(HISTORY_FILE)) {
      return fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(line => line.trim());
    }
  } catch { /* ignore */ }
  return [];
}

function saveToHistory(command: string): void {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    let history: string[] = [];
    if (fs.existsSync(HISTORY_FILE)) {
      history = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(line => line.trim());
    }
    history = history.filter(cmd => cmd !== command);
    history.push(command);
    if (history.length > 100) history = history.slice(-100);
    fs.writeFileSync(HISTORY_FILE, history.join('\n') + '\n', 'utf-8');
  } catch { /* ignore */ }
}

class HistoryPrompt {
  private history: string[];
  constructor() { this.history = loadHistory(); }

  async prompt(): Promise<string> {
    return new Promise((resolve, reject) => {
      const rl = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
        historySize: 100,
      });
      (rl as any).history = [...this.history].reverse();
      rl.question(
        colors.primary('  ') + colors.highlight('neurobase') + colors.dim(' > '),
        (answer: string) => { rl.close(); resolve(answer); }
      );
      rl.on('error', reject);
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Interactive Mode
// ─────────────────────────────────────────────────────────────

async function runInteractiveMode(): Promise<void> {
  process.env.NEUROBASE_QUIET = 'true';

  // Check if .env exists, offer setup if not
  if (!fs.existsSync(path.join(process.cwd(), '.env'))) {
    console.log();
    renderInfo('No .env file found. Running setup wizard...');
    console.log();
    await runSetupWizard();
    return;
  }

  showBanner('3.0.0');

  const spinner = new NeuroSpinner('Connecting to database').start();

  try {
    const nb = new NeuroBase(config);
    spinner.update('Initializing schema');
    await nb.initialize();

    spinner.succeed('Connected');

    // Show connection panel
    const features: string[] = [];
    if (config.features.enableLearning) features.push('learning');
    if (config.features.enableOptimization) features.push('optimization');
    if (config.features.enableSelfCorrection) features.push('self-correction');
    if (config.features.enableMultiCandidate) features.push('multi-candidate');

    showConnectionInfo({
      provider: config.llm.provider,
      model: config.llm.anthropic?.model || config.llm.openai?.model || config.llm.ollama?.model,
      database: config.database.connectionString.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'),
      engine: config.database.engine,
      mode: config.neurobase.mode,
      features,
    });

    showQuickHelp();
    console.log(separator());
    console.log();

    const historyPrompt = new HistoryPrompt();
    let running = true;

    while (running) {
      const query = await historyPrompt.prompt();
      const trimmed = query.trim();
      if (!trimmed) continue;

      switch (trimmed) {
        case '.exit':
          console.log();
          renderSuccess('Goodbye!');
          console.log();
          await nb.close();
          running = false;
          continue;

        case '.help':
          renderHelp();
          continue;

        case '.schema':
          await showSchemaCommand(nb);
          continue;

        case '.stats':
          await displayStatsCommand(nb);
          continue;

        case '.clear':
          console.clear();
          conversationHistory.length = 0;
          try { if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE); } catch { /* ignore */ }
          showBanner('3.0.0');
          renderInfo('Screen and history cleared');
          console.log();
          continue;

        case '.fork':
          await createFork();
          continue;

        case '.forks':
          await listForks();
          continue;

        default:
          if (trimmed.startsWith('.fork-delete ')) {
            const forkId = trimmed.split(' ')[1];
            if (forkId) await deleteFork(forkId);
            else renderError('Usage: .fork-delete <fork-id>');
            continue;
          }
      }

      saveToHistory(trimmed);
      await executeQuery(nb, trimmed, conversationHistory);
    }
  } catch (error) {
    spinner.fail('Failed to initialize');
    renderError(
      error instanceof Error ? error.message : String(error),
      'Check your .env configuration. Run `neurobase setup` to reconfigure.'
    );
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────
// Query Execution
// ─────────────────────────────────────────────────────────────

async function executeQuery(
  nb: NeuroBase,
  query: string,
  history: Array<{ query: string; sql?: string; timestamp: Date }>
): Promise<void> {
  const spinner = new NeuroSpinner('Analyzing query').start();

  try {
    const recentContext = history.slice(-3).map(entry =>
      `User: "${entry.query}"\nSQL: ${entry.sql || 'N/A'}`
    ).join('\n\n');

    const linguisticResult = await (nb as any).linguisticAgent.process({
      query: {
        text: query,
        context: {
          previousQueries: history.map(e => e.query),
          conversationContext: recentContext,
        },
      },
      schema: await (nb as any).schema.getSchema(),
      learningHistory: [],
    });

    // Conversational response
    if (linguisticResult.isConversational && linguisticResult.conversationalResponse) {
      spinner.clear();
      renderConversation(linguisticResult.conversationalResponse);
      history.push({ query, sql: undefined, timestamp: new Date() });
      if (history.length > 10) history.shift();
      return;
    }

    // Clarification needed
    if (linguisticResult.needsClarification && linguisticResult.clarificationQuestion) {
      spinner.clear();
      await handleClarification(nb, query, linguisticResult, history);
      return;
    }

    // Missing columns
    if (linguisticResult.missingData) {
      spinner.clear();
      await handleMissingData(nb, query, linguisticResult, history);
      return;
    }

    // Execute the query
    spinner.update('Generating SQL');
    const result = await nb.query({
      text: query,
      context: {
        previousQueries: history.map(e => e.query),
        conversationContext: recentContext,
      },
    });

    spinner.clear();

    // Display results
    console.log();
    renderSQL(result.sql);
    console.log();
    renderResultTable(result.data);
    console.log();
    renderResultMeta({
      rowCount: result.rowCount,
      executionTime: result.executionTime,
      learned: result.learned,
      corrected: result.corrected,
      explanation: result.explanation,
    });
    console.log();

    // Update history
    history.push({ query, sql: result.sql, timestamp: new Date() });
    if (history.length > 10) history.shift();

  } catch (error) {
    spinner.fail('Query failed');
    renderError(error instanceof Error ? error.message : String(error));
  }
}

// ─────────────────────────────────────────────────────────────
// Clarification & Missing Data Handlers
// ─────────────────────────────────────────────────────────────

async function handleClarification(
  nb: NeuroBase,
  originalQuery: string,
  linguisticResult: any,
  history: Array<{ query: string; sql?: string; timestamp: Date }>
): Promise<void> {
  renderClarification(
    linguisticResult.clarificationQuestion,
    linguisticResult.suggestedInterpretations
  );

  if (linguisticResult.suggestedInterpretations?.length > 0) {
    const choices = linguisticResult.suggestedInterpretations.map((interp: any, i: number) => ({
      name: `${colors.accent(`${i + 1}.`)} ${interp.description}`,
      value: i,
    }));
    choices.push({
      name: colors.dim('   Provide more details...'),
      value: -1,
    });

    const { selectedIndex } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedIndex',
      message: colors.dim('Select interpretation:'),
      choices,
    }]);

    if (selectedIndex === -1) {
      const { additionalContext } = await inquirer.prompt([{
        type: 'input',
        name: 'additionalContext',
        message: colors.dim('Additional details:'),
        validate: (input: string) => input.trim() !== '' || 'Please provide details',
      }]);
      await executeQuery(nb, `${originalQuery}. ${additionalContext}`, history);
      return;
    }

    const selected = linguisticResult.suggestedInterpretations[selectedIndex];
    renderSuccess(`Selected: ${selected.description}`);

    let finalSQL = selected.sql;
    const placeholders = finalSQL.match(/\[(\w+)\]/g);

    if (placeholders?.length > 0) {
      const values = await collectPlaceholders(nb, placeholders, finalSQL);
      for (const [key, val] of Object.entries(values)) {
        const quoted = isNaN(Number(val)) && val !== 'true' && val !== 'false'
          ? `'${val.replace(/'/g, "''")}'` : val;
        finalSQL = finalSQL.replace(new RegExp(`\\[${key}\\]`, 'g'), quoted);
      }

      console.log();
      renderSQL(finalSQL, 'Final SQL');

      const { confirm } = await inquirer.prompt([{
        type: 'confirm', name: 'confirm',
        message: colors.dim('Execute?'), default: true,
      }]);
      if (!confirm) { renderInfo('Cancelled'); return; }
    }

    // Execute
    const execSpinner = new NeuroSpinner('Executing').start();
    const db = (nb as any).db;
    const startTime = Date.now();
    const dbResult = await db.query(finalSQL);
    execSpinner.clear();

    console.log();
    renderResultTable(dbResult.rows);
    console.log();
    renderResultMeta({ rowCount: dbResult.rowCount, executionTime: Date.now() - startTime });
    console.log();

    history.push({ query: originalQuery, sql: finalSQL, timestamp: new Date() });
    if (history.length > 10) history.shift();
  } else {
    const { clarified } = await inquirer.prompt([{
      type: 'input', name: 'clarified',
      message: colors.dim('Rephrase your question:'),
      validate: (input: string) => input.trim() !== '' || 'Required',
    }]);
    await executeQuery(nb, clarified, history);
  }
}

async function handleMissingData(
  nb: NeuroBase,
  query: string,
  linguisticResult: any,
  history: Array<{ query: string; sql?: string; timestamp: Date }>
): Promise<void> {
  const missing = linguisticResult.missingData;
  console.log();
  renderInfo(`Missing required columns for '${missing.table}': ${missing.reason}`);
  console.log();

  const collectedData: Record<string, string> = {};
  for (const col of missing.columns) {
    if (col.possibleValues?.length > 0) {
      const choices = [...col.possibleValues, new inquirer.Separator(), 'Custom value...'];
      const { value } = await inquirer.prompt([{
        type: 'list', name: 'value',
        message: `${colors.dim(col.column)} ${colors.muted(`(${col.type})`)}:`,
        choices,
      }]);
      if (value === 'Custom value...') {
        const { custom } = await inquirer.prompt([{
          type: 'input', name: 'custom',
          message: `Enter ${col.column}:`,
          validate: (i: string) => i.trim() !== '' || 'Required',
        }]);
        collectedData[col.column] = custom;
      } else {
        collectedData[col.column] = value;
      }
    } else {
      const { value } = await inquirer.prompt([{
        type: 'input', name: 'value',
        message: `${colors.dim(col.column)} ${colors.muted(`(${col.type})`)}:`,
        default: col.defaultValue,
        validate: (i: string) => i.trim() !== '' || 'Required',
      }]);
      collectedData[col.column] = value;
    }
  }

  const updatedSQL = buildQueryWithData(linguisticResult.sql, missing.table, collectedData);
  console.log();
  renderSQL(updatedSQL, 'Updated SQL');

  const { confirm } = await inquirer.prompt([{
    type: 'confirm', name: 'confirm',
    message: colors.dim('Execute?'), default: true,
  }]);

  if (!confirm) { renderInfo('Cancelled'); return; }

  const execSpinner = new NeuroSpinner('Executing').start();
  const db = (nb as any).db;
  const startTime = Date.now();
  const dbResult = await db.query(updatedSQL);
  execSpinner.clear();

  console.log();
  renderResultTable(dbResult.rows);
  console.log();
  renderResultMeta({ rowCount: dbResult.rowCount, executionTime: Date.now() - startTime });
  console.log();

  history.push({ query, sql: updatedSQL, timestamp: new Date() });
  if (history.length > 10) history.shift();
}

// ─────────────────────────────────────────────────────────────
// Placeholder Collection (FK-aware)
// ─────────────────────────────────────────────────────────────

async function collectPlaceholders(
  nb: NeuroBase,
  placeholders: string[],
  _sql: string
): Promise<Record<string, string>> {
  const names = Array.from(new Set(placeholders.map(p => p.replace(/[\[\]]/g, ''))));
  const values: Record<string, string> = {};
  const db = (nb as any).db;

  for (const name of names) {
    const fkMatch = name.match(/^(\w+)_id$/);
    if (fkMatch) {
      const refTable = pluralize(fkMatch[1]);
      try {
        const result = await db.query(`SELECT id, name FROM ${refTable} ORDER BY name LIMIT 50`);
        if (result.rows.length > 0) {
          const choices = result.rows.map((r: any) => ({
            name: `${r.name} ${colors.dim(`(ID: ${r.id})`)}`,
            value: r.id.toString(),
            short: r.name,
          }));
          choices.push(new inquirer.Separator());
          choices.push({ name: colors.success(`+ Create new ${fkMatch[1]}`), value: '__NEW__', short: 'New' });
          choices.push({ name: colors.dim('  Enter ID manually'), value: '__CUSTOM__', short: 'Custom' });

          const { sel } = await inquirer.prompt([{
            type: 'list', name: 'sel',
            message: `${colors.dim(name)}:`, choices, pageSize: 15,
          }]);

          if (sel === '__NEW__') {
            values[name] = await createNewRefEntry(db, refTable, fkMatch[1]);
          } else if (sel === '__CUSTOM__') {
            const { id } = await inquirer.prompt([{
              type: 'input', name: 'id', message: `Enter ${name}:`,
              validate: (i: string) => !isNaN(Number(i)) || 'Must be a number',
            }]);
            values[name] = id;
          } else {
            values[name] = sel;
          }
          continue;
        }
      } catch { /* fall through */ }
    }

    const { val } = await inquirer.prompt([{
      type: 'input', name: 'val',
      message: `${colors.dim(name)}:`,
      validate: (i: string) => i.trim() !== '' || 'Required',
    }]);
    values[name] = val;
  }

  return values;
}

async function createNewRefEntry(db: any, table: string, singular: string): Promise<string> {
  const { name } = await inquirer.prompt([{
    type: 'input', name: 'name',
    message: `${singular.charAt(0).toUpperCase() + singular.slice(1)} name:`,
    validate: (i: string) => i.trim() !== '' || 'Required',
  }]);

  // Check for similar entries
  try {
    const similar = await db.query(
      `SELECT id, name FROM ${table} WHERE LOWER(name) LIKE LOWER($1) || '%' LIMIT 5`, [name]
    );
    if (similar.rows.length > 0) {
      const choices = similar.rows.map((r: any) => ({
        name: `Use existing: ${r.name} ${colors.dim(`(ID: ${r.id})`)}`,
        value: r.id.toString(),
      }));
      choices.push(new inquirer.Separator());
      choices.push({ name: colors.success(`Create "${name}" anyway`), value: '__CREATE__' });

      const { choice } = await inquirer.prompt([{
        type: 'list', name: 'choice', message: 'Similar entries found:', choices,
      }]);
      if (choice !== '__CREATE__') return choice;
    }
  } catch { /* no similarity support */ }

  const { desc } = await inquirer.prompt([{
    type: 'input', name: 'desc', message: 'Description (optional):', default: '',
  }]);

  const insertSQL = desc
    ? `INSERT INTO ${table} (name, description) VALUES ($1, $2) RETURNING id`
    : `INSERT INTO ${table} (name) VALUES ($1) RETURNING id`;
  const params = desc ? [name, desc] : [name];
  const result = await db.query(insertSQL, params);
  const newId = result.rows[0].id;

  renderSuccess(`Created ${singular}: ${name} (ID: ${newId})`);
  return newId.toString();
}

// ─────────────────────────────────────────────────────────────
// Schema, Stats, Init Commands
// ─────────────────────────────────────────────────────────────

async function showSchemaCommand(nb: NeuroBase): Promise<void> {
  const spinner = new NeuroSpinner('Loading schema').start();
  try {
    const schema = await nb.getSchemaIntrospector().getSchema();
    spinner.clear();
    renderSchemaOverview(schema);
  } catch (error) {
    spinner.fail('Failed to load schema');
    renderError(error instanceof Error ? error.message : String(error));
  }
}

async function displayStatsCommand(nb: NeuroBase): Promise<void> {
  const spinner = new NeuroSpinner('Loading statistics').start();
  try {
    const stats = await nb.getStats();
    spinner.clear();
    renderStats(stats);
  } catch (error) {
    spinner.fail('Failed');
    renderError(error instanceof Error ? error.message : String(error));
  }
}

async function runSingleQuery(text: string, options: { explain?: boolean; sql?: boolean }): Promise<void> {
  const spinner = new NeuroSpinner('Processing').start();
  try {
    const nb = new NeuroBase(config);
    await nb.initialize();
    const result = await nb.query(text);
    spinner.clear();

    if (options.sql) { renderSQL(result.sql); console.log(); }
    if (options.explain && result.explanation) {
      renderInfo(result.explanation);
    }
    renderResultTable(result.data);
    console.log();
    renderResultMeta({
      rowCount: result.rowCount,
      executionTime: result.executionTime,
    });
    console.log();
    await nb.close();
  } catch (error) {
    spinner.fail('Query failed');
    renderError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function initializeDatabase(): Promise<void> {
  const spinner = new NeuroSpinner('Initializing database').start();
  try {
    const nb = new NeuroBase(config);
    await nb.initialize();
    spinner.succeed('Database initialized');
    await nb.close();
  } catch (error) {
    spinner.fail('Initialization failed');
    renderError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function showStatsCommand(): Promise<void> {
  try {
    const nb = new NeuroBase(config);
    await nb.initialize();
    await displayStatsCommand(nb);
    await nb.close();
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────
// Fork Management
// ─────────────────────────────────────────────────────────────

async function createFork(): Promise<void> {
  try {
    const adapter = AdapterFactory.create(config.database);
    await adapter.connect();
    const forkManager = new DatabaseForkManager(adapter);

    console.log();
    renderInfo('Create Database Fork');
    console.log(colors.dim('  Create a copy of your database for safe testing.\n'));

    const { strategy } = await inquirer.prompt([{
      type: 'list', name: 'strategy', message: 'Fork strategy:',
      choices: [
        { name: 'Current state (template)', value: 'now' },
        { name: 'Last snapshot', value: 'last-snapshot' },
        { name: 'Point-in-time', value: 'to-timestamp' },
      ],
    }]);

    if (strategy === 'to-timestamp') {
      await inquirer.prompt([{
        type: 'input', name: 'ts',
        message: 'Timestamp (RFC3339):',
        validate: (i: string) => { try { new Date(i); return true; } catch { return 'Invalid format'; } },
      }]);
    }

    const { name } = await inquirer.prompt([{
      type: 'input', name: 'name', message: 'Fork name (optional):', default: '',
    }]);

    const spinner = new NeuroSpinner('Creating fork').start();
    const strategyMap: Record<string, 'snapshot' | 'copy' | 'template'> = {
      'now': 'template', 'last-snapshot': 'snapshot', 'to-timestamp': 'copy',
    };

    const fork = await forkManager.createFork({
      strategy: strategyMap[strategy] || 'template',
      name: name || undefined,
    });
    spinner.succeed('Fork created');

    console.log();
    console.log(`  ${colors.muted('ID')}       ${colors.text(fork.id)}`);
    console.log(`  ${colors.muted('Name')}     ${colors.text(fork.name)}`);
    console.log(`  ${colors.muted('Status')}   ${colors.success(fork.status)}`);
    console.log();
  } catch (error) {
    renderError('Fork creation failed', error instanceof Error ? error.message : String(error));
  }
}

async function listForks(): Promise<void> {
  try {
    const adapter = AdapterFactory.create(config.database);
    await adapter.connect();
    const forkManager = new DatabaseForkManager(adapter);
    const spinner = new NeuroSpinner('Loading forks').start();
    const services = await forkManager.listForks();
    spinner.clear();

    if (services.length === 0) {
      renderInfo('No database forks found.');
      return;
    }

    console.log();
    renderResultTable(services.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      type: (s as any).parentId ? 'Fork' : 'Primary',
      created: new Date(s.createdAt).toLocaleString(),
    })));
    console.log();
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  }
}

async function deleteFork(forkId: string): Promise<void> {
  try {
    const adapter = AdapterFactory.create(config.database);
    await adapter.connect();
    const forkManager = new DatabaseForkManager(adapter);

    const { confirm } = await inquirer.prompt([{
      type: 'confirm', name: 'confirm',
      message: `Delete fork ${forkId}? This cannot be undone.`, default: false,
    }]);

    if (!confirm) { renderInfo('Cancelled'); return; }

    const spinner = new NeuroSpinner('Deleting fork').start();
    await forkManager.deleteFork(forkId);
    spinner.succeed('Fork deleted');
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  }
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function pluralize(singular: string): string {
  const irregulars: Record<string, string> = {
    category: 'categories', person: 'people', child: 'children',
    man: 'men', woman: 'women',
  };
  if (irregulars[singular.toLowerCase()]) return irregulars[singular.toLowerCase()];
  if (singular.endsWith('y')) return singular.slice(0, -1) + 'ies';
  if (/(?:s|ss|sh|ch|x|z)$/.test(singular)) return singular + 'es';
  if (singular.endsWith('f')) return singular.slice(0, -1) + 'ves';
  if (singular.endsWith('fe')) return singular.slice(0, -2) + 'ves';
  return singular + 's';
}

function buildQueryWithData(
  originalSQL: string,
  tableName: string,
  data: Record<string, string>
): string {
  const match = originalSQL.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (!match) return originalSQL;

  const cols = match[2].split(',').map(c => c.trim());
  const vals = match[3].split(',').map(v => v.trim());

  for (const [col, val] of Object.entries(data)) {
    cols.push(col);
    vals.push(
      isNaN(Number(val)) && val !== 'true' && val !== 'false'
        ? `'${val.replace(/'/g, "''")}'` : val
    );
  }

  return `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${vals.join(', ')})`;
}
