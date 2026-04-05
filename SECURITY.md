# Security Policy

## Supported Versions

NeuroBase follows semantic versioning. Security fixes are backported to the latest
minor release of the current major version.

| Version | Supported          |
|---------|--------------------|
| 3.x     | :white_check_mark: |
| < 3.0   | :x:                |

## Reporting a Vulnerability

If you believe you have found a security vulnerability in NeuroBase, please report
it privately. **Do not file a public GitHub issue.**

- Email: **security@neurobase.dev** (or open a private security advisory on GitHub)
- Include: affected version, reproduction steps, impact assessment, suggested fix if any
- Response window: acknowledgement within 72 hours, triage within 7 days

We follow coordinated disclosure: we'll work with you on a fix timeline and credit
you in the release notes once a fix is published, unless you prefer to remain
anonymous.

## Threat Model Summary

NeuroBase is a natural-language interface to user-controlled databases. The
primary trust boundaries are:

| Boundary | Surface | Mitigation |
|---|---|---|
| **NL → SQL** | User-typed query reaches an LLM | `src/security/sql-parser.ts` — AST validation, dangerous-pattern blocking |
| **SQL → DB** | Generated SQL executes against a real database | Parameterized execution, query timeout, `READONLY_MODE` |
| **DB → LLM** | Schema and rows can be sent to a 3rd-party LLM | `src/security/privacy-guard.ts` — `strict`/`schema-only`/`permissive` modes |
| **External LLM** | Prompts traverse Anthropic / OpenAI APIs | Privacy mode + `ollama` provider for fully-local operation |
| **Multi-agent forks** | Agents operate on isolated database copies | `src/database/fork.ts` |

## Built-in Protections

- **SQL injection prevention** — parameterized queries everywhere; AST-based
  pattern detection in `src/security/sql-parser.ts`.
- **Dangerous query blocking** — `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without
  `WHERE` are rejected before execution.
- **Privacy modes** — three-tier data control prevents sensitive data from
  leaving the machine:
  - `strict`: nothing reaches the LLM (local providers only).
  - `schema-only` (default): schema OK, row data blocked.
  - `permissive`: full access, opt-in only.
- **Read-only mode** — restrict to `SELECT` queries (`READONLY_MODE=true`).
- **Rate limiting** — configurable per endpoint (default 100/15 min).
- **Query timeout** — configurable maximum (default 30s).
- **Fork isolation** — agents operate on database copies, not the primary.
- **Immutable audit log** — append-only; `UPDATE`/`DELETE` revoked at the SQL
  privilege level (`sql/audit.sql`).
- **Non-root container** — Docker image runs as unprivileged `neurobase` user.

## Hardening Recommendations

For production deployments:

- Use a dedicated database role with only the privileges NeuroBase needs.
- Enable `READONLY_MODE=true` if read-only is acceptable for your use case.
- Pin `PRIVACY_MODE=strict` and route to a local LLM (Ollama) for sensitive data.
- Enable SSL (`DB_SSL_ENABLED=true`, `DB_SSL_REJECT_UNAUTHORIZED=true`).
- Set conservative `MAX_QUERY_TIME` and `API_RATE_LIMIT` values.
- Monitor the audit log; treat any failed audit-table mutation as an alert.

## Out of Scope

- Cryptographic guarantees against a malicious LLM provider — we minimize what
  is sent, but a compromised provider with `permissive` mode could observe data.
- Side-channel inference from query timing or row counts.
- Vulnerabilities in third-party LLM providers themselves.
