/**
 * NeuroBase Setup Wizard
 * Interactive first-run configuration using @clack/prompts
 */

import * as clack from '@clack/prompts';
import chalk from 'chalk';
import gradient from 'gradient-string';
import * as fs from 'fs';
import * as path from 'path';
import { colors } from './theme';

const neuroGradient = gradient(['#7C3AED', '#06B6D4', '#10B981']);

export async function runSetupWizard(targetDir: string = process.cwd()): Promise<void> {
  const envPath = path.join(targetDir, '.env');

  console.log();
  console.log(neuroGradient('  NeuroBase Setup Wizard'));
  console.log();

  clack.intro(colors.dim('Configure your database and LLM connection'));

  // Check if .env already exists
  if (fs.existsSync(envPath)) {
    const overwrite = await clack.confirm({
      message: '.env file already exists. Overwrite?',
      initialValue: false,
    });

    if (clack.isCancel(overwrite) || !overwrite) {
      clack.outro(colors.dim('Setup cancelled. Existing .env preserved.'));
      return;
    }
  }

  // Database configuration
  const dbEngine = await clack.select({
    message: 'Database engine',
    options: [
      { value: 'postgresql', label: 'PostgreSQL', hint: 'recommended' },
      { value: 'mysql', label: 'MySQL' },
      { value: 'sqlite', label: 'SQLite', hint: 'local file-based' },
      { value: 'mongodb', label: 'MongoDB' },
    ],
  });

  if (clack.isCancel(dbEngine)) {
    clack.cancel('Setup cancelled.');
    return;
  }

  let dbUrl: string | symbol;

  if (dbEngine === 'sqlite') {
    const dbPath = await clack.text({
      message: 'SQLite database file path',
      placeholder: './data/neurobase.db',
      defaultValue: './data/neurobase.db',
    });
    if (clack.isCancel(dbPath)) { clack.cancel('Setup cancelled.'); return; }
    dbUrl = dbPath;
  } else {
    const defaultUrl = dbEngine === 'postgresql'
      ? 'postgresql://user:password@localhost:5432/mydb'
      : dbEngine === 'mysql'
        ? 'mysql://user:password@localhost:3306/mydb'
        : 'mongodb://localhost:27017/mydb';

    dbUrl = await clack.text({
      message: 'Database connection URL',
      placeholder: defaultUrl,
      validate: (val) => {
        if (!val) return 'Connection URL is required';
        return undefined;
      },
    });
    if (clack.isCancel(dbUrl)) { clack.cancel('Setup cancelled.'); return; }
  }

  // LLM provider
  const llmProvider = await clack.select({
    message: 'LLM provider',
    options: [
      { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'recommended' },
      { value: 'openai', label: 'OpenAI (GPT-4)' },
      { value: 'ollama', label: 'Ollama (local)', hint: 'free, no API key needed' },
    ],
  });

  if (clack.isCancel(llmProvider)) { clack.cancel('Setup cancelled.'); return; }

  let apiKey: string | symbol = '';
  let model: string | symbol = '';

  if (llmProvider === 'anthropic') {
    apiKey = await clack.text({
      message: 'Anthropic API key',
      placeholder: 'sk-ant-...',
      validate: (val) => {
        if (!val) return 'API key is required';
        return undefined;
      },
    });
    if (clack.isCancel(apiKey)) { clack.cancel('Setup cancelled.'); return; }

    model = await clack.text({
      message: 'Claude model',
      placeholder: 'claude-sonnet-4-20250514',
      defaultValue: 'claude-sonnet-4-20250514',
    });
    if (clack.isCancel(model)) { clack.cancel('Setup cancelled.'); return; }
  } else if (llmProvider === 'openai') {
    apiKey = await clack.text({
      message: 'OpenAI API key',
      placeholder: 'sk-...',
      validate: (val) => {
        if (!val) return 'API key is required';
        return undefined;
      },
    });
    if (clack.isCancel(apiKey)) { clack.cancel('Setup cancelled.'); return; }

    model = await clack.text({
      message: 'OpenAI model',
      placeholder: 'gpt-4-turbo-preview',
      defaultValue: 'gpt-4-turbo-preview',
    });
    if (clack.isCancel(model)) { clack.cancel('Setup cancelled.'); return; }
  } else {
    model = await clack.text({
      message: 'Ollama model',
      placeholder: 'llama3.2',
      defaultValue: 'llama3.2',
    });
    if (clack.isCancel(model)) { clack.cancel('Setup cancelled.'); return; }
  }

  // Features
  const features = await clack.multiselect({
    message: 'Enable features',
    options: [
      { value: 'learning', label: 'Learning', hint: 'remember query patterns' },
      { value: 'optimization', label: 'Query optimization', hint: 'auto-optimize SQL' },
      { value: 'self-correction', label: 'Self-correction', hint: 'auto-fix failed queries' },
      { value: 'multi-candidate', label: 'Multi-candidate', hint: 'generate multiple SQL candidates' },
    ],
    initialValues: ['learning', 'optimization', 'self-correction'],
  });

  if (clack.isCancel(features)) { clack.cancel('Setup cancelled.'); return; }

  // Privacy mode
  const privacyMode = await clack.select({
    message: 'Privacy mode',
    options: [
      { value: 'schema-only', label: 'Schema only', hint: 'default - no row data sent to LLM' },
      { value: 'permissive', label: 'Permissive', hint: 'send data samples for better accuracy' },
      { value: 'strict', label: 'Strict', hint: 'nothing sent to LLM (local only)' },
    ],
  });

  if (clack.isCancel(privacyMode)) { clack.cancel('Setup cancelled.'); return; }

  // Generate .env
  const spinner = clack.spinner();
  spinner.start('Writing configuration');

  let envContent = `# NeuroBase Configuration\n# Generated by neurobase init\n\n`;
  envContent += `# Database\n`;
  envContent += `DB_ENGINE=${dbEngine}\n`;
  envContent += `DATABASE_URL=${dbUrl}\n\n`;

  envContent += `# LLM Provider\n`;
  envContent += `LLM_PROVIDER=${llmProvider}\n`;

  if (llmProvider === 'anthropic') {
    envContent += `ANTHROPIC_API_KEY=${apiKey}\n`;
    envContent += `ANTHROPIC_MODEL=${model}\n`;
  } else if (llmProvider === 'openai') {
    envContent += `OPENAI_API_KEY=${apiKey}\n`;
    envContent += `OPENAI_MODEL=${model}\n`;
  } else {
    envContent += `OLLAMA_MODEL=${model}\n`;
    envContent += `OLLAMA_BASE_URL=http://localhost:11434\n`;
  }

  envContent += `\n# Features\n`;
  envContent += `ENABLE_LEARNING=${(features as string[]).includes('learning')}\n`;
  envContent += `ENABLE_OPTIMIZATION=${(features as string[]).includes('optimization')}\n`;
  envContent += `ENABLE_SELF_CORRECTION=${(features as string[]).includes('self-correction')}\n`;
  envContent += `ENABLE_MULTI_CANDIDATE=${(features as string[]).includes('multi-candidate')}\n`;

  envContent += `\n# Privacy\n`;
  envContent += `PRIVACY_MODE=${privacyMode}\n`;

  envContent += `\n# Server\n`;
  envContent += `NEUROBASE_PORT=3000\n`;
  envContent += `NEUROBASE_MODE=interactive\n`;

  fs.writeFileSync(envPath, envContent, 'utf-8');

  // Add .env to .gitignore if not already there
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignore.includes('.env')) {
      fs.appendFileSync(gitignorePath, '\n.env\n');
    }
  }

  spinner.stop('Configuration written');

  clack.outro(chalk.green('Setup complete!') + colors.dim(' Run ') + colors.accent('neurobase interactive') + colors.dim(' to start.'));
}
