/**
 * Profile store — persists NeuroBase profiles under ~/.neurobase/profiles/<name>.json
 *
 * A profile is a partial Config: any field present overrides the .env / default.
 * Multiple profiles let users keep separate configurations (e.g. `default`,
 * `prod`, `sandbox`). The active profile name lives in ~/.neurobase/.active.
 *
 * Credentials are stored separately via credential-store.ts so this file can
 * be checked in / shared without leaking secrets.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LLMProviderName } from '../types';

export interface PartialDatabaseConfig {
  engine?: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb';
  connectionString?: string;
  ssl?: { enabled?: boolean; rejectUnauthorized?: boolean };
  pool?: { max?: number; idleTimeoutMillis?: number; connectionTimeoutMillis?: number };
}

/**
 * A named database the profile knows about. Stored under
 * profile.databases[name]. The profile points to the currently active one
 * via profile.activeDatabase. Switching is a matter of changing that pointer.
 */
export interface NamedDatabase {
  engine: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb';
  connectionString: string;
  ssl?: { enabled?: boolean; rejectUnauthorized?: boolean };
  pool?: { max?: number; idleTimeoutMillis?: number; connectionTimeoutMillis?: number };
  addedAt?: string;
}

export interface PartialLLMSlot {
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
  appName?: string;
  appUrl?: string;
}

export interface PartialLLMConfig {
  provider?: LLMProviderName;
  openai?: PartialLLMSlot;
  anthropic?: PartialLLMSlot;
  openrouter?: PartialLLMSlot;
  ollama?: PartialLLMSlot;
}

export interface Profile {
  version: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Legacy single-database slot — kept for backwards compatibility. */
  database?: PartialDatabaseConfig;
  /** Registry of named databases the user can switch between. */
  databases?: Record<string, NamedDatabase>;
  /** Name of the database currently active (key into `databases`). */
  activeDatabase?: string;
  llm?: PartialLLMConfig;
  features?: {
    enableLearning?: boolean;
    enableOptimization?: boolean;
    enableSchemaSuggestions?: boolean;
    enableQueryCache?: boolean;
    enableSelfCorrection?: boolean;
    enableMultiCandidate?: boolean;
  };
  security?: {
    privacyMode?: 'strict' | 'schema-only' | 'permissive';
    readonlyMode?: boolean;
    permissionLevel?: 'read-only' | 'write' | 'ddl' | 'admin';
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Database registry helpers — used by setup-wizard and the REPL /db command.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the currently-active database entry for a profile, taking the
 * legacy single-slot path into account. Returns null if neither is set.
 */
export function getActiveDatabase(profile: Profile | null): NamedDatabase | null {
  if (!profile) return null;
  if (profile.activeDatabase && profile.databases?.[profile.activeDatabase]) {
    return profile.databases[profile.activeDatabase];
  }
  // Migration path: fall back to the legacy single-DB slot.
  if (profile.database?.engine && profile.database.connectionString) {
    return {
      engine: profile.database.engine,
      connectionString: profile.database.connectionString,
      ssl: profile.database.ssl,
      pool: profile.database.pool,
    };
  }
  return null;
}

export function listDatabases(profile: Profile | null): Array<{ name: string; entry: NamedDatabase }> {
  if (!profile) return [];
  const items: Array<{ name: string; entry: NamedDatabase }> = [];
  if (profile.databases) {
    for (const [name, entry] of Object.entries(profile.databases)) {
      items.push({ name, entry });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export function addDatabase(profileName: string, dbName: string, entry: NamedDatabase): Profile {
  const existing = loadProfile(profileName) ?? makeEmptyProfile(profileName);
  existing.databases = existing.databases ?? {};
  existing.databases[dbName] = { ...entry, addedAt: entry.addedAt ?? new Date().toISOString() };
  // First DB added automatically becomes active.
  if (!existing.activeDatabase) existing.activeDatabase = dbName;
  return persistProfile(profileName, existing);
}

export function removeDatabase(profileName: string, dbName: string): Profile | null {
  const existing = loadProfile(profileName);
  if (!existing?.databases?.[dbName]) return null;
  delete existing.databases[dbName];
  if (existing.activeDatabase === dbName) {
    const remaining = Object.keys(existing.databases);
    existing.activeDatabase = remaining[0];
  }
  return persistProfile(profileName, existing);
}

export function setActiveDatabase(profileName: string, dbName: string): Profile | null {
  const existing = loadProfile(profileName);
  if (!existing?.databases?.[dbName]) return null;
  existing.activeDatabase = dbName;
  return persistProfile(profileName, existing);
}

function makeEmptyProfile(name: string): Profile {
  const now = new Date().toISOString();
  return { version: 1, name, createdAt: now, updatedAt: now };
}

function persistProfile(name: string, profile: Profile): Profile {
  const dir = getProfilesDir();
  fs.mkdirSync(dir, { recursive: true });
  profile.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(profile, null, 2), 'utf-8');
  return profile;
}

/**
 * Resolve the directory that holds NeuroBase profiles + credentials.
 *
 * Honours the `NEUROBASE_HOME` env var when set — primarily used by tests so
 * they don't write under the developer's real home directory. Falls back to
 * `~/.neurobase` for normal use.
 */
function getNeurobaseHome(): string {
  return process.env.NEUROBASE_HOME || path.join(os.homedir(), '.neurobase');
}

export function getProfilesDir(): string {
  return path.join(getNeurobaseHome(), 'profiles');
}

function getActiveFile(): string {
  return path.join(getNeurobaseHome(), '.active');
}

export function getActiveProfileName(): string {
  try {
    const f = getActiveFile();
    if (fs.existsSync(f)) {
      const name = fs.readFileSync(f, 'utf-8').trim();
      if (name) return name;
    }
  } catch { /* ignore */ }
  return 'default';
}

export function setActiveProfile(name: string): void {
  const file = getActiveFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, name, 'utf-8');
}

export function listProfiles(): string[] {
  const dir = getProfilesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

export function loadProfile(name?: string): Profile | null {
  const profileName = name ?? getActiveProfileName();
  const file = path.join(getProfilesDir(), `${profileName}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

export function saveProfile(name: string, partial: Omit<Profile, 'version' | 'name' | 'createdAt' | 'updatedAt'>): Profile {
  const dir = getProfilesDir();
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `${name}.json`);
  const existing = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as Profile)
    : null;

  const now = new Date().toISOString();
  const profile: Profile = {
    version: 1,
    name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...partial,
  };

  fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf-8');
  return profile;
}

export function deleteProfile(name: string): boolean {
  const file = path.join(getProfilesDir(), `${name}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
