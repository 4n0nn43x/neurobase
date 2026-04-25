#!/usr/bin/env node

/**
 * NeuroBase Doctor
 * Self-diagnostic command — verifies environment, config, and connectivity.
 * Inspired by `claw doctor` (claw-code).
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { AdapterFactory } from '../database/adapter-factory';
import type { Config } from '../types';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail?: string;
  hint?: string;
}

function symbol(status: CheckStatus): string {
  if (status === 'pass') return chalk.green('✓');
  if (status === 'warn') return chalk.yellow('⚠');
  return chalk.red('✗');
}

function printCheck(r: CheckResult): void {
  const head = `${symbol(r.status)} ${chalk.bold(r.name)}`;
  if (r.detail) {
    console.log(`${head} ${chalk.dim('—')} ${r.detail}`);
  } else {
    console.log(head);
  }
  if (r.hint && r.status !== 'pass') {
    console.log(`  ${chalk.dim('↳')} ${chalk.dim(r.hint)}`);
  }
}

function checkNode(): CheckResult {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 18) {
    return { name: 'Node version', status: 'pass', detail: `v${process.versions.node}` };
  }
  return {
    name: 'Node version',
    status: 'fail',
    detail: `v${process.versions.node} (requires ≥ 18)`,
    hint: 'Upgrade Node to 18 or higher',
  };
}

function checkConfigSource(): CheckResult {
  // Check for an active profile in ~/.neurobase first (preferred path).
  try {
    const { loadProfile, getActiveProfileName } = require('../config/profile-store');
    const name = getActiveProfileName();
    const profile = loadProfile(name);
    if (profile) {
      return { name: 'Config source', status: 'pass', detail: `profile "${name}"` };
    }
  } catch { /* fall through */ }

  // Fall back to .env detection.
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    return { name: 'Config source', status: 'pass', detail: `.env (${envPath})` };
  }
  return {
    name: 'Config source',
    status: 'warn',
    detail: 'no profile and no .env',
    hint: 'Run `neurobase setup` to configure interactively',
  };
}

function checkWritableDir(): CheckResult {
  const dir = path.join(process.cwd(), '.neurobase');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.doctor-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return { name: 'Filesystem writable', status: 'pass', detail: dir };
  } catch (err) {
    return {
      name: 'Filesystem writable',
      status: 'fail',
      detail: `cannot write to ${dir}`,
      hint: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkLLM(config: Config): CheckResult {
  const provider = config.llm.provider;
  if (provider === 'openai') {
    const key = config.llm.openai?.apiKey;
    if (!key || !key.startsWith('sk-')) {
      return {
        name: 'LLM provider (openai)',
        status: 'fail',
        detail: 'OPENAI_API_KEY missing or malformed',
        hint: 'Set OPENAI_API_KEY=sk-... in .env',
      };
    }
    return {
      name: 'LLM provider (openai)',
      status: 'pass',
      detail: `model=${config.llm.openai?.model}`,
    };
  }
  if (provider === 'anthropic') {
    const key = config.llm.anthropic?.apiKey;
    if (!key || !key.startsWith('sk-ant-')) {
      return {
        name: 'LLM provider (anthropic)',
        status: 'fail',
        detail: 'ANTHROPIC_API_KEY missing or malformed',
        hint: 'Set ANTHROPIC_API_KEY=sk-ant-... in .env',
      };
    }
    return {
      name: 'LLM provider (anthropic)',
      status: 'pass',
      detail: `model=${config.llm.anthropic?.model}`,
    };
  }
  if (provider === 'ollama') {
    return {
      name: 'LLM provider (ollama)',
      status: 'pass',
      detail: `${config.llm.ollama?.baseUrl} model=${config.llm.ollama?.model}`,
    };
  }
  return { name: 'LLM provider', status: 'fail', detail: `unknown provider: ${provider}` };
}

async function checkDatabase(config: Config): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const adapter = AdapterFactory.create(config.database);

  try {
    await adapter.connect();
    const ok = await adapter.testConnection();
    if (!ok) {
      results.push({
        name: 'Database connection',
        status: 'fail',
        detail: 'connection test returned false',
        hint: 'Verify DATABASE_URL credentials and network reachability',
      });
      return results;
    }
    results.push({
      name: 'Database connection',
      status: 'pass',
      detail: `${config.database.engine}`,
    });

    if (config.database.engine === 'postgresql') {
      try {
        const ext = await adapter.query<{ extname: string }>(
          `SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')`,
        );
        const found = new Set(ext.rows.map((r) => r.extname));
        for (const required of ['vector', 'pg_trgm']) {
          if (found.has(required)) {
            results.push({
              name: `PostgreSQL extension: ${required}`,
              status: 'pass',
            });
          } else {
            results.push({
              name: `PostgreSQL extension: ${required}`,
              status: 'warn',
              detail: 'not installed',
              hint: `CREATE EXTENSION IF NOT EXISTS ${required};`,
            });
          }
        }
      } catch (err) {
        results.push({
          name: 'PostgreSQL extensions',
          status: 'warn',
          detail: 'could not query pg_extension',
          hint: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    results.push({
      name: 'Database connection',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      hint: 'Check DATABASE_URL and that the database server is running',
    });
  } finally {
    try { await adapter.disconnect(); } catch { /* ignore */ }
  }

  return results;
}

export async function runDoctor(): Promise<number> {
  console.log();
  console.log(chalk.bold.cyan('  NeuroBase Doctor'));
  console.log(chalk.dim('  Environment and connectivity diagnostics'));
  console.log();

  const results: CheckResult[] = [];

  results.push(checkNode());
  results.push(checkConfigSource());
  results.push(checkWritableDir());

  let config: Config | null = null;
  try {
    const { loadConfig } = await import('../config');
    config = loadConfig();
    results.push({ name: 'Config load', status: 'pass' });
  } catch (err) {
    results.push({
      name: 'Config load',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      hint: 'Run `neurobase setup` to configure interactively',
    });
  }

  if (config) {
    results.push(checkLLM(config));
    const dbResults = await checkDatabase(config);
    results.push(...dbResults);
  }

  for (const r of results) printCheck(r);

  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  const passed = results.filter((r) => r.status === 'pass').length;

  console.log();
  console.log(
    `  ${chalk.green(`${passed} passed`)}  ` +
      `${chalk.yellow(`${warned} warnings`)}  ` +
      `${chalk.red(`${failed} failed`)}`,
  );
  console.log();

  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  runDoctor()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(chalk.red('Doctor failed:'), err);
      process.exit(2);
    });
}
