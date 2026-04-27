/**
 * Database connection URL helpers — pure string functions, no IO.
 *
 * Extracted from setup-wizard.ts so they can be unit-tested without dragging
 * the entire UI stack (clack, inquirer, gradient) into Jest's module graph.
 *
 * Three responsibilities:
 *   1. normalizeDbUrl   — auto-encode special chars in the password
 *   2. validateDbUrlShape — pre-flight sanity check (scheme, format, file path)
 *   3. formatDbError    — engine-aware, provider-aware error translator
 */

import * as fs from 'fs';
import * as path from 'path';

export type DbEngine = 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | undefined;

// ─────────────────────────────────────────────────────────────────────────────
// 1. normalizeDbUrl — auto-encode special chars in the password section.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auto-encode the password section of a connection URL.
 *
 * Many users paste Supabase / Render / Railway / Atlas connection strings with
 * raw special characters in the password ($, @, :, /, …). Those break the URL
 * parser. Rather than asking the user to fix it, we detect a raw password
 * and URL-encode it automatically.
 *
 * Engines:
 *  - postgresql / mysql / mongodb / mongodb+srv : password section is encoded
 *  - sqlite : not a URL, returned as-is
 *
 * If the password already contains `%xx` sequences, assume it is already
 * encoded and do nothing — prevents double-encoding.
 */
export function normalizeDbUrl(
  engine: DbEngine,
  url: string,
): { normalized: string; changed: boolean } {
  if (engine === 'sqlite') return { normalized: url, changed: false };

  // Allow `mongodb+srv://` as a valid scheme (the `+` is the only non-alpha
  // character that appears in real-world DB URL schemes).
  const schemeMatch = url.match(/^([a-z]+(?:\+[a-z]+)?:\/\/)(.*)$/i);
  if (!schemeMatch) return { normalized: url, changed: false };
  const [, scheme, rest] = schemeMatch;

  // The password ends at the LAST "@" so an unescaped @ inside the password
  // (or a comma-separated host list for Mongo) doesn't trip us.
  //
  // For Mongo URLs with multi-host (host1,host2), the @ separator is still
  // singular: `user:pass@host1,host2/db`. The comma is in the host part, not
  // userinfo, so this stays correct.
  const lastAt = rest.lastIndexOf('@');
  if (lastAt < 0) return { normalized: url, changed: false };

  const userinfo = rest.slice(0, lastAt);
  const hostpart = rest.slice(lastAt); // keeps the leading '@'

  const firstColon = userinfo.indexOf(':');
  if (firstColon < 0) return { normalized: url, changed: false };

  const user = userinfo.slice(0, firstColon);
  const password = userinfo.slice(firstColon + 1);
  if (!password) return { normalized: url, changed: false };

  // Already percent-encoded → assume the user encoded on purpose.
  if (/%[0-9a-fA-F]{2}/.test(password)) return { normalized: url, changed: false };

  const encoded = encodeURIComponent(password);
  if (encoded === password) return { normalized: url, changed: false };

  return { normalized: `${scheme}${user}:${encoded}${hostpart}`, changed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. validateDbUrlShape — pre-flight check, no IO except SQLite stat.
// ─────────────────────────────────────────────────────────────────────────────

export interface ShapeIssue {
  level: 'warn' | 'error';
  message: string;
}

/**
 * Verify the URL / file path is structurally compatible with the chosen
 * engine. Returns null if everything looks fine; otherwise an issue with a
 * level — warnings are advisory, errors should block the connection attempt.
 *
 * This runs BEFORE the connection attempt to save a round-trip on obvious
 * mistakes (wrong scheme for the engine, sqlite parent dir missing, etc.).
 */
export function validateDbUrlShape(engine: DbEngine, url: string): ShapeIssue | null {
  if (!engine) return { level: 'error', message: 'engine is required' };
  if (!url || !url.trim()) return { level: 'error', message: 'connection string is empty' };

  if (engine === 'sqlite') {
    const abs = path.resolve(url);
    const parent = path.dirname(abs);
    if (!fs.existsSync(parent)) {
      return {
        level: 'warn',
        message: `Parent directory does not exist: ${parent} — it will need to be created before SQLite can open the file.`,
      };
    }
    try {
      fs.accessSync(parent, fs.constants.W_OK);
    } catch {
      return {
        level: 'error',
        message: `Cannot write to parent directory: ${parent}`,
      };
    }
    return null;
  }

  // URL-based engines.
  if (engine === 'postgresql') {
    if (!/^postgres(ql)?:\/\//i.test(url)) {
      return {
        level: 'error',
        message: 'PostgreSQL URL must start with postgresql:// or postgres://',
      };
    }
  } else if (engine === 'mysql') {
    if (!/^mysql:\/\//i.test(url)) {
      return { level: 'error', message: 'MySQL URL must start with mysql://' };
    }
  } else if (engine === 'mongodb') {
    if (!/^mongodb(\+srv)?:\/\//i.test(url)) {
      return {
        level: 'error',
        message: 'MongoDB URL must start with mongodb:// or mongodb+srv://',
      };
    }
  }

  // Common: there must be a non-empty host segment between :// and the next
  // /, ?, or #. The Node URL parser silently rewrites `scheme:///path` to
  // hostname=first-path-segment, so we can't rely on it for this check.
  const hostMatch = url.match(/^[a-z+]+:\/\/(?:[^@/?#]+@)?([^/?#\s]*)/i);
  if (!hostMatch || !hostMatch[1]) {
    return { level: 'error', message: 'URL is missing a host component' };
  }
  if (/\s/.test(url)) {
    return { level: 'error', message: 'URL contains whitespace — check for missing @, /, or pasted line breaks' };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. formatDbError — engine-aware, provider-aware error translator.
// ─────────────────────────────────────────────────────────────────────────────

interface DriverError {
  code?: string;
  errno?: number;
  hostname?: string;
  syscall?: string;
  name?: string;
}

/**
 * Translate driver-specific errors into actionable messages, with provider-
 * specific hints when we recognize the host or error signature.
 */
export function formatDbError(engine: DbEngine, err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & DriverError;
  const msg = err.message;

  // DNS layer — applies to all networked engines.
  if (e.code === 'ENOTFOUND' || /ENOTFOUND/.test(msg)) {
    const host = e.hostname ?? extractHost(msg) ?? 'unknown';
    return dnsHint(engine, host);
  }
  if (e.code === 'ETIMEDOUT' || /ETIMEDOUT/.test(msg)) {
    return `connection timed out reaching ${e.hostname ?? 'the host'} — firewall, IP allow-list, or VPN may be blocking the port`;
  }
  if (e.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
    return `connection refused — the host is reachable but the port is closed (server not running, or wrong port)`;
  }
  if (e.code === 'ECONNRESET' || /ECONNRESET/.test(msg)) {
    return `connection reset — often a TLS misconfig (try adding ?sslmode=require for postgres)`;
  }

  // Self-signed certificate (Supabase pooler, some managed DBs, internal CAs).
  // Most node drivers surface this as code SELF_SIGNED_CERT_IN_CHAIN.
  if (
    e.code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    /self-signed certificate|unable to verify the first certificate/i.test(msg)
  ) {
    return (
      'TLS verification failed — the server uses a self-signed or non-public certificate. ' +
      'This is normal for Supabase pooler, some internal databases, and self-hosted setups. ' +
      'Re-run with `DB_SSL_REJECT_UNAUTHORIZED=false`, or add `?sslmode=no-verify` to the URL ' +
      '(NeuroBase relaxes verification automatically for known managed providers).'
    );
  }

  // Auth — engine-specific phrasing.
  if (engine === 'postgresql') {
    if (/password authentication failed/i.test(msg)) {
      return 'password rejected by PostgreSQL — verify the password is correct';
    }
    if (/no pg_hba\.conf entry/i.test(msg)) {
      return 'PostgreSQL is rejecting this client IP — check pg_hba.conf or the cloud provider IP allow-list';
    }
    if (/database "[^"]+" does not exist/i.test(msg)) {
      return msg + ' — fix the database name at the end of the URL';
    }
    if (/SSL/i.test(msg) && /required/i.test(msg)) {
      return 'PostgreSQL server requires SSL — append ?sslmode=require to the URL';
    }
  }
  if (engine === 'mysql') {
    if (/Access denied for user/i.test(msg)) {
      return 'MySQL rejected the credentials — verify user/password and that the user has access from this host';
    }
    if (/Unknown database/i.test(msg)) {
      return msg + ' — fix the database name at the end of the URL';
    }
    if (/ER_NOT_SUPPORTED_AUTH_MODE/i.test(msg)) {
      return 'MySQL auth plugin mismatch (caching_sha2_password) — upgrade mysql2 or change the user to mysql_native_password';
    }
  }
  if (engine === 'sqlite') {
    if (/SQLITE_CANTOPEN/i.test(msg) || /unable to open database file/i.test(msg)) {
      return msg + ' — verify the parent directory exists and is writable';
    }
    if (/SQLITE_BUSY/i.test(msg) || /database is locked/i.test(msg)) {
      return 'database file is locked by another process';
    }
    if (e.code === 'EACCES' || /EACCES/.test(msg)) {
      return 'permission denied on the SQLite file — check filesystem permissions';
    }
  }
  if (engine === 'mongodb') {
    if (/Authentication failed/i.test(msg)) {
      return 'MongoDB authentication failed — verify user, password, and the authSource (?authSource=admin is common)';
    }
    if (/MongoNetworkError|MongoServerSelectionError/.test(e.name ?? '') || /ServerSelection/i.test(msg)) {
      return 'MongoDB cluster unreachable — check the cluster is running, the URL is correct, and Atlas IP allow-list includes your IP';
    }
    if (/querySrv ENOTFOUND/i.test(msg)) {
      return 'SRV record lookup failed for an mongodb+srv:// URL — check the cluster hostname spelling';
    }
  }

  return msg;
}

function extractHost(msg: string): string | null {
  const m = msg.match(/(?:getaddrinfo|querySrv|hostname)[^a-z0-9_.-]+([a-z0-9][a-z0-9.-]+\.[a-z]{2,})/i);
  return m ? m[1] : null;
}

/**
 * Some managed providers ship self-signed or non-public-CA certificates
 * (Supabase pooler being the most common). Driver TLS verification has to
 * be relaxed for these. Returns true when the URL host looks like one we
 * know needs `rejectUnauthorized: false`.
 *
 * This is deliberately conservative: only matches host suffixes we have
 * observed to require relaxation. Falls back to the user's explicit
 * setting otherwise.
 */
export function shouldRelaxTls(url: string): boolean {
  const hostMatch = url.match(/^[a-z+]+:\/\/(?:[^@/?#]+@)?([^:/?#\s]+)/i);
  if (!hostMatch) return false;
  const host = hostMatch[1].toLowerCase();
  return (
    /\.pooler\.supabase\.com$/.test(host) ||
    /\.supabase\.co$/.test(host) ||
    /\.supabase\.net$/.test(host)
  );
}

function dnsHint(engine: DbEngine, host: string): string {
  // PostgreSQL — known managed providers.
  if (engine === 'postgresql') {
    // Supabase direct URL — deprecated for IPv4 since 2024.
    const supa = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (supa) {
      const ref = supa[1];
      return (
        `Supabase direct host "${host}" has no public IPv4 DNS. Use the Connection Pooler URL instead:\n` +
        `  postgresql://postgres.${ref}:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres\n` +
        `Get the exact URL from Dashboard → Settings → Database → Connection string.`
      );
    }
    // Neon — endpoint name is project-specific, hint if hostname suggests a typo.
    if (/\.neon\.tech$/i.test(host)) {
      return (
        `Neon endpoint "${host}" not found. Either the endpoint is suspended ` +
        `(free tier sleeps after 5 min of inactivity — the next connection wakes it) ` +
        `or the hostname has a typo. Verify in Neon Console → Connection Details.`
      );
    }
    // Heroku — needs SSL almost always.
    if (/\.amazonaws\.com$/i.test(host) || /\.compute-1\.amazonaws\.com$/i.test(host)) {
      return (
        `host not found (${host}) — if this is Heroku Postgres, verify the URL ` +
        `is still valid (Heroku rotates credentials periodically).`
      );
    }
  }

  // MySQL — PlanetScale, RDS.
  if (engine === 'mysql') {
    if (/\.psdb\.cloud$/i.test(host) || /\.connect\.psdb\.cloud$/i.test(host)) {
      return (
        `PlanetScale host "${host}" not found. PlanetScale shut down its free MySQL ` +
        `service in April 2024. Migrate to Vitess, MariaDB SkySQL, AWS RDS, or another provider.`
      );
    }
  }

  // MongoDB — Atlas SRV.
  if (engine === 'mongodb') {
    if (/\.mongodb\.net$/i.test(host)) {
      return (
        `Atlas cluster "${host}" not found in DNS. Verify the cluster name is exact, ` +
        `the cluster is running (not paused), and that mongodb+srv:// scheme is used for Atlas.`
      );
    }
  }

  return `host not found (${host}) — check the hostname for typos`;
}
