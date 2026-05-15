/**
 * Service Manager — track child processes spawned from the REPL.
 *
 * The REPL needs to launch the REST API and the multi-agent server in the
 * background without polluting the prompt. This module:
 *
 *  - Spawns the right node process for each named service
 *  - Captures PID + port
 *  - Persists the registry to ~/.neurobase/services.json so a re-launched
 *    REPL can see what's already running
 *  - Pings PIDs on read to drop dead entries
 *  - Cleans up children on REPL exit
 *
 * It deliberately stays in user-land — no systemd / launchd / pm2. For
 * production deployments operators run the server commands directly under
 * their preferred supervisor.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

export type ServiceName = 'rest-api' | 'multi-agent';

export interface ServiceRecord {
  name: ServiceName;
  pid: number;
  port: number;
  startedAt: string;
  logFile: string;
}

function getNeurobaseHome(): string {
  return process.env.NEUROBASE_HOME || path.join(os.homedir(), '.neurobase');
}

function getRegistryFile(): string {
  return path.join(getNeurobaseHome(), 'services.json');
}

function getLogDir(): string {
  return path.join(getNeurobaseHome(), 'logs');
}

function getDistDir(): string {
  // `dist/` relative to the package install dir. We resolve it from the
  // location of this compiled module: dist/services/manager.js → dist/.
  return path.dirname(path.dirname(__filename));
}

function readRegistry(): ServiceRecord[] {
  const file = getRegistryFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function writeRegistry(records: ServiceRecord[]): void {
  fs.mkdirSync(getNeurobaseHome(), { recursive: true });
  fs.writeFileSync(getRegistryFile(), JSON.stringify(records, null, 2), 'utf-8');
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 doesn't actually send anything — it just checks existence.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Live in-process children spawned by this REPL session. */
const inProcessChildren = new Map<ServiceName, ChildProcess>();

/** Cross-session view: persisted registry filtered to live PIDs. */
export function listServices(): ServiceRecord[] {
  const records = readRegistry();
  const alive = records.filter((r) => isAlive(r.pid));
  if (alive.length !== records.length) writeRegistry(alive);
  return alive;
}

export function findService(name: ServiceName): ServiceRecord | null {
  return listServices().find((r) => r.name === name) ?? null;
}

export interface StartOptions {
  port?: number;
  env?: Record<string, string>;
}

/**
 * Spawn one of the known services as a detached child process. Returns the
 * resulting record. Throws if the service is already running.
 */
export function startService(name: ServiceName, opts: StartOptions = {}): ServiceRecord {
  const existing = findService(name);
  if (existing) {
    throw new Error(`Service "${name}" is already running on port ${existing.port} (pid ${existing.pid})`);
  }

  const dist = getDistDir();
  const entry =
    name === 'rest-api' ? path.join(dist, 'api.js') :
    /* multi-agent */     path.join(dist, 'multi-agent-api.js');

  if (!fs.existsSync(entry)) {
    throw new Error(
      `Compiled entry not found at ${entry}. Run \`npm run build\` first ` +
      `(or use \`npm run dev\` to skip the manager).`,
    );
  }

  fs.mkdirSync(getLogDir(), { recursive: true });
  const logFile = path.join(getLogDir(), `${name}-${Date.now()}.log`);
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  const port = opts.port ?? (name === 'rest-api' ? 3000 : 3001);
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ...(opts.env ?? {}), NEUROBASE_PORT: String(port) },
    detached: true,
    stdio: ['ignore', out, err],
  });
  child.unref();
  inProcessChildren.set(name, child);

  if (typeof child.pid !== 'number') {
    throw new Error(`Failed to spawn "${name}" — no PID returned`);
  }

  const record: ServiceRecord = {
    name,
    pid: child.pid,
    port,
    startedAt: new Date().toISOString(),
    logFile,
  };

  const records = readRegistry().filter((r) => r.name !== name);
  records.push(record);
  writeRegistry(records);
  return record;
}

/**
 * Stop a running service. Returns true if a process was killed, false if it
 * was already gone.
 */
export function stopService(name: ServiceName): boolean {
  const record = findService(name);
  if (!record) {
    // Maybe it's an in-process child that didn't make it to the registry.
    const child = inProcessChildren.get(name);
    if (child && !child.killed) {
      child.kill('SIGTERM');
      inProcessChildren.delete(name);
      return true;
    }
    return false;
  }

  try {
    process.kill(record.pid, 'SIGTERM');
  } catch { /* already dead */ }
  inProcessChildren.delete(name);
  const records = readRegistry().filter((r) => r.pid !== record.pid);
  writeRegistry(records);
  return true;
}

/** Stop every service this REPL session spawned. Called on REPL exit. */
export function stopAllInProcess(): void {
  for (const [name, child] of inProcessChildren) {
    if (!child.killed) {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    inProcessChildren.delete(name);
  }
}

export function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}
