# NeuroBase Architecture

## Overview

NeuroBase is a multi-database conversational engine that translates natural language to SQL, learns from corrections, and self-heals on failures. It supports PostgreSQL, MySQL, SQLite, and MongoDB through a unified adapter interface, with multi-provider LLM support (OpenAI, Anthropic, Ollama).

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   User Interfaces                        │
│    CLI (interactive)  │  REST API  │  MCP Server         │
└───────────┬───────────┴──────┬─────┴───────┬────────────┘
            │                  │             │
┌───────────▼──────────────────▼─────────────▼────────────┐
│                    NeuroBase Core                         │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Confidence   │  │  Privacy     │  │  Semantic      │  │
│  │  Router       │  │  Guard       │  │  Catalog       │  │
│  │  (4-tier RAG) │  │  (3 modes)   │  │  (auto-gen)    │  │
│  └──────┬───────┘  └──────────────┘  └───────────────┘  │
│         │                                                │
│  ┌──────▼───────────────────────────────────────────┐   │
│  │              Linguistic Agent                     │   │
│  │  + Value Explorer (verify DB values)              │   │
│  │  + Schema Pruner (token budget)                   │   │
│  │  + Semantic Model (business concepts)             │   │
│  └──────┬───────────────────────────────────────────┘   │
│         │                                                │
│  ┌──────▼───────────────────────────────────────────┐   │
│  │         Candidate Selector (optional)             │   │
│  │  Generate N candidates → filter → rank by cost    │   │
│  └──────┬───────────────────────────────────────────┘   │
│         │                                                │
│  ┌──────▼──────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Result     │  │  Optimizer   │  │  Self-         │  │
│  │  Verifier   │  │  Agent       │  │  Correction    │  │
│  │  (5-step)   │  │              │  │  Loop (3x)     │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Memory      │  │  Explainer   │  │  Diagnostic    │  │
│  │  Agent       │  │  Agent       │  │  Tree Search   │  │
│  │  (learning)  │  │  (post-exec) │  │  (perf debug)  │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                   Database Layer                         │
│  ┌──────────┐ ┌────────┐ ┌────────┐ ┌─────────┐       │
│  │PostgreSQL│ │ MySQL  │ │ SQLite │ │ MongoDB │       │
│  └──────────┘ └────────┘ └────────┘ └─────────┘       │
└─────────────────────────────────────────────────────────┘
```

## Query Processing Pipeline

```
Natural Language Query
        │
        ▼
┌─ Confidence Router ──────────────────────────────────┐
│  Tier 1 (≥0.95): cache hit → skip LLM               │
│  Tier 2 (≥0.80): few-shot with similar examples      │
│  Tier 3 (≥0.50): full pipeline + schema + history     │
│  Tier 4 (<0.50): LLM fallback with full context       │
└───────┬──────────────────────────────────────────────┘
        │
        ▼
┌─ Value Explorer ─────────────────────────────────────┐
│  Detect filter values ("in Electronics")              │
│  Query DISTINCT values from DB                        │
│  Find best match (case/plural/Levenshtein)            │
│  Inject real values into LLM prompt                   │
│  (disabled in strict/schema-only privacy mode)        │
└───────┬──────────────────────────────────────────────┘
        │
        ▼
┌─ Schema Pruner ──────────────────────────────────────┐
│  Score tables: keyword overlap + FK proximity          │
│                + usage frequency + description match   │
│  Serialize top tables until token budget reached       │
│  Compact format for borderline tables                  │
│  (skipped for <10 tables)                              │
└───────┬──────────────────────────────────────────────┘
        │
        ▼
┌─ Linguistic Agent (LLM call) ────────────────────────┐
│  System prompt: schema + examples + values + semantic  │
│  Handles: SQL generation, conversation, clarification  │
│  Multi-language: English + French + mixed              │
└───────┬──────────────────────────────────────────────┘
        │
        ▼ (if multi-candidate enabled)
┌─ Candidate Selector ────────────────────────────────┐
│  Generate 3 SQLs (temp 0.0, 0.2, 0.4) in parallel   │
│  Filter: quickVerify eliminates bad schema refs       │
│  Rank: EXPLAIN cost comparison                        │
│  Tiebreak: LLM picks if costs within 20%             │
└───────┬──────────────────────────────────────────────┘
        │
        ▼
┌─ Optimizer Agent ────────────────────────────────────┐
│  EXPLAIN analysis → rewrite suggestions               │
│  Index recommendations                                │
│  (optional, config-driven)                            │
└───────┬──────────────────────────────────────────────┘
        │
        ▼
┌─ Execute on Database ────────────────────────────────┐
│  Parameterized query with timeout                     │
│  On failure → Self-Correction Loop (3 attempts)       │
│    attempt 1: temp 0.1                                │
│    attempt 2: temp 0.3                                │
│    attempt 3: temp 0.5                                │
└───────┬──────────────────────────────────────────────┘
        │
        ▼
┌─ Post-Processing ────────────────────────────────────┐
│  Memory Agent: store NL→SQL mapping for learning      │
│  Explainer Agent: "47 orders from last week, sorted"  │
│  Feedback Loop: temporal decay weighting              │
└───────┬──────────────────────────────────────────────┘
        │
        ▼
      Results
```

## Core Components

### NeuroBase Core (`src/core/neurobase.ts`)

Central orchestrator that wires together all components. Instantiates agents, manages the query pipeline, handles self-correction, and exposes the `query()`, `correct()`, `diagnose()` methods.

### Agents (`src/agents/`)

| Agent | File | Role |
|-------|------|------|
| Linguistic | `linguistic.ts` | NL → SQL translation with schema/value/semantic context |
| Optimizer | `optimizer.ts` | EXPLAIN-based query rewriting |
| Memory | `memory.ts` | Learning storage with embeddings |
| Value Explorer | `value-explorer.ts` | Verify referenced values exist in DB |
| Explainer | `explainer.ts` | Post-execution natural language summary |
| Schema Evolution | `schema-evolution.ts` | Index/view/partition recommendations |
| Query Validator | `query-validator.ts` | Safety and performance validation |
| Learning Aggregator | `learning-aggregator.ts` | Cross-agent insight synthesis |
| A/B Testing | `ab-testing.ts` | Parallel strategy comparison |

### RAG Pipeline (`src/rag/`)

| Component | File | Role |
|-----------|------|------|
| Confidence Router | `confidence-router.ts` | 4-tier query routing based on confidence |
| Self-Correction | `self-correction.ts` | Retry failed SQL with error context |
| Candidate Selector | `candidate-selector.ts` | Multi-SQL generation and ranking |
| Schema Pruner | `schema-pruner.ts` | Token-budget-aware schema filtering |
| Result Verifier | `result-verifier.ts` | 5-step SQL validation pipeline |
| Feedback Loop | `feedback-loop.ts` | Temporal decay learning weights |
| Vector Cache | `vector-cache.ts` | In-memory embedding cache with LRU |

### Semantic Layer (`src/semantic/`)

| Component | File | Role |
|-----------|------|------|
| Auto-Catalog | `auto-catalog.ts` | LLM-generates table/column descriptions |
| Loader | `loader.ts` | Loads YAML semantic model |
| Renderer | `renderer.ts` | Converts model to LLM prompt text |

### LLM Providers (`src/llm/`)

Abstract `BaseLLMProvider` with implementations:
- **OpenAI** — GPT-4 Turbo, text-embedding-3-small
- **Anthropic** — Claude Sonnet/Opus
- **Ollama** — Local models (llama3.2, etc.)

All providers implement `generateCompletion()` and `generateEmbedding()`.

### Database Adapters (`src/database/`)

Abstract `DatabaseAdapter` interface with implementations for PostgreSQL, MySQL, SQLite, MongoDB. Each adapter provides: schema introspection, query execution, transactions, EXPLAIN, forking.

### Observability (`src/observability/`)

- **OpenTelemetry** tracing with OTLP HTTP exporter
- **Span definitions** for the full query lifecycle (16 span types)
- **Alert system** with metric-based rules and webhook/log channels
- **Health monitor** with auto-healing actions

### Security (`src/security/`)

- **SQL parser** — AST-based dangerous pattern detection
- **Privacy guard** — three-tier data control (strict/schema-only/permissive)
- **Audit log** — immutable append-only trail

### Diagnostics (`src/diagnostics/`)

Tree-based root cause analysis for query performance. Traverses a knowledge tree: sequential scan → missing index, lock contention, large result set, complex joins, table bloat.

## Database Tables

### Core
- `neurobase_learning_history` — NL→SQL mappings with embeddings
- `neurobase_corrections` — user corrections for learning
- `neurobase_semantic_catalog` — auto-generated table/column descriptions

### Multi-Agent
- `neurobase_agents` — agent metadata and status
- `neurobase_agent_tasks` — task queue with priority
- `neurobase_agent_messages` — inter-agent communication

### Audit
- `neurobase_audit_log` — immutable operation trail

## Entry Points

| Entry | File | Command |
|-------|------|---------|
| Interactive CLI | `src/cli.ts` | `neurobase interactive` |
| REST API | `src/api.ts` | `npm run serve` |
| Multi-Agent API | `src/multi-agent-api.ts` | `npm run serve:multi-agent` |
| MCP Server | `src/mcp/server.ts` | `npm run serve:mcp` |

## Design Patterns

- **Factory** — LLMFactory, AdapterFactory for provider/DB selection
- **Strategy** — different database adapters implementing same interface
- **Observer** — event handlers in NeuroBase core
- **Circuit Breaker** — LLM provider failover chain
- **Pipeline** — multi-stage query processing (RAG → translate → verify → execute → learn)
