#!/usr/bin/env node

/**
 * NeuroBase Interactive CLI
 * Rich terminal interface with syntax highlighting, gradient branding, and interactive prompts
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { NeuroBase } from './core/neurobase';
import { config } from './config';
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
import { loadProfile, getActiveProfileName } from './config/profile-store';

const program = new Command();

program
  .name('neurobase')
  .description('Intelligent, self-learning conversational database')
  .version('3.0.0')
  // Default action: no subcommand → drop into the interactive REPL.
  .action(async () => {
    await runInteractiveMode();
  });

program
  .command('query <text>')
  .alias('q')
  .description('Run a single query and exit')
  .option('--sql', 'Show generated SQL')
  .option('--explain', 'Show explanation')
  .action(async (text: string, options: { sql?: boolean; explain?: boolean }) => {
    await runSingleQuery(text, options);
  });

const VALID_SETUP_SECTIONS = ['all', 'db', 'llm', 'model', 'token', 'features', 'privacy'] as const;
type SetupSectionArg = typeof VALID_SETUP_SECTIONS[number];

program
  .command('setup [section]')
  .description('Configure provider, model, database — section: db | llm | model | token | features | privacy')
  .option('--profile <name>', 'Profile name to create or update', 'default')
  .option('--reconfigure', 'Overwrite an existing profile without confirmation')
  .action(async (
    section: string | undefined,
    opts: { profile?: string; reconfigure?: boolean },
  ) => {
    const sel = (section ?? 'all') as SetupSectionArg;
    if (!VALID_SETUP_SECTIONS.includes(sel)) {
      console.error(`Unknown section "${section}". Valid: ${VALID_SETUP_SECTIONS.slice(1).join(', ')}`);
      process.exit(2);
    }
    await runSetupWizard({ profileName: opts.profile, section: sel, reconfigure: opts.reconfigure });
  });

program
  .command('doctor')
  .description('Check environment, credentials, and database connectivity')
  .action(async () => {
    const { runDoctor } = await import('./scripts/doctor');
    const code = await runDoctor();
    process.exit(code);
  });

program
  .command('init')
  .description('Create the NeuroBase tables in the configured database')
  .action(async () => {
    await initializeDatabase();
  });

program
  .command('stats')
  .description('Print database statistics (tables, rows, etc.)')
  .action(async () => {
    await showStatsCommand();
  });

program
  .command('serve')
  .description('Start the REST API server')
  .action(async () => {
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
      const rl = readline.createInterface({
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

  // Resolution order: active profile in ~/.neurobase → local .env → trigger login.
  const activeProfile = loadProfile(getActiveProfileName());
  const hasEnv = fs.existsSync(path.join(process.cwd(), '.env'));

  if (!activeProfile && !hasEnv) {
    console.log();
    renderInfo('No profile or .env detected. Running setup wizard...');
    console.log();
    await runSetupWizard();
    // After login, the profile is on disk — reload config and continue.
    if (!loadProfile(getActiveProfileName())) {
      // User cancelled. Bail out cleanly.
      return;
    }
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

      // Slash / dot commands are unified — both prefixes dispatch to the
      // same handler. `/cmd` is the canonical form; `.cmd` is kept as a
      // silent alias for backwards compatibility.
      const cmdMatch = trimmed.match(/^[./](\S+)(?:\s+(.*))?$/);
      if (cmdMatch) {
        const [, cmd, args] = cmdMatch;
        const handled = await dispatchReplCommand(nb, cmd, args ?? '');
        if (handled === 'exit') { running = false; continue; }
        if (handled === 'handled') continue;
        if (handled === 'unknown') {
          renderError(`Unknown command: ${trimmed}`, 'Type /help to see available commands.');
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
  const names = Array.from(new Set(placeholders.map(p => p.replace(/[[\]]/g, ''))));
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
// Model switching
// ─────────────────────────────────────────────────────────────

async function switchModelCommand(nb: NeuroBase): Promise<void> {
  const { getModelChoices } = await import('./llm/model-catalog');
  const { pickModel } = await import('./ui/model-picker');
  const provider = nb.getLLMProvider() as 'openai' | 'anthropic' | 'openrouter' | 'ollama';
  const currentModel = nb.getLLMModel();

  renderInfo(`Current: ${colors.accent(provider)} / ${colors.highlight(currentModel)}`);

  // Provider-specific context for live model fetching
  const ctx: { apiKey?: string; baseUrl?: string } = {};
  if (provider === 'openrouter') ctx.apiKey = config.llm.openrouter?.apiKey;
  if (provider === 'ollama') ctx.baseUrl = config.llm.ollama?.baseUrl;

  const choices = await getModelChoices(provider, ctx);
  if (choices.length === 0) {
    renderError('No models available for this provider');
    return;
  }

  const selected = await pickModel({
    message: `Pick a model (type to filter, ${choices.length} available)`,
    models: choices,
    currentValue: currentModel,
  });

  if (!selected) {
    renderInfo('Model unchanged');
    return;
  }
  if (selected === currentModel) {
    renderInfo('Model unchanged');
    return;
  }
  nb.setLLMModel(selected);
  renderSuccess(`Model switched to ${selected}`);
}

// ─────────────────────────────────────────────────────────────
// Slash / dot command dispatch
// ─────────────────────────────────────────────────────────────

type CommandResult = 'handled' | 'unknown' | 'exit';

async function dispatchReplCommand(nb: NeuroBase, cmd: string, args: string): Promise<CommandResult> {
  switch (cmd) {
    case 'exit':
    case 'quit':
      console.log();
      renderSuccess('Goodbye!');
      console.log();
      await nb.close();
      return 'exit';

    case 'help':
    case '?':
      renderHelp();
      return 'handled';

    case 'schema':
      await showSchemaCommand(nb);
      return 'handled';

    case 'stats':
      await displayStatsCommand(nb);
      return 'handled';

    case 'clear':
      console.clear();
      conversationHistory.length = 0;
      try { if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE); } catch { /* ignore */ }
      showBanner('3.0.0');
      renderInfo('Screen and history cleared');
      console.log();
      return 'handled';

    case 'model':
      if (args) {
        nb.setLLMModel(args.trim());
        renderSuccess(`Model switched to ${args.trim()}`);
      } else {
        await switchModelCommand(nb);
      }
      return 'handled';

    case 'db':
    case 'database':
      await dbCommand(nb, args.trim());
      return 'handled';

    case 'costs':
    case 'cost': {
      const { renderCostStats } = await import('./ui/render');
      renderCostStats(true);
      return 'handled';
    }

    case 'fork':
      await createForkCommand(nb);
      return 'handled';

    case 'forks':
      await listForksCommand(nb);
      return 'handled';

    case 'fork-delete':
      if (args.trim()) await deleteForkCommand(nb, args.trim());
      else renderError('Usage: /fork-delete <fork-id>');
      return 'handled';

    default:
      return 'unknown';
  }
}

// ─────────────────────────────────────────────────────────────
// /db — switch between registered databases at runtime
// ─────────────────────────────────────────────────────────────

async function dbCommand(nb: NeuroBase, args: string): Promise<void> {
  const { loadProfile, getActiveProfileName, listDatabases, setActiveDatabase, getActiveDatabase } =
    await import('./config/profile-store');

  const profileName = getActiveProfileName();
  const profile = loadProfile(profileName);
  if (!profile) {
    renderError('No profile loaded — run `neurobase setup`.');
    return;
  }

  const dbs = listDatabases(profile);
  const active = profile.activeDatabase;

  // No arg or `list` → show registry.
  if (!args || args === 'list') {
    if (dbs.length === 0) {
      renderInfo('No databases registered. Run `neurobase setup db` to add one.');
      return;
    }
    console.log();
    for (const d of dbs) {
      const marker = d.name === active ? colors.success('●') : colors.muted('○');
      const masked = d.entry.connectionString.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
      console.log(`  ${marker} ${colors.text(d.name)}  ${colors.dim(`(${d.entry.engine}, ${masked})`)}`);
    }
    console.log();
    return;
  }

  // `switch <name>` or just `<name>` → swap active.
  const target = args.replace(/^switch\s+/, '').trim();
  const entry = profile.databases?.[target];
  if (!entry) {
    renderError(`No database named "${target}". Available: ${dbs.map((d) => d.name).join(', ') || '(none)'}`);
    return;
  }
  if (target === active) {
    renderInfo(`Already on "${target}".`);
    return;
  }

  const spinner = new NeuroSpinner(`Switching to "${target}"`).start();
  try {
    await nb.switchDatabase({
      engine: entry.engine,
      connectionString: entry.connectionString,
      ssl: { enabled: entry.ssl?.enabled ?? true, rejectUnauthorized: entry.ssl?.rejectUnauthorized ?? true },
      pool: {
        max: entry.pool?.max ?? 20,
        idleTimeoutMillis: entry.pool?.idleTimeoutMillis ?? 30000,
        connectionTimeoutMillis: entry.pool?.connectionTimeoutMillis ?? 10000,
      },
    });
    setActiveDatabase(profileName, target);
    spinner.succeed(`Switched to "${target}" (${entry.engine})`);
  } catch (err) {
    spinner.fail('Switch failed');
    renderError(err instanceof Error ? err.message : String(err));
  }

  // Avoid the unused-import lint for getActiveDatabase — we re-import where needed.
  void getActiveDatabase;
}

// ─────────────────────────────────────────────────────────────
// Fork Management — uses the NeuroBase's current adapter so that
// forks always target the active database after a /db switch.
// ─────────────────────────────────────────────────────────────

async function createForkCommand(nb: NeuroBase): Promise<void> {
  try {
    const forkManager = new DatabaseForkManager(nb.getDatabase());

    console.log();
    renderInfo('Create Database Fork');
    // All adapters currently use a single fork approach:
    //   PostgreSQL → CREATE DATABASE … TEMPLATE
    //   MySQL      → CREATE DATABASE + table-by-table copy
    //   SQLite     → file copy (instant)
    //   MongoDB    → collection-by-collection copy
    // The legacy multi-strategy prompt promised options we don't actually
    // execute, so it was removed. Snapshot / point-in-time strategies are
    // tracked in the roadmap.
    console.log(colors.dim('  Create a copy of the active database for safe testing.\n'));

    const { name } = await inquirer.prompt([{
      type: 'input', name: 'name', message: 'Fork name (optional):', default: '',
    }]);

    const spinner = new NeuroSpinner('Creating fork').start();
    const fork = await forkManager.createFork({
      strategy: 'template',
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

async function listForksCommand(nb: NeuroBase): Promise<void> {
  try {
    const forkManager = new DatabaseForkManager(nb.getDatabase());
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
      type: (s as { parentId?: string }).parentId ? 'Fork' : 'Primary',
      created: s.createdAt ? new Date(s.createdAt).toLocaleString() : '',
    })));
    console.log();
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  }
}

async function deleteForkCommand(nb: NeuroBase, forkId: string): Promise<void> {
  try {
    const forkManager = new DatabaseForkManager(nb.getDatabase());

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
