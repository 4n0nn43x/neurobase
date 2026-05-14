# NeuroBase

**Intelligent, self-learning conversational database engine.**

NeuroBase turns any database into a system that understands natural language, generates precise SQL, learns from corrections, and gets smarter with every interaction — powered by a multi-agent architecture, RAG pipeline, and semantic intelligence layer.

```
 ███╗   ██╗███████╗██╗   ██╗██████╗  ██████╗ ██████╗  █████╗ ███████╗███████╗
 ████╗  ██║██╔════╝██║   ██║██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔════╝
 ██╔██╗ ██║█████╗  ██║   ██║██████╔╝██║   ██║██████╔╝███████║███████╗█████╗
 ██║╚██╗██║██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══██╗██╔══██║╚════██║██╔══╝
 ██║ ╚████║███████╗╚██████╔╝██║  ██║╚██████╔╝██████╔╝██║  ██║███████║███████╗
 ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝
```

---

## Why NeuroBase?

Most text-to-SQL tools generate a query and hope it works. NeuroBase takes a different approach:

- **Self-correcting** — when SQL fails, it retries with error context (up to 3 attempts with increasing temperature)
- **Value-aware** — checks if `"Electronics"` actually exists in your database before generating `WHERE category = 'Electronics'`
- **Multi-candidate** — generates 3 SQL candidates in parallel, ranks by execution cost, picks the best
- **Semantic** — auto-generates human descriptions for every table and column, so the LLM understands `amt` means "amount"
- **Schema-pruned** — for 100+ table databases, only sends relevant tables to the LLM (token budget control)
- **Privacy-first** — three modes: `strict` (nothing leaves your machine), `schema-only` (default), `permissive`
- **Learning** — stores successful translations, improves with corrections, uses temporal decay weighting

---

## Quick Start

### npx (zero install)

```bash
npx neurobase setup     # interactive configuration wizard
npx neurobase doctor    # verify environment and connectivity
npx neurobase           # start querying (interactive REPL)
```

### Install globally

```bash
npm install -g neurobase
neurobase setup
neurobase doctor
neurobase                # start querying
```

### Docker

```bash
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase
cp .env.example .env      # edit with your credentials
docker compose up
```

### From source

```bash
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase
npm install
cp .env.example .env      # edit with your credentials
npm run init              # initialize database tables
npm run dev               # start in development mode
```

---

## Features

> **Status legend** — items below are tagged `wired` (running in the default
> query pipeline), `library` (exported from the npm package for custom
> composition but not auto-wired) or `experimental` (present but not
> production-grade yet). The default `neurobase` REPL only exercises the
> `wired` items.

### Query Precision Pipeline

| Stage | Status | What it does | Inspired by |
|-------|--------|-------------|-------------|
| **Value Explorer** | wired | Verifies referenced values exist in DB before SQL generation (only when `PRIVACY_MODE=permissive`) | ReFoRCE (Snowflake) |
| **Schema Pruner** | wired | Scores tables, packs only relevant ones into a token budget | DB-GPT |
| **Multi-Candidate** | wired (opt-in) | Generates N SQL candidates, ranks by EXPLAIN cost — enable via `ENABLE_MULTI_CANDIDATE=true` | Contextual AI bird-sql |
| **Self-Correction** | wired (opt-in) | On failure, sends error + schema back to LLM for retry (3 attempts, temp 0.1→0.3→0.5) | PremSQL |
| **Result Verifier** | wired (quick mode) | Pre-execution: AST security + schema reference check. Full sandbox-execute mode is library-only. | — |
| **Permission Ladder** | wired | `read-only` < `write` < `ddl` < `admin` gate before every execution | claw-code PermissionMode |
| **Confidence Router** | library | 4-tier RAG routing (cache → few-shot → full → LLM fallback) | — |
| **Feedback Loop** | library | Temporal-decay learning weight calculation | — |
| **Vector Cache** | library | Embedding cache for similar-query reuse | — |

### Semantic Intelligence

| Component | Status | What it does | Inspired by |
|-----------|--------|-------------|-------------|
| **Auto-Catalog** | wired | LLM-generates descriptions for every table/column, persists in `neurobase_semantic_catalog` (PG only) | pgai (Timescale) |
| **Semantic Model** | wired | YAML-defined business concepts loaded from `neurobase.semantic.yml` if present | Wren AI |

### Infrastructure

| Component | Status | What it does | Inspired by |
|-----------|--------|-------------|-------------|
| **MCP Server** | wired | Tools: `query`, `schema`, `explain`, `correct`, `diagnose` — works with Claude Desktop, Cursor | DBHub |
| **Privacy Guard** | wired | `strict` / `schema-only` / `permissive` modes; gates row-data sent to the LLM | DataLine |
| **Cost Tracker** | wired | Per-provider, per-model token accounting; budget alerts; `/costs` REPL | — |
| **Explainer** | wired (opt-in) | Post-execution natural language summary | Chat2DB, Wren AI |
| **Diagnostic Tree** | wired (PG only) | Root cause analysis: seq scan → missing index → suggest CREATE INDEX | D-Bot (Tsinghua) |

### Multi-Agent System (multi-agent API only)

The `multi-agent-api` server is a separate entry point that adds the
following on top of the core. It requires PostgreSQL and an auth token
(`NEUROBASE_MULTIAGENT_TOKEN`). Most agent task handlers are **stubs**
today (results tagged `__stub: true`).

| Agent | Status | Purpose |
|-------|--------|---------|
| **Linguistic Agent** | wired | NL → SQL translation with conversation context |
| **Optimizer Agent** | wired | Execution plan analysis and query rewriting |
| **Memory Agent** | wired (PG only) | Learning storage with temporal decay weighting |
| **Schema Evolution** | library | Recommends indexes, views, partitions from query patterns |
| **Query Validator** | library | Safety checks (SQL injection, dangerous patterns) |
| **Learning Aggregator** | experimental | Cross-agent insight synthesis — exported, not yet wired |
| **A/B Testing** | experimental | Parallel strategy comparison on isolated forks — exported, not yet wired |

### Observability

| Component | Status | What it does |
|-----------|--------|-------------|
| **Cost Tracker** | wired | Token + USD accounting, daily budget alerts |
| **OpenTelemetry** | wired (opt-in) | Distributed tracing — packages are optional peer-deps |
| **Operation Supervisor** | wired | Risk classification + permission ladder + approval requests |
| **Audit Log** | wired | Append-only trail of every query (portable across all 4 engines, app-level immutability) |
| **Alert System** | library | Metric-based rules with webhook / log channels |
| **Health Monitor** | library | Agent health tracking — not wired by default |
| **Circuit Breaker** | library | LLM provider failover building blocks — not wired by default |

---

## Architecture

```
                         ┌─────────────────────┐
                         │   User Interface     │
                         │  CLI / API / MCP     │
                         └─────────┬───────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       NeuroBase Core         │
                    │                              │
                    │  ┌──────────────────────┐   │
                    │  │   Confidence Router   │   │
                    │  │  Tier 1-4 RAG routing │   │
                    │  └──────────┬───────────┘   │
                    │             │                │
                    │  ┌──────────▼───────────┐   │
                    │  │  Linguistic Agent     │   │
                    │  │  + Value Explorer     │   │
                    │  │  + Schema Pruner      │   │
                    │  │  + Semantic Context   │   │
                    │  └──────────┬───────────┘   │
                    │             │                │
                    │  ┌──────────▼───────────┐   │
                    │  │  Candidate Selector   │   │
                    │  │  (multi-SQL ranking)  │   │
                    │  └──────────┬───────────┘   │
                    │             │                │
                    │  ┌──────────▼───────────┐   │
                    │  │  Result Verifier      │   │
                    │  │  (security + sandbox) │   │
                    │  └──────────┬───────────┘   │
                    │             │                │
                    │  ┌──────────▼───────────┐   │
                    │  │  Self-Correction Loop │   │
                    │  │  (on failure, 3x)     │   │
                    │  └──────────┬───────────┘   │
                    │             │                │
                    └─────────────┼────────────────┘
                                  │
          ┌───────────────────────▼───────────────────────┐
          │                Database Layer                  │
          │  PostgreSQL │ MySQL │ SQLite │ MongoDB         │
          └───────────────────────────────────────────────┘
```

---

## Usage

### Interactive CLI

```bash
neurobase
```

The CLI features a rich terminal interface with:
- Gradient ASCII art banner
- SQL syntax highlighting in bordered panels
- Colored data tables with type-aware formatting
- Animated spinner with elapsed time
- Schema visualization with relationship arrows
- Conversation context preservation

```
  neurobase > show me the top 5 customers by total orders

  ╭── ⟩ SQL ──────────────────────────────────────────────╮
  │ SELECT c.name, COUNT(o.id) AS order_count             │
  │ FROM customers c                                      │
  │ LEFT JOIN orders o ON c.id = o.customer_id            │
  │ GROUP BY c.name                                       │
  │ ORDER BY order_count DESC                             │
  │ LIMIT 5                                               │
  ╰───────────────────────────────────────────────────────╯

  ┌─────────────────┬─────────────┐
  │ name            │ order_count │
  ├─────────────────┼─────────────┤
  │ Alice Martin    │ 12          │
  │ Bob Chen        │ 9           │
  │ Carol Jones     │ 7           │
  └─────────────────┴─────────────┘

  ⊞ 3 rows  │  ⏱ 45ms  │  ◉ learned
```

**REPL commands** (slash-prefixed; `.` aliases are kept silently):

| Command | What it does |
|---|---|
| `/help` | List all commands |
| `/schema` | Display schema with relationships |
| `/stats` | Database statistics |
| `/clear` | Clear screen and conversation history |
| `/model [id]` | Switch LLM model (searchable picker if no id) |
| `/db [name]` | List databases, or switch active by name |
| `/fork` | Create a sandbox fork of the active DB |
| `/forks` | List active forks |
| `/fork-delete <id>` | Delete a fork |
| `/exit` | Quit |

**Diagnostics:** `neurobase doctor` runs a full health check (Node version,
DB connection, LLM key, required Postgres extensions, filesystem). Use it
first when something feels off.

### REST API

```bash
npm run serve                # basic API
npm run serve:multi-agent    # full multi-agent API + dashboard
```

```bash
# Query
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "revenue by month this year"}'

# Schema
curl http://localhost:3000/api/schema

# Diagnose slow query
curl -X POST http://localhost:3000/api/diagnose \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM orders WHERE status = '\''pending'\''"}'
```

Dashboard at `http://localhost:3000/dashboard`.

### MCP Server (Claude Desktop / Cursor)

```bash
npm run serve:mcp
```

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "neurobase": {
      "command": "npx",
      "args": ["neurobase-mcp"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/mydb",
        "LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

**Available MCP tools:** `query`, `schema`, `explain`, `correct`, `diagnose`, `stats`

### Programmatic

```typescript
import { NeuroBase } from 'neurobase';
import { loadConfig } from 'neurobase/config';

const nb = new NeuroBase(loadConfig());
await nb.initialize();

// Query
const result = await nb.query("top 10 products by revenue");
console.log(result.data);
console.log(result.sql);
console.log(result.corrected); // true if self-correction was used

// Diagnose
const diag = await nb.diagnose("SELECT * FROM large_table");
console.log(diag.rootCause);
console.log(diag.recommendations);

// Correct (for learning)
await nb.correct("monthly revenue", "SELECT ...", "should use fiscal month");

await nb.close();
```

---

## Configuration

The recommended path is `neurobase setup`, which writes to `~/.neurobase/`
(profile + credentials, no `.env` needed) and supports partial reconfiguration:

```bash
neurobase setup            # full wizard — DB step is optional
neurobase setup db         # manage registered databases (add / switch / edit / remove)
neurobase setup llm        # only the provider + token + model
neurobase setup model      # only the model (searchable picker)
neurobase setup token      # only the API key (re-validated live)
neurobase setup features   # toggle learning / optimization / self-correction
neurobase setup privacy    # change the privacy mode
```

### Multiple databases, one profile

NeuroBase keeps a **registry of named databases** per profile so you can
switch between them without reconfiguring everything. The first time you run
`setup db` you give the database a name (`default`, `prod`, `mysql-staging`,
whatever fits). After that:

```bash
neurobase setup db         # opens the menu — add / switch / edit / remove
```

Inside an interactive session, switch on the fly:

```
neurobase > /db                  # list everything, marks the active one
neurobase > /db prod             # switch active database (re-introspects schema)
neurobase > /db switch sandbox   # same — `switch` keyword is optional
```

The LLM, features, and privacy mode stay the same across switches — only the
data source changes.

`.env` is still supported as a fallback for users who prefer it — copy
`.env.example` to `.env` and edit:

```env
# Database (postgresql, mysql, sqlite, mongodb)
DB_ENGINE=postgresql
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb

# LLM (anthropic, openai, openrouter, ollama)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5

# Features
ENABLE_LEARNING=true
ENABLE_OPTIMIZATION=true
ENABLE_SELF_CORRECTION=true    # auto-fix failed queries
ENABLE_MULTI_CANDIDATE=false   # generate 3 SQL candidates (more LLM calls)

# Privacy (strict | schema-only | permissive)
PRIVACY_MODE=schema-only
```

### Semantic Model (optional)

Create `neurobase.semantic.yml` to define business concepts:

```yaml
entities:
  - name: Client
    table: customers
    description: "People who purchase products"
    metrics:
      - name: revenue
        expression: "SUM(orders.total_amount)"
    relationships:
      - target: Order
        type: one_to_many
        join: "customers.id = orders.customer_id"
```

When present, the LLM reasons in business terms ("client revenue") instead of raw columns (`SUM(orders.total_amount)`). See `neurobase.semantic.example.yml` for a full example.

---

## Supported Databases

| Database | Engine value | Status |
|----------|-------------|--------|
| PostgreSQL | `postgresql` | Full support (primary) |
| MySQL | `mysql` | Full support |
| SQLite | `sqlite` | Full support |
| MongoDB | `mongodb` | Experimental |

All adapters implement the same interface — schema introspection, query execution, transactions, EXPLAIN, forking.

---

## Project Structure

```
src/
├── core/neurobase.ts           # Main orchestrator
├── agents/                     # AI agents (9 files)
│   ├── linguistic.ts           #   NL → SQL translation
│   ├── optimizer.ts            #   Query optimization
│   ├── memory.ts               #   Learning storage
│   ├── value-explorer.ts       #   DB value verification
│   ├── explainer.ts            #   Post-execution explanations
│   ├── schema-evolution.ts     #   Index/view recommendations
│   ├── query-validator.ts      #   Safety validation
│   ├── learning-aggregator.ts  #   Cross-agent insights
│   └── ab-testing.ts           #   Strategy comparison
├── rag/                        # Retrieval-Augmented Generation
│   ├── confidence-router.ts    #   4-tier routing
│   ├── self-correction.ts      #   Error → retry loop
│   ├── candidate-selector.ts   #   Multi-SQL ranking
│   ├── schema-pruner.ts        #   Token budget pruning
│   ├── result-verifier.ts      #   5-step verification
│   ├── feedback-loop.ts        #   Temporal decay learning
│   └── vector-cache.ts         #   Embedding cache
├── semantic/                   # Semantic intelligence
│   ├── auto-catalog.ts         #   Auto-generate descriptions
│   ├── loader.ts               #   YAML model loader
│   ├── renderer.ts             #   LLM prompt renderer
│   └── model.ts                #   Type definitions
├── llm/                        # LLM providers
│   └── providers/              #   OpenAI, Anthropic, Ollama
├── database/                   # Multi-DB adapters
│   └── adapters/               #   PostgreSQL, MySQL, SQLite, MongoDB
├── orchestrator/               # Multi-agent coordination
├── observability/              # Tracing, alerts, spans
├── security/                   # SQL parser, privacy guard, audit
├── diagnostics/                # Tree-based query diagnostics
├── mcp/server.ts               # MCP server (Claude Desktop)
├── ui/                         # Rich terminal interface
│   ├── theme.ts                #   Color palette, icons, box chars
│   ├── banner.ts               #   Gradient ASCII banner
│   ├── render.ts               #   SQL, tables, schema rendering
│   ├── spinner.ts              #   Animated spinners
│   └── setup-wizard.ts         #   Interactive configuration
├── cli.ts                      # CLI entry point
├── api.ts                      # REST API
└── multi-agent-api.ts          # Multi-agent API + dashboard
```

---

## Development

```bash
npm run dev               # watch mode (CLI)
npm run dev:multi-agent   # watch mode (multi-agent API)
npm run build             # compile TypeScript
npm run typecheck         # type checking only
npm run lint              # ESLint
npm run format            # Prettier
npm test                  # Jest with coverage
npm run test:all          # all tests verbose
```

---

## Performance

| Operation | Time |
|-----------|------|
| Query translation | <500ms (LLM dependent) |
| Local Ollama | <200ms |
| Fork creation | ~2s (zero-copy) |
| Schema cache | 5-minute TTL |
| Self-correction loop | <2s per attempt |
| Multi-candidate (3x) | ~1.5s (parallel) |

---

## Security

- **SQL injection prevention** — parameterized queries, AST-based pattern detection
- **Dangerous query blocking** — DROP, TRUNCATE, DELETE without WHERE
- **Privacy guard** — three-tier data control (strict/schema-only/permissive)
- **Read-only mode** — restrict to SELECT queries
- **Rate limiting** — configurable per endpoint (default 100/15min)
- **Query timeout** — configurable maximum (default 30s)
- **Fork isolation** — agents operate on database copies
- **Immutable audit log** — append-only, UPDATE/DELETE revoked

---

## Contributing & Security

- [CONTRIBUTING.md](./CONTRIBUTING.md) — local setup, code standards, PR flow
- [SECURITY.md](./SECURITY.md) — threat model, vulnerability disclosure

## License

MIT — see [LICENSE](LICENSE).

---

## Documentation

### English

- [Architecture Guide](docs/architecture.md)
- [API Reference](docs/api-reference.md)
- [Multi-Agent System](docs/multi-agent-system.md)
- [Installation Guide](docs/installation.md)
- [Quick Start](docs/quickstart.md)

### Francais

- [Guide d'architecture](docs/fr/architecture.md)
- [Reference API](docs/fr/api-reference.md)
- [Systeme multi-agent](docs/fr/multi-agent-system.md)
- [Guide d'installation](docs/fr/installation.md)
- [Demarrage rapide](docs/fr/quickstart.md)

---

## Links

- [GitHub](https://github.com/4n0nn43x/neurobase)
- [Issues](https://github.com/4n0nn43x/neurobase/issues)
