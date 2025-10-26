#!/usr/bin/env node

/**
 * NeuroBase Interactive CLI
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
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

    let continueSession = true;

    while (continueSession) {
      const { query } = await inquirer.prompt([
        {
          type: 'input',
          name: 'query',
          message: chalk.green('NeuroBase>'),
          prefix: '',
        },
      ]);

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
        continue;
      }

      // Execute query
      await executeQuery(nb, trimmedQuery);
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
async function executeQuery(nb: NeuroBase, query: string): Promise<void> {
  const spinner = ora('Analyzing query...').start();

  try {
    // First, try to generate the query to check for missing data
    const linguisticResult = await (nb as any).linguisticAgent.process({
      query: { text: query },
      schema: await (nb as any).schema.getSchema(),
      learningHistory: [],
    });

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
      return;
    }

    const result = await nb.query(query);

    spinner.stop();

    // Show explanation
    if (result.explanation) {
      console.log(chalk.gray(`\n💡 ${result.explanation}`));
    }

    displayQueryResults(result);
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
    const schemaText = await nb.getSchemaIntrospector().getSchemaAsText();
    spinner.stop();

    console.log(chalk.cyan('\n📋 Database Schema:\n'));
    console.log(chalk.gray(schemaText));
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
