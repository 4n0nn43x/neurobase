#!/usr/bin/env node

/**
 * NeuroBase Interactive CLI
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import * as fs from 'fs';
import * as path from 'path';
import { NeuroBase } from './core/neurobase';
import { config } from './config';

const program = new Command();

program
  .name('neurobase')
  .description('Intelligent, self-learning conversational database')
  .version('1.0.0');

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
  .description('Execute a single natural language query')
  .option('-e, --explain', 'Show query explanation')
  .option('-s, --sql', 'Show generated SQL')
  .action(async (text: string, options) => {
    await runSingleQuery(text, options);
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
    await showStats();
  });

program.parse();

// Conversation context to remember recent queries
const conversationHistory: Array<{ query: string; sql?: string; timestamp: Date }> = [];

// History file path
const HISTORY_FILE = path.join(process.cwd(), '.neurobase', 'history.txt');
const HISTORY_DIR = path.dirname(HISTORY_FILE);

/**
 * Load command history from file
 */
function loadHistory(): string[] {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      // Return in chronological order (oldest first in file)
      // Will be reversed when passed to readline
      return content.split('\n').filter(line => line.trim());
    }
  } catch (error) {
    // Ignore errors
  }
  return [];
}

/**
 * Save command to history file
 */
function saveToHistory(command: string): void {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }

    // Load existing history
    let history: string[] = [];
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      history = content.split('\n').filter(line => line.trim());
    }

    // Remove duplicate if exists
    history = history.filter(cmd => cmd !== command);

    // Add new command at the end (most recent)
    history.push(command);

    // Keep only last 100 commands
    if (history.length > 100) {
      history = history.slice(-100);
    }

    // Save back to file
    fs.writeFileSync(HISTORY_FILE, history.join('\n') + '\n', 'utf-8');
  } catch (error) {
    // Ignore errors
  }
}

/**
 * Create an inquirer-compatible history plugin
 */
class HistoryPrompt {
  private history: string[];

  constructor() {
    this.history = loadHistory();
  }

  async prompt(): Promise<string> {
    return new Promise((resolve, reject) => {
      const rl = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
        historySize: 100,
      });

      // Load history into readline
      // readline expects: [most recent, ..., oldest]
      // this.history is: [oldest, ..., most recent] from file
      // So we need to reverse
      (rl as any).history = [...this.history].reverse();

      rl.question(chalk.green('NeuroBase> '), (answer: string) => {
        rl.close();
        resolve(answer);
      });

      rl.on('error', reject);
    });
  }
}

/**
 * Interactive mode
 */
async function runInteractiveMode(): Promise<void> {
  console.log(chalk.cyan.bold('\n🧠 NeuroBase - Intelligent Database Interface\n'));

  const spinner = ora('Initializing NeuroBase...').start();

  try {
    const nb = new NeuroBase(config);
    await nb.initialize();

    spinner.succeed('NeuroBase initialized');

    // Show welcome message
    console.log(chalk.gray('\nType your questions in natural language.'));
    console.log(chalk.gray('Commands: .exit, .help, .schema, .stats, .clear\n'));

    const historyPrompt = new HistoryPrompt();
    let continueSession = true;

    while (continueSession) {
      const query = await historyPrompt.prompt();
      const trimmedQuery = query.trim();

      if (!trimmedQuery) continue;

      // Handle special commands
      if (trimmedQuery === '.exit') {
        console.log(chalk.yellow('\nGoodbye!\n'));
        await nb.close();
        continueSession = false;
        continue;
      }

      if (trimmedQuery === '.help') {
        showHelp();
        continue;
      }

      if (trimmedQuery === '.schema') {
        await showSchema(nb);
        continue;
      }

      if (trimmedQuery === '.stats') {
        await displayStats(nb);
        continue;
      }

      if (trimmedQuery === '.clear') {
        console.clear();
        // Clear conversation context
        conversationHistory.length = 0;
        // Clear history file
        try {
          if (fs.existsSync(HISTORY_FILE)) {
            fs.unlinkSync(HISTORY_FILE);
          }
        } catch (error) {
          // Ignore errors
        }
        console.log(chalk.gray('History cleared\n'));
        continue;
      }

      // Save to history (except special commands)
      saveToHistory(trimmedQuery);

      // Execute query with conversation context
      await executeQuery(nb, trimmedQuery, conversationHistory);
    }
  } catch (error) {
    spinner.fail('Failed to initialize NeuroBase');
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Execute a query and display results
 */
async function executeQuery(
  nb: NeuroBase,
  query: string,
  conversationHistory: Array<{ query: string; sql?: string; timestamp: Date }>
): Promise<void> {
  const spinner = ora('Analyzing query...').start();

  try {
    // Build conversation context for the LLM
    const recentContext = conversationHistory.slice(-3).map(entry =>
      `User: "${entry.query}"\nSQL: ${entry.sql || 'N/A'}`
    ).join('\n\n');

    // First, try to generate the query to check for missing data
    const linguisticResult = await (nb as any).linguisticAgent.process({
      query: {
        text: query,
        context: {
          previousQueries: conversationHistory.map(e => e.query),
          conversationContext: recentContext
        }
      },
      schema: await (nb as any).schema.getSchema(),
      learningHistory: [],
    });

    // Check if AI detected conversational input (not a SQL query)
    if (linguisticResult.isConversational && linguisticResult.conversationalResponse) {
      spinner.stop();
      console.log(chalk.cyan(`\n${linguisticResult.conversationalResponse}\n`));

      // Add to conversation history as conversational
      conversationHistory.push({
        query,
        sql: undefined,
        timestamp: new Date()
      });
      if (conversationHistory.length > 10) {
        conversationHistory.shift();
      }
      return;
    }

    // Check if clarification is needed (ambiguous query)
    if (linguisticResult.needsClarification && linguisticResult.clarificationQuestion) {
      spinner.stop();
      await handleClarificationNeeded(nb, query, linguisticResult, conversationHistory);
      return;
    }

    // Check if there are missing required columns
    if (linguisticResult.missingData) {
      spinner.stop();
      console.log(chalk.yellow(`\n⚠️  Missing required information for table '${linguisticResult.missingData.table}'`));
      console.log(chalk.gray(linguisticResult.missingData.reason + '\n'));

      // Collect missing data from user
      const collectedData = await collectMissingData(linguisticResult.missingData);

      // Rebuild the query with the collected data
      const updatedQuery = await buildQueryWithData(
        linguisticResult.sql,
        linguisticResult.missingData.table,
        collectedData
      );

      console.log(chalk.blue('\n📝 Updated SQL:'));
      console.log(chalk.gray(formatSQL(updatedQuery)));

      // Ask for confirmation
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Execute this query?',
          default: true,
        },
      ]);

      if (!confirm) {
        console.log(chalk.yellow('\nQuery cancelled.\n'));
        return;
      }

      spinner.start('Executing query...');
      // Execute the updated SQL directly via the database connection
      const db = (nb as any).db;
      const startTime = Date.now();
      const dbResult = await db.query(updatedQuery);
      const executionTime = Date.now() - startTime;

      spinner.stop();

      displayQueryResults({
        data: dbResult.rows,
        sql: updatedQuery,
        executionTime,
        rowCount: dbResult.rowCount,
        learned: false,
      });

      // Add to conversation history
      conversationHistory.push({
        query,
        sql: updatedQuery,
        timestamp: new Date()
      });
      // Keep only last 10 conversations
      if (conversationHistory.length > 10) {
        conversationHistory.shift();
      }
      return;
    }

    const result = await nb.query(query);

    spinner.stop();

    // Show explanation
    if (result.explanation) {
      console.log(chalk.gray(`\n💡 ${result.explanation}`));
    }

    displayQueryResults(result);

    // Add to conversation history
    conversationHistory.push({
      query,
      sql: result.sql,
      timestamp: new Date()
    });
    // Keep only last 10 conversations
    if (conversationHistory.length > 10) {
      conversationHistory.shift();
    }
  } catch (error) {
    spinner.fail('Query failed');
    console.error(
      chalk.red('\n❌ Error:'),
      error instanceof Error ? error.message : error
    );
    console.log();
  }
}

/**
 * Display query results
 */
function displayQueryResults(result: any): void {
  // Show SQL
  console.log(chalk.blue('\n📝 Generated SQL:'));
  console.log(chalk.gray(formatSQL(result.sql)));

  // Show execution time
  console.log(
    chalk.gray(`\n⚡ Execution time: ${result.executionTime}ms`)
  );

  // Show results
  if (result.data.length === 0) {
    console.log(chalk.yellow('\n(No rows returned)\n'));
  } else {
    console.log(chalk.green(`\n📊 Results (${result.rowCount} rows):\n`));
    displayTable(result.data);
  }

  // Show suggestions
  if (result.suggestions && result.suggestions.length > 0) {
    console.log(chalk.yellow('\n💡 Suggestions:'));
    result.suggestions.forEach((s: string) => console.log(chalk.gray(`  - ${s}`)));
    console.log();
  }

  // Show learning indicator
  if (result.learned) {
    console.log(chalk.green('✓ Learned from this interaction\n'));
  }
}

/**
 * Handle clarification needed for ambiguous queries
 */
async function handleClarificationNeeded(
  nb: NeuroBase,
  originalQuery: string,
  linguisticResult: any,
  conversationHistory: Array<{ query: string; sql?: string; timestamp: Date }>
): Promise<void> {
  console.log(chalk.yellow(`\n❓ ${linguisticResult.clarificationQuestion}\n`));

  // Show suggested interpretations if available
  if (linguisticResult.suggestedInterpretations && linguisticResult.suggestedInterpretations.length > 0) {
    console.log(chalk.cyan('Possible interpretations:\n'));

    const choices = linguisticResult.suggestedInterpretations.map((interp: any, index: number) => ({
      name: `${index + 1}. ${interp.description}`,
      value: index,
    }));

    // Add option to provide more context
    choices.push({
      name: chalk.gray('⚙️  I\'ll provide more details...'),
      value: -1,
    });

    const { selectedIndex } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedIndex',
        message: 'Which interpretation is correct?',
        choices,
      },
    ]);

    if (selectedIndex === -1) {
      // User wants to provide more details
      console.log(chalk.cyan('\n💬 Please provide more details about what you want:\n'));
      const { additionalContext } = await inquirer.prompt([
        {
          type: 'input',
          name: 'additionalContext',
          message: 'Additional details:',
          validate: (input: string) => input.trim() !== '' || 'Please provide some details',
        },
      ]);

      // Re-run the query with additional context
      const enhancedQuery = `${originalQuery}. ${additionalContext}`;
      console.log(chalk.gray(`\n📝 Enhanced query: "${enhancedQuery}"\n`));
      await executeQuery(nb, enhancedQuery, conversationHistory);
      return;
    }

    // User selected an interpretation
    const selectedInterpretation = linguisticResult.suggestedInterpretations[selectedIndex];
    console.log(chalk.green(`\n✓ Selected: ${selectedInterpretation.description}\n`));

    // Execute the selected SQL
    const spinner = ora('Executing query...').start();
    try {
      const db = (nb as any).db;
      const startTime = Date.now();
      const dbResult = await db.query(selectedInterpretation.sql);
      const executionTime = Date.now() - startTime;

      spinner.stop();

      displayQueryResults({
        data: dbResult.rows,
        sql: selectedInterpretation.sql,
        executionTime,
        rowCount: dbResult.rowCount,
        learned: false,
      });

      // Add to conversation history
      conversationHistory.push({
        query: originalQuery,
        sql: selectedInterpretation.sql,
        timestamp: new Date(),
      });
      if (conversationHistory.length > 10) {
        conversationHistory.shift();
      }
    } catch (error) {
      spinner.fail('Query failed');
      console.error(
        chalk.red('\n❌ Error:'),
        error instanceof Error ? error.message : error
      );
    }
  } else {
    // No suggested interpretations, ask for clarification
    console.log(chalk.cyan('\n💬 Please rephrase your question with more details:\n'));
    const { clarifiedQuery } = await inquirer.prompt([
      {
        type: 'input',
        name: 'clarifiedQuery',
        message: 'Your clarified question:',
        validate: (input: string) => input.trim() !== '' || 'Please provide a question',
      },
    ]);

    // Re-execute with clarified query
    await executeQuery(nb, clarifiedQuery, conversationHistory);
  }
}

/**
 * Collect missing data from user interactively
 */
async function collectMissingData(missingData: any): Promise<Record<string, string>> {
  const collectedData: Record<string, string> = {};

  console.log(chalk.cyan('Please provide the following information:\n'));

  for (const columnInfo of missingData.columns) {
    const questions: any[] = [];

    if (columnInfo.possibleValues && columnInfo.possibleValues.length > 0) {
      // Use list selection for predefined values
      questions.push({
        type: 'list',
        name: columnInfo.column,
        message: `${columnInfo.column} (${columnInfo.type}):`,
        choices: [...columnInfo.possibleValues, new inquirer.Separator(), 'Custom value...'],
      });

      const answer = await inquirer.prompt(questions);

      if (answer[columnInfo.column] === 'Custom value...') {
        const { customValue } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customValue',
            message: `Enter custom ${columnInfo.column}:`,
            validate: (input: string) => input.trim() !== '' || 'Value cannot be empty',
          },
        ]);
        collectedData[columnInfo.column] = customValue;
      } else {
        collectedData[columnInfo.column] = answer[columnInfo.column];
      }
    } else {
      // Use input for free-form entry
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: columnInfo.column,
          message: `${columnInfo.column} (${columnInfo.type}):`,
          default: columnInfo.defaultValue,
          validate: (input: string) => input.trim() !== '' || 'Value cannot be empty',
        },
      ]);
      collectedData[columnInfo.column] = answer[columnInfo.column];
    }
  }

  return collectedData;
}

/**
 * Build updated SQL query with collected data
 */
async function buildQueryWithData(
  originalSQL: string,
  tableName: string,
  collectedData: Record<string, string>
): Promise<string> {
  // Parse the original INSERT statement
  const insertMatch = originalSQL.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);

  if (!insertMatch) {
    return originalSQL;
  }

  const columns = insertMatch[2].split(',').map((c) => c.trim());
  const values = insertMatch[3].split(',').map((v) => v.trim());

  // Add missing columns and values
  const newColumns = [...columns];
  const newValues = [...values];

  for (const [column, value] of Object.entries(collectedData)) {
    newColumns.push(column);
    // Properly quote the value
    const quotedValue = isNaN(Number(value)) && value !== 'true' && value !== 'false'
      ? `'${value.replace(/'/g, "''")}'`
      : value;
    newValues.push(quotedValue);
  }

  return `INSERT INTO ${tableName} (${newColumns.join(', ')}) VALUES (${newValues.join(', ')})`;
}

/**
 * Display results as a table
 */
function displayTable(data: any[]): void {
  if (data.length === 0) return;

  const columns = Object.keys(data[0]);
  const table = new Table({
    head: columns.map((c) => chalk.cyan(c)),
    style: {
      head: [],
      border: ['gray'],
    },
  });

  // Limit to first 50 rows
  const displayData = data.slice(0, 50);

  for (const row of displayData) {
    table.push(columns.map((col) => formatValue(row[col])));
  }

  console.log(table.toString());

  if (data.length > 50) {
    console.log(chalk.gray(`\n... and ${data.length - 50} more rows`));
  }
}

/**
 * Format a value for display
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return chalk.gray('NULL');
  }

  if (typeof value === 'object') {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Format SQL for display
 */
function formatSQL(sql: string): string {
  return sql
    .replace(/\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET)\b/gi, (match) =>
      chalk.bold(match.toUpperCase())
    );
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(chalk.cyan('\n📖 NeuroBase Commands:\n'));
  console.log('  .exit     - Exit NeuroBase');
  console.log('  .help     - Show this help message');
  console.log('  .schema   - Show database schema');
  console.log('  .stats    - Show database statistics');
  console.log('  .clear    - Clear screen\n');

  console.log(chalk.cyan('💡 Example Queries:\n'));
  console.log('  "Show me all users"');
  console.log('  "What are the top 5 products by sales?"');
  console.log('  "How many orders were placed this week?"');
  console.log('  "Show customers with no orders"\n');
}

/**
 * Show database schema
 */
async function showSchema(nb: NeuroBase): Promise<void> {
  const spinner = ora('Loading schema...').start();

  try {
    const schemaMermaid = await nb.getSchemaIntrospector().getSchemaAsMermaid();
    spinner.stop();

    console.log(chalk.cyan('\n📊 Database Schema (UML/ER Diagram):\n'));
    console.log(chalk.gray('Copy the diagram below and paste it into https://mermaid.live for visualization\n'));
    console.log(chalk.yellow('─'.repeat(80)));
    console.log(schemaMermaid);
    console.log(chalk.yellow('─'.repeat(80)));
    console.log(chalk.gray('\n💡 Tip: You can also save this to a .mmd file and open it in VS Code with Mermaid extension\n'));
  } catch (error) {
    spinner.fail('Failed to load schema');
    console.error(chalk.red('Error:'), error);
  }
}

/**
 * Display database statistics
 */
async function displayStats(nb: NeuroBase): Promise<void> {
  const spinner = ora('Loading statistics...').start();

  try {
    const stats = await nb.getStats();
    spinner.stop();

    console.log(chalk.cyan('\n📊 Database Statistics:\n'));
    console.log(`  Database size: ${chalk.green(stats.database.size)}`);
    console.log(`  Tables: ${chalk.green(stats.database.tables)}`);
    console.log(`  Active connections: ${chalk.green(stats.database.connections)}`);
    console.log(`  Views: ${chalk.green(stats.schema.views)}`);
    console.log(`  Functions: ${chalk.green(stats.schema.functions)}\n`);
  } catch (error) {
    spinner.fail('Failed to load statistics');
    console.error(chalk.red('Error:'), error);
  }
}

/**
 * Run a single query
 */
async function runSingleQuery(
  text: string,
  options: { explain?: boolean; sql?: boolean }
): Promise<void> {
  const spinner = ora('Processing query...').start();

  try {
    const nb = new NeuroBase(config);
    await nb.initialize();

    const result = await nb.query(text);

    spinner.stop();

    if (options.sql || options.explain) {
      if (options.explain && result.explanation) {
        console.log(chalk.blue('\nExplanation:'), result.explanation);
      }

      if (options.sql) {
        console.log(chalk.blue('\nSQL:'));
        console.log(result.sql);
      }

      console.log();
    }

    displayTable(result.data);

    await nb.close();
  } catch (error) {
    spinner.fail('Query failed');
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Initialize database
 */
async function initializeDatabase(): Promise<void> {
  const spinner = ora('Initializing database...').start();

  try {
    const nb = new NeuroBase(config);
    await nb.initialize();

    spinner.succeed('Database initialized successfully');

    await nb.close();
  } catch (error) {
    spinner.fail('Initialization failed');
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Show stats command
 */
async function showStats(): Promise<void> {
  try {
    const nb = new NeuroBase(config);
    await nb.initialize();

    await displayStats(nb);

    await nb.close();
  } catch (error) {
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
