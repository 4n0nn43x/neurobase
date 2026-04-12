/**
 * NeuroBase Setup Wizard
 *
 * Single entry point for configuring the app. Walks the user through provider
 * selection, API key entry (with live validation), model selection, DB connection
 * (with live test), and persists everything to ~/.neurobase/ — no .env required.
 *
 * Supports partial reconfiguration via the `section` parameter:
 *   all | db | llm | model | token | features | privacy
 */

import * as clack from '@clack/prompts';
import chalk from 'chalk';
import gradient from 'gradient-string';
import { colors } from './theme';
import { AdapterFactory } from '../database/adapter-factory';
import {
  saveProfile,
  setActiveProfile,
  getActiveProfileName,
  loadProfile,
  addDatabase,
  removeDatabase,
  setActiveDatabase,
  listDatabases,
  type PartialLLMConfig,
  type PartialDatabaseConfig,
  type NamedDatabase,
} from '../config/profile-store';
import { setCredential } from '../config/credential-store';
import { OpenRouterProvider } from '../llm/providers/openrouter';
import { pickModel } from './model-picker';
import { normalizeDbUrl, validateDbUrlShape, formatDbError } from '../utils/db-url';
import type { LLMProviderName } from '../types';

const neuroGradient = gradient(['#7C3AED', '#06B6D4', '#10B981']);

// ─────────────────────────────────────────────────────────────────────────────
// Model catalogues
// ─────────────────────────────────────────────────────────────────────────────

interface ModelOption {
  value: string;
  label: string;
  hint?: string;
}

const ANTHROPIC_MODELS: ModelOption[] = [
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', hint: 'recommended' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7', hint: 'strongest reasoning' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', hint: 'fastest, cheapest' },
];

const OPENAI_MODELS: ModelOption[] = [
  { value: 'gpt-4o', label: 'GPT-4o', hint: 'recommended' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', hint: 'fastest, cheapest' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
];

const OLLAMA_MODELS_SUGGESTED: ModelOption[] = [
  { value: 'llama3.2', label: 'llama3.2', hint: 'general' },
  { value: 'qwen2.5-coder', label: 'qwen2.5-coder', hint: 'code-tuned' },
  { value: 'mistral', label: 'mistral' },
  { value: 'phi3', label: 'phi3', hint: 'small' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Live validators
// ─────────────────────────────────────────────────────────────────────────────

async function verifyAnthropicKey(key: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: 'key rejected (401/403)' };
    }
    if (!res.ok && res.status !== 400) {
      // 400 is fine here — the key auth worked, request shape might just be quirky
      return { ok: false, detail: `unexpected status ${res.status}` };
    }
    return { ok: true, detail: 'key accepted' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function verifyOpenAIKey(key: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: 'key rejected (401/403)' };
    }
    if (!res.ok) {
      return { ok: false, detail: `status ${res.status}` };
    }
    const data = (await res.json()) as { data?: unknown[] };
    return { ok: true, detail: `${data.data?.length ?? '?'} models visible` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function verifyOpenRouterKey(key: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const ok = await OpenRouterProvider.verifyKey(key);
    return { ok, detail: ok ? 'key accepted' : 'rejected' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function verifyOllamaReachable(baseUrl: string): Promise<{ ok: boolean; detail: string; models?: string[] }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`);
    if (!res.ok) {
      return { ok: false, detail: `status ${res.status}` };
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models || []).map((m) => m.name);
    return { ok: true, detail: `${models.length} models installed`, models };
  } catch (err) {
    return { ok: false, detail: `unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function testDatabase(engine: PartialDatabaseConfig['engine'], url: string): Promise<{ ok: boolean; detail: string }> {
  if (!engine) return { ok: false, detail: 'engine required' };
  const adapter = AdapterFactory.create({
    engine,
    connectionString: url,
    ssl: { enabled: true, rejectUnauthorized: true },
    pool: { max: 1, idleTimeoutMillis: 1000, connectionTimeoutMillis: 5000 },
  });
  try {
    await adapter.connect();
    // Engine-specific probe so driver errors bubble up (instead of being
    // swallowed by adapter.testConnection() returning a bare boolean).
    //
    // SQL engines: SELECT 1 round-trips the driver and surfaces auth / DNS errors.
    // MongoDB: getTables() lists collections — the only "neutral" probe that
    // doesn't speak SQL.
    if (engine === 'mongodb') {
      await adapter.getTables();
    } else {
      await adapter.query('SELECT 1');
    }
    let detail = 'connection ok';
    try {
      const tables = await adapter.getTables();
      detail = `${tables.length} ${engine === 'mongodb' ? 'collections' : 'tables'} found`;
    } catch { /* introspection optional */ }
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, detail: formatDbError(engine, err) };
  } finally {
    try { await adapter.disconnect(); } catch { /* ignore */ }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Wizard
// ─────────────────────────────────────────────────────────────────────────────

interface CancelResult { cancelled: true }
function cancelled(): CancelResult { return { cancelled: true }; }

export type SetupSection = 'all' | 'db' | 'llm' | 'model' | 'token' | 'features' | 'privacy';

export async function runSetupWizard(
  opts: { profileName?: string; section?: SetupSection; reconfigure?: boolean } = {},
): Promise<void> {
  const section = opts.section ?? 'all';
  const profileName = opts.profileName ?? getActiveProfileName();
  const existing = loadProfile(profileName);

  console.log();
  console.log(neuroGradient(`  NeuroBase Login${section === 'all' ? '' : ' · ' + section}`));
  console.log();
  clack.intro(colors.dim(section === 'all'
    ? 'Configure provider, model, and database — saved to ~/.neurobase'
    : `Updating only the ${section} section of profile "${profileName}"`));

  // Partial sections require an existing profile. Fall back to full setup
  // if the user asked for a section but nothing is saved yet.
  if (section !== 'all' && !existing) {
    clack.log.warn(`No profile "${profileName}" yet — switching to full setup.`);
    return runSection('all', profileName, null);
  }

  // For full setup with an existing profile, ask before clobbering.
  if (section === 'all' && existing && !opts.reconfigure) {
    const overwrite = await clack.confirm({
      message: `Profile "${profileName}" already exists. Overwrite?`,
      initialValue: false,
    });
    if (clack.isCancel(overwrite) || !overwrite) {
      clack.outro(colors.dim('Login cancelled. Existing profile preserved.'));
      return;
    }
  }

  return runSection(section, profileName, existing);
}

async function runSection(
  section: SetupSection,
  profileName: string,
  existing: ReturnType<typeof loadProfile>,
): Promise<void> {
  switch (section) {
    case 'all':      return runFullLogin(profileName, existing);
    case 'db':       return runDbOnly(profileName, existing!);
    case 'llm':      return runLlmOnly(profileName, existing!);
    case 'model':    return runModelOnly(profileName, existing!);
    case 'token':    return runTokenOnly(profileName, existing!);
    case 'features': return runFeaturesOnly(profileName, existing!);
    case 'privacy':  return runPrivacyOnly(profileName, existing!);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section handlers
// ─────────────────────────────────────────────────────────────────────────────

async function runFullLogin(profileName: string, existing: ReturnType<typeof loadProfile>): Promise<void> {
  const provider = await pickProvider(existing?.llm?.provider);
  if (!provider) { clack.cancel('Cancelled.'); return; }

  const llm = await collectLLM(provider);
  if ('cancelled' in llm) { clack.cancel('Cancelled.'); return; }

  // DB step is optional — users may want to register databases later
  // (or have several to register; that's the `setup db` flow).
  const addDbNow = await clack.confirm({
    message: 'Register a database now?',
    initialValue: !existing?.databases || Object.keys(existing.databases).length === 0,
  });
  if (clack.isCancel(addDbNow)) { clack.cancel('Cancelled.'); return; }

  let newDb: { name: string; entry: NamedDatabase } | null = null;
  if (addDbNow) {
    const collected = await collectNamedDatabase(existing);
    if ('cancelled' in collected) { clack.cancel('Cancelled.'); return; }
    newDb = collected;
  } else {
    clack.log.info('Skipped — add databases anytime with `neurobase setup db`.');
  }

  const privacy = await pickPrivacy(existing?.security?.privacyMode);
  if (!privacy) { clack.cancel('Cancelled.'); return; }

  const features = await pickFeatures(existing?.features);
  if (!features) { clack.cancel('Cancelled.'); return; }

  // Save the LLM + features + privacy parts first.
  persistAndAnnounce(profileName, existing, {
    llm: buildLlmConfig(provider, llm),
    features,
    security: { privacyMode: privacy },
  }, getCredentialUpdate(provider, llm), /* announce= */ !newDb);

  // Then layer in the named database via the registry.
  if (newDb) {
    addDatabase(profileName, newDb.name, newDb.entry);
    clack.outro(
      chalk.green('Setup complete.') +
        colors.dim(` Profile: ${profileName} · Database: ${newDb.name} · Run `) +
        colors.accent('neurobase') +
        colors.dim(' to start.'),
    );
  }
}

async function runDbOnly(profileName: string, existing: NonNullable<ReturnType<typeof loadProfile>>): Promise<void> {
  // Migrate any legacy single-DB on the fly so we work from a uniform registry.
  if (existing.database?.connectionString && !existing.databases) {
    addDatabase(profileName, 'default', {
      engine: existing.database.engine ?? 'postgresql',
      connectionString: existing.database.connectionString,
      ssl: existing.database.ssl,
      pool: existing.database.pool,
    });
    existing = loadProfile(profileName)!;
    clack.log.info('Migrated your existing database into the registry as "default".');
  }

  const dbs = listDatabases(existing);
  const active = existing.activeDatabase;

  if (dbs.length === 0) {
    // First-time registration: name + collect + save + set active.
    const collected = await collectNamedDatabase(existing);
    if ('cancelled' in collected) { clack.cancel('Cancelled.'); return; }
    addDatabase(profileName, collected.name, collected.entry);
    setActiveProfile(profileName);
    clack.outro(chalk.green(`Database "${collected.name}" registered (active).`));
    return;
  }

  // Show the menu — what does the user want to do?
  const action = await clack.select<'switch' | 'add' | 'edit' | 'remove' | 'done'>({
    message: `Databases (${dbs.length} registered, active: ${active ?? '—'})`,
    options: [
      ...(dbs.length > 1 ? [{ value: 'switch' as const, label: 'Switch active database', hint: 'change which one is used' }] : []),
      { value: 'add', label: 'Add a new database' },
      { value: 'edit', label: 'Edit an existing database' },
      { value: 'remove', label: 'Remove a database' },
      { value: 'done', label: 'Done' },
    ],
  });
  if (clack.isCancel(action) || action === 'done') return;

  if (action === 'switch') {
    const pick = await clack.select({
      message: 'Switch to',
      options: dbs.map((d) => ({
        value: d.name,
        label: `${d.name}  (${d.entry.engine}, ${maskDbUrl(d.entry.connectionString)})`,
        hint: d.name === active ? 'currently active' : undefined,
      })),
      initialValue: active,
    });
    if (clack.isCancel(pick)) return;
    setActiveDatabase(profileName, pick as string);
    clack.outro(chalk.green(`Active database is now "${pick}".`));
    return;
  }

  if (action === 'add') {
    const collected = await collectNamedDatabase(existing);
    if ('cancelled' in collected) { clack.cancel('Cancelled.'); return; }
    addDatabase(profileName, collected.name, collected.entry);
    clack.outro(chalk.green(`Database "${collected.name}" added.`));
    return;
  }

  if (action === 'edit') {
    const pick = await clack.select({
      message: 'Edit which database',
      options: dbs.map((d) => ({
        value: d.name,
        label: `${d.name}  (${d.entry.engine}, ${maskDbUrl(d.entry.connectionString)})`,
      })),
    });
    if (clack.isCancel(pick)) return;
    const entry = existing.databases![pick as string];
    clack.log.info(`Updating "${pick}" (${entry.engine})`);
    const collected = await collectNamedDatabase(existing, { fixedName: pick as string });
    if ('cancelled' in collected) { clack.cancel('Cancelled.'); return; }
    addDatabase(profileName, collected.name, collected.entry);
    clack.outro(chalk.green(`Database "${collected.name}" updated.`));
    return;
  }

  if (action === 'remove') {
    const pick = await clack.select({
      message: 'Remove which database',
      options: dbs.map((d) => ({
        value: d.name,
        label: `${d.name}  (${d.entry.engine}, ${maskDbUrl(d.entry.connectionString)})`,
      })),
    });
    if (clack.isCancel(pick)) return;
    const confirm = await clack.confirm({
      message: `Really remove "${pick}"?`,
      initialValue: false,
    });
    if (clack.isCancel(confirm) || !confirm) return;
    removeDatabase(profileName, pick as string);
    clack.outro(chalk.green(`Database "${pick}" removed.`));
  }
}

interface CollectedNamedDb {
  name: string;
  entry: NamedDatabase;
}

async function collectNamedDatabase(
  existing: ReturnType<typeof loadProfile>,
  opts: { fixedName?: string } = {},
): Promise<CollectedNamedDb | CancelResult> {
  let name: string;
  if (opts.fixedName) {
    name = opts.fixedName;
  } else {
    const taken = new Set(Object.keys(existing?.databases ?? {}));
    const defaultName = pickFreeName(taken);
    const entered = await clack.text({
      message: 'Name for this database',
      placeholder: defaultName,
      defaultValue: defaultName,
      validate: (val) => {
        if (!val) return 'A name is required';
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(val)) return 'Use letters, digits, _ or -';
        if (taken.has(val) && !opts.fixedName) return `"${val}" already exists`;
        return undefined;
      },
    });
    if (clack.isCancel(entered)) return cancelled();
    name = entered as string;
  }

  const db = await collectDatabase();
  if ('cancelled' in db) return cancelled();

  return {
    name,
    entry: {
      engine: db.engine,
      connectionString: db.url,
    },
  };
}

function pickFreeName(taken: Set<string>): string {
  if (!taken.has('default')) return 'default';
  let i = 2;
  while (taken.has(`db${i}`)) i++;
  return `db${i}`;
}

async function runLlmOnly(profileName: string, existing: NonNullable<ReturnType<typeof loadProfile>>): Promise<void> {
  const provider = await pickProvider(existing.llm?.provider);
  if (!provider) { clack.cancel('Cancelled.'); return; }

  const llm = await collectLLM(provider);
  if ('cancelled' in llm) { clack.cancel('Cancelled.'); return; }

  persistAndAnnounce(profileName, existing, {
    llm: buildLlmConfig(provider, llm),
  }, getCredentialUpdate(provider, llm));
}

async function runModelOnly(profileName: string, existing: NonNullable<ReturnType<typeof loadProfile>>): Promise<void> {
  const provider = existing.llm?.provider;
  if (!provider) {
    clack.log.error('No provider configured — run `neurobase setup llm` first.');
    return;
  }
  const current = getCurrentModelFromProfile(existing);
  if (current) clack.log.info(`Current: ${provider} / ${current}`);

  const apiKey =
    provider !== 'ollama'
      ? (await import('../config/credential-store')).getCredential(provider as 'anthropic' | 'openai' | 'openrouter') ?? undefined
      : undefined;
  const baseUrl = existing.llm?.ollama?.baseUrl;

  const { getModelChoices } = await import('../llm/model-catalog');
  const choices = await getModelChoices(provider, { apiKey, baseUrl });
  if (choices.length === 0) {
    clack.log.error('No models available for this provider.');
    return;
  }

  const model = await pickModel({
    message: `Pick a model (${choices.length} available, type to filter)`,
    models: choices,
    currentValue: current,
  });
  if (!model) { clack.cancel('Cancelled.'); return; }

  persistAndAnnounce(profileName, existing, {
    llm: buildLlmConfigForModel(provider, model, existing),
  });
}

async function runTokenOnly(profileName: string, existing: NonNullable<ReturnType<typeof loadProfile>>): Promise<void> {
  const provider = existing.llm?.provider;
  if (!provider) {
    clack.log.error('No provider configured — run `neurobase setup llm` first.');
    return;
  }
  if (provider === 'ollama') {
    clack.log.info('Ollama has no API token. Edit the base URL with `neurobase setup llm` instead.');
    return;
  }

  // Collect just the key + verify, keep model untouched.
  const validator =
    provider === 'anthropic'
      ? verifyAnthropicKey
      : provider === 'openai'
        ? verifyOpenAIKey
        : verifyOpenRouterKey;

  const apiKey = await clack.password({
    message: `New ${provider} API key`,
    mask: '*',
    validate: (val) => (val ? undefined : 'API key is required'),
  });
  if (clack.isCancel(apiKey)) { clack.cancel('Cancelled.'); return; }

  const spin = clack.spinner();
  spin.start('Validating key');
  const verdict = await validator(apiKey as string);
  if (verdict.ok) {
    spin.stop(`Key verified — ${verdict.detail}`);
  } else {
    spin.stop(colors.dim(`Validation failed: ${verdict.detail}`));
    const cont = await clack.confirm({ message: 'Save anyway?', initialValue: false });
    if (clack.isCancel(cont) || !cont) return;
  }

  setCredential(provider as 'anthropic' | 'openai' | 'openrouter', apiKey as string);
  clack.outro(chalk.green('Token updated.') + colors.dim(` Profile: ${profileName}`));
}

async function runFeaturesOnly(profileName: string, existing: NonNullable<ReturnType<typeof loadProfile>>): Promise<void> {
  const features = await pickFeatures(existing.features);
  if (!features) { clack.cancel('Cancelled.'); return; }

  persistAndAnnounce(profileName, existing, { features });
}

async function runPrivacyOnly(profileName: string, existing: NonNullable<ReturnType<typeof loadProfile>>): Promise<void> {
  const privacy = await pickPrivacy(existing.security?.privacyMode);
  if (!privacy) { clack.cancel('Cancelled.'); return; }

  persistAndAnnounce(profileName, existing, { security: { privacyMode: privacy } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Picker helpers — extracted so each section reuses them
// ─────────────────────────────────────────────────────────────────────────────

async function pickProvider(current?: LLMProviderName): Promise<LLMProviderName | null> {
  const sel = await clack.select<LLMProviderName>({
    message: 'LLM provider',
    options: [
      { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'recommended' },
      { value: 'openai', label: 'OpenAI (GPT)' },
      { value: 'openrouter', label: 'OpenRouter', hint: 'one key, hundreds of models' },
      { value: 'ollama', label: 'Ollama (local)', hint: 'no API key, no data leaves' },
    ],
    initialValue: current,
  });
  if (clack.isCancel(sel)) return null;
  return sel;
}

async function pickPrivacy(current?: 'strict' | 'schema-only' | 'permissive'): Promise<'strict' | 'schema-only' | 'permissive' | null> {
  const sel = await clack.select<'strict' | 'schema-only' | 'permissive'>({
    message: 'Privacy mode',
    options: [
      { value: 'schema-only', label: 'Schema-only', hint: 'default — schema OK, no row data sent to LLM' },
      { value: 'strict', label: 'Strict', hint: 'nothing leaves your machine (local LLM required)' },
      { value: 'permissive', label: 'Permissive', hint: 'send samples for best accuracy' },
    ],
    initialValue: current ?? 'schema-only',
  });
  if (clack.isCancel(sel)) return null;
  return sel;
}

async function pickFeatures(current?: NonNullable<ReturnType<typeof loadProfile>>['features']): Promise<NonNullable<ReturnType<typeof loadProfile>>['features'] | null> {
  const initialValues: string[] = [];
  if (current?.enableLearning ?? true) initialValues.push('learning');
  if (current?.enableOptimization ?? true) initialValues.push('optimization');
  if (current?.enableSelfCorrection ?? true) initialValues.push('self-correction');
  if (current?.enableMultiCandidate) initialValues.push('multi-candidate');

  const sel = await clack.multiselect({
    message: 'Features',
    options: [
      { value: 'learning', label: 'Learning', hint: 'remember query patterns' },
      { value: 'optimization', label: 'Query optimization' },
      { value: 'self-correction', label: 'Self-correction', hint: 'auto-fix failed queries' },
      { value: 'multi-candidate', label: 'Multi-candidate', hint: 'extra LLM cost, better accuracy' },
    ],
    initialValues,
    required: false,
  });
  if (clack.isCancel(sel)) return null;
  const list = sel as string[];
  return {
    enableLearning: list.includes('learning'),
    enableOptimization: list.includes('optimization'),
    enableSelfCorrection: list.includes('self-correction'),
    enableMultiCandidate: list.includes('multi-candidate'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge + persist
// ─────────────────────────────────────────────────────────────────────────────

function buildLlmConfig(provider: LLMProviderName, llm: LLMResult): PartialLLMConfig {
  const cfg: PartialLLMConfig = { provider };
  if (provider === 'anthropic') cfg.anthropic = { model: llm.model };
  else if (provider === 'openai') cfg.openai = { model: llm.model };
  else if (provider === 'openrouter') cfg.openrouter = { model: llm.model };
  else cfg.ollama = { model: llm.model, baseUrl: llm.baseUrl };
  return cfg;
}

function buildLlmConfigForModel(
  provider: LLMProviderName,
  model: string,
  existing: NonNullable<ReturnType<typeof loadProfile>>,
): PartialLLMConfig {
  const cfg: PartialLLMConfig = { provider };
  // Preserve all existing settings for the active provider, only swap the model.
  const slot = existing.llm?.[provider as 'anthropic' | 'openai' | 'openrouter' | 'ollama'];
  if (provider === 'anthropic') cfg.anthropic = { ...slot, model };
  else if (provider === 'openai') cfg.openai = { ...slot, model };
  else if (provider === 'openrouter') cfg.openrouter = { ...slot, model };
  else cfg.ollama = { ...slot, model };
  return cfg;
}

function getCredentialUpdate(provider: LLMProviderName, llm: LLMResult): { provider: 'anthropic' | 'openai' | 'openrouter'; key: string } | null {
  if (provider === 'ollama' || !llm.apiKey) return null;
  return { provider: provider as 'anthropic' | 'openai' | 'openrouter', key: llm.apiKey };
}

function getCurrentModelFromProfile(profile: NonNullable<ReturnType<typeof loadProfile>>): string | undefined {
  const p = profile.llm?.provider;
  if (!p) return undefined;
  return profile.llm?.[p]?.model;
}

function maskDbUrl(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

function persistAndAnnounce(
  profileName: string,
  existing: ReturnType<typeof loadProfile>,
  patch: Partial<{
    database: NonNullable<ReturnType<typeof loadProfile>>['database'];
    llm: PartialLLMConfig;
    features: NonNullable<ReturnType<typeof loadProfile>>['features'];
    security: NonNullable<ReturnType<typeof loadProfile>>['security'];
  }>,
  credential?: { provider: 'anthropic' | 'openai' | 'openrouter'; key: string } | null,
  announce: boolean = true,
): void {
  const spin = clack.spinner();
  spin.start('Saving profile');

  // Shallow merge — we re-state every field saveProfile knows about so that
  // missing fields don't accidentally clear the registry or the LLM config.
  const merged = {
    database: patch.database ?? existing?.database,
    databases: existing?.databases,
    activeDatabase: existing?.activeDatabase,
    llm: patch.llm ?? existing?.llm,
    features: patch.features ?? existing?.features,
    security: patch.security ?? existing?.security,
  };
  saveProfile(profileName, merged);
  setActiveProfile(profileName);

  if (credential) setCredential(credential.provider, credential.key);

  spin.stop('Profile saved');
  if (announce) {
    clack.outro(
      chalk.green('Setup complete.') +
        colors.dim(` Profile: ${profileName} · Run `) +
        colors.accent('neurobase') +
        colors.dim(' to start.'),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-flows
// ─────────────────────────────────────────────────────────────────────────────

interface LLMResult {
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

async function collectLLM(provider: LLMProviderName): Promise<LLMResult | CancelResult> {
  if (provider === 'anthropic') {
    return collectKeyedProvider({
      label: 'Anthropic API key',
      placeholder: 'sk-ant-...',
      validate: verifyAnthropicKey,
      models: ANTHROPIC_MODELS,
    });
  }
  if (provider === 'openai') {
    return collectKeyedProvider({
      label: 'OpenAI API key',
      placeholder: 'sk-...',
      validate: verifyOpenAIKey,
      models: OPENAI_MODELS,
    });
  }
  if (provider === 'openrouter') {
    return collectOpenRouter();
  }
  return collectOllama();
}

async function collectKeyedProvider(opts: {
  label: string;
  placeholder: string;
  validate: (key: string) => Promise<{ ok: boolean; detail: string }>;
  models: ModelOption[];
}): Promise<LLMResult | CancelResult> {
  const apiKey = await clack.password({
    message: opts.label,
    mask: '*',
    validate: (val) => (val ? undefined : 'API key is required'),
  });
  if (clack.isCancel(apiKey)) return cancelled();

  const spin = clack.spinner();
  spin.start('Validating key');
  const verdict = await opts.validate(apiKey as string);
  if (verdict.ok) {
    spin.stop(`Key verified — ${verdict.detail}`);
  } else {
    spin.stop(colors.dim(`Validation failed: ${verdict.detail}`));
    const cont = await clack.confirm({
      message: 'Continue anyway and save this key?',
      initialValue: false,
    });
    if (clack.isCancel(cont) || !cont) return cancelled();
  }

  const model = await pickModel({ models: opts.models });
  if (!model) return cancelled();

  return { apiKey: apiKey as string, model };
}

async function collectOpenRouter(): Promise<LLMResult | CancelResult> {
  const apiKey = await clack.password({
    message: 'OpenRouter API key',
    mask: '*',
    validate: (val) => (val ? undefined : 'API key is required'),
  });
  if (clack.isCancel(apiKey)) return cancelled();

  const spin = clack.spinner();
  spin.start('Validating key and fetching models');

  const verdict = await verifyOpenRouterKey(apiKey as string);
  if (!verdict.ok) {
    spin.stop(colors.dim(`Validation failed: ${verdict.detail}`));
    const cont = await clack.confirm({
      message: 'Continue anyway and save this key?',
      initialValue: false,
    });
    if (clack.isCancel(cont) || !cont) return cancelled();
  }

  let modelOptions: ModelOption[] = [
    { value: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5', hint: 'recommended' },
    { value: 'openai/gpt-4o', label: 'openai/gpt-4o' },
    { value: 'google/gemini-2.0-flash-001', label: 'google/gemini-2.0-flash-001' },
    { value: 'meta-llama/llama-3.3-70b-instruct', label: 'meta-llama/llama-3.3-70b-instruct' },
  ];

  try {
    const fetched = await OpenRouterProvider.listModels(apiKey as string);
    if (fetched.length > 0) {
      // Pass the full catalogue (not just top 30) — the searchable picker
      // makes large lists usable.
      modelOptions = fetched.map((m) => ({
        value: m.id,
        label: m.name || m.id,
        hint: m.context_length ? `${Math.round(m.context_length / 1000)}k ctx` : undefined,
      }));
      spin.stop(`${fetched.length} models available — type to filter`);
    } else {
      spin.stop('Using fallback model list');
    }
  } catch {
    spin.stop('Using fallback model list');
  }

  const model = await pickModel({ models: modelOptions });
  if (!model) return cancelled();

  return { apiKey: apiKey as string, model };
}

async function collectOllama(): Promise<LLMResult | CancelResult> {
  const baseUrl = await clack.text({
    message: 'Ollama base URL',
    placeholder: 'http://localhost:11434',
    defaultValue: 'http://localhost:11434',
  });
  if (clack.isCancel(baseUrl)) return cancelled();

  const spin = clack.spinner();
  spin.start('Checking Ollama reachability');
  const probe = await verifyOllamaReachable(baseUrl as string);
  if (probe.ok) {
    spin.stop(`Reachable — ${probe.detail}`);
  } else {
    spin.stop(colors.dim(`Not reachable: ${probe.detail}`));
    const cont = await clack.confirm({
      message: 'Continue anyway?',
      initialValue: false,
    });
    if (clack.isCancel(cont) || !cont) return cancelled();
  }

  const modelOptions: ModelOption[] =
    probe.models && probe.models.length > 0
      ? probe.models.map((m) => ({ value: m, label: m }))
      : OLLAMA_MODELS_SUGGESTED;

  const model = await pickModel({ models: modelOptions });
  if (!model) return cancelled();

  return { model, baseUrl: baseUrl as string };
}

interface DBResult {
  engine: NonNullable<PartialDatabaseConfig['engine']>;
  url: string;
}

async function collectDatabase(): Promise<DBResult | CancelResult> {
  const engine = await clack.select<NonNullable<PartialDatabaseConfig['engine']>>({
    message: 'Database engine',
    options: [
      { value: 'postgresql', label: 'PostgreSQL', hint: 'recommended' },
      { value: 'mysql', label: 'MySQL' },
      { value: 'sqlite', label: 'SQLite', hint: 'local file' },
      { value: 'mongodb', label: 'MongoDB', hint: 'experimental' },
    ],
  });
  if (clack.isCancel(engine)) return cancelled();

  let url: string;
  if (engine === 'sqlite') {
    const filePath = await clack.text({
      message: 'SQLite file path',
      placeholder: './data/neurobase.db',
      defaultValue: './data/neurobase.db',
    });
    if (clack.isCancel(filePath)) return cancelled();
    url = filePath as string;
  } else {
    const defaultUrl =
      engine === 'postgresql'
        ? 'postgresql://user:password@localhost:5432/mydb'
        : engine === 'mysql'
          ? 'mysql://user:password@localhost:3306/mydb'
          : 'mongodb://localhost:27017/mydb';
    const dbUrl = await clack.text({
      message: 'Connection URL',
      placeholder: defaultUrl,
      validate: (val) => (val ? undefined : 'Connection URL is required'),
    });
    if (clack.isCancel(dbUrl)) return cancelled();
    url = dbUrl as string;
  }

  // Auto-encode raw special characters in the password (Supabase, Render and
  // others commonly hand out passwords with $, @, : which break URL parsing).
  // No prompt — just rewrite, note it, and continue.
  const { normalized, changed } = normalizeDbUrl(engine, url);
  if (changed) {
    clack.log.info('Password URL-encoded automatically');
    url = normalized;
  }

  // Pre-flight: catch obvious shape problems before the connection attempt.
  const shape = validateDbUrlShape(engine, url);
  if (shape) {
    if (shape.level === 'error') {
      clack.log.error(shape.message);
      const cont = await clack.confirm({
        message: 'Continue anyway?',
        initialValue: false,
      });
      if (clack.isCancel(cont) || !cont) return cancelled();
    } else {
      clack.log.warn(shape.message);
    }
  }

  const spin = clack.spinner();
  spin.start('Testing connection');
  const verdict = await testDatabase(engine, url);
  if (verdict.ok) {
    spin.stop(`Database reachable — ${verdict.detail}`);
  } else {
    spin.stop(colors.dim(`Connection failed: ${verdict.detail}`));
    const cont = await clack.confirm({
      message: 'Save anyway and proceed?',
      initialValue: false,
    });
    if (clack.isCancel(cont) || !cont) return cancelled();
  }

  return { engine, url };
}
