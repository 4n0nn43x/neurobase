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
npx neurobase setup       # interactive configuration wizard
npx neurobase interactive  # start querying
```

### Install globally

```bash
npm install -g neurobase
neurobase setup
neurobase interactive
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

### Query Precision Pipeline

| Stage | What it does | Inspired by |
|-------|-------------|-------------|
| **Value Explorer** | Verifies referenced values exist in DB before SQL generation | ReFoRCE (Snowflake) |
| **Multi-Candidate** | Generates N SQL candidates, filters by schema validity, ranks by EXPLAIN cost | Contextual AI bird-sql |
| **Self-Correction** | On failure, sends error + schema back to LLM for retry (3 attempts, temp 0.1→0.3→0.5) | PremSQL |
| **Confidence Router** | 4-tier RAG routing: cache hit → few-shot → full pipeline → LLM fallback | — |
| **Result Verifier** | 5-step verification: AST security → schema refs → sandbox execution → shape → complete | — |

### Semantic Intelligence

| Component | What it does | Inspired by |
|-----------|-------------|-------------|
| **Auto-Catalog** | LLM-generates descriptions for every table/column, persists in `neurobase_semantic_catalog` | pgai (Timescale) |
| **Semantic Model** | YAML-defined business concepts: "revenue = SUM(orders.amount)", with relationships | Wren AI |
| **Schema Pruner** | Scores tables by keyword overlap, FK proximity, usage frequency; respects token budget | DB-GPT |

### Infrastructure

| Component | What it does | Inspired by |
|-----------|-------------|-------------|
| **MCP Server** | Tools: `query`, `schema`, `explain`, `correct`, `diagnose` — works with Claude Desktop, Cursor | DBHub |
| **Privacy Guard** | `strict` / `schema-only` / `permissive` modes — controls what data reaches the LLM | DataLine |
| **Explainer** | Post-execution natural language summary: "47 orders from last week, sorted by total" | Chat2DB, Wren AI |
| **Diagnostic Tree** | Systematic root cause analysis: seq scan → missing index → suggest CREATE INDEX | D-Bot (Tsinghua) |

### Multi-Agent System

| Agent | Purpose |
|-------|---------|
| **Linguistic Agent** | NL → SQL translation with conversation context |
| **Optimizer Agent** | Execution plan analysis and query rewriting |
| **Memory Agent** | Learning storage with temporal decay weighting |
| **Schema Evolution** | Recommends indexes, views, partitions from query patterns |
| **Query Validator** | Safety checks (SQL injection, dangerous patterns) |
| **Learning Aggregator** | Cross-agent insight synthesis |
| **A/B Testing** | Parallel strategy comparison on isolated forks |

### Observability

| Component | What it does |
|-----------|-------------|
| **OpenTelemetry** | Distributed tracing across the full query lifecycle |
| **Alert System** | Metric-based rules with webhook and log channels |
| **Health Monitor** | Agent health tracking with auto-healing actions |
| **Circuit Breaker** | LLM provider failover (Anthropic → OpenAI → Ollama) |
| **Operation Supervisor** | Risk classification (read/write/DDL) with approval gates |
| **Audit Log** | Immutable append-only trail of all operations |

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
neurobase interactive
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

**Commands:** `.help` `.schema` `.stats` `.clear` `.fork` `.forks` `.exit`

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

Run `neurobase setup` for interactive configuration, or copy `.env.example` to `.env`:

```env
# Database (postgresql, mysql, sqlite, mongodb)
DB_ENGINE=postgresql
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb

# LLM (anthropic, openai, ollama)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

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

## License

MIT — see [LICENSE](LICENSE).

---

## Links

- [Architecture Guide](docs/architecture.md)
- [API Reference](docs/api-reference.md)
- [Multi-Agent System](docs/multi-agent-system.md)
- [Installation Guide](docs/installation.md)
- [Quick Start](docs/quickstart.md)
- [Issues](https://github.com/4n0nn43x/neurobase/issues)
