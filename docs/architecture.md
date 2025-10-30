# NeuroBase Architecture

## Overview

NeuroBase is an intelligent database system built on PostgreSQL that combines natural language processing with autonomous AI agents for database management and optimization.

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Multi-Agent Orchestrator                    │
│                  (Main Database)                         │
├─────────────────────────────────────────────────────────┤
│  • Agent Registry & Lifecycle Management                │
│  • Task Queue & Distribution                            │
│  • Event System & Monitoring                            │
│  • Inter-agent Communication                            │
└────────────────┬────────────────────────────────────────┘
                 │
    ┌────────────┼────────────┬──────────────┬─────────────┐
    │            │            │              │             │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐      ┌───▼───┐   ┌─────▼────┐
│Fork 1 │   │Fork 2 │   │Fork 3 │      │Fork 4 │   │Fork N... │
│       │   │       │   │       │      │       │   │          │
│Schema │   │Query  │   │Learn. │      │A/B    │   │Custom    │
│Evol.  │   │Valid. │   │Aggr.  │      │Test   │   │Agent     │
│Agent  │   │Agent  │   │Agent  │      │Agent  │   │          │
└───┬───┘   └───┬───┘   └───┬───┘      └───┬───┘   └─────┬────┘
    │            │            │              │             │
    └────────────┴────────────┴──────────────┴─────────────┘
                 │
        Fork Synchronizer
     (Shares Learning & Data)
```

## Core Components

### 1. NeuroBase Core

Central system managing the main database operations:
- Natural language query processing
- SQL generation via LLM providers
- Query execution and result formatting
- Schema introspection
- Learning history storage

### 2. Multi-Agent Orchestrator

Coordinates multiple specialized AI agents:
- **Agent Registry**: Tracks all registered agents
- **Task Queue**: Distributes work with priority
- **Event System**: Monitors and logs activities
- **Communication**: Inter-agent messaging

Database tables:
- `neurobase_agents` - Agent metadata
- `neurobase_agent_tasks` - Task queue
- `neurobase_agent_messages` - Agent communication
- `neurobase_agent_metrics` - Performance tracking

### 3. Specialized Agents

#### Schema Evolution Agent
- Analyzes query patterns
- Recommends database optimizations (indexes, views, partitions)
- Tests changes on dedicated fork
- Measures performance impact

#### Query Validator Agent
- Validates SQL syntax and safety
- Detects dangerous patterns
- Analyzes query performance
- Tests on fork before production

#### Learning Aggregator Agent
- Collects learning from all agents
- Identifies cross-agent patterns
- Builds knowledge graph
- Generates insights

#### A/B Testing Agent
- Tests multiple strategies in parallel
- Creates forks for comparison
- Statistical analysis
- Winner determination

### 4. Fork Manager

Manages database forks for agent isolation:
- Zero-copy fork creation
- Fork lifecycle management
- Connection string generation
- Fork deletion

### 5. Fork Synchronizer

Enables knowledge sharing between forks:
- **Incremental sync**: Only new/updated records
- **Full sync**: Complete data copy
- **Selective sync**: Filter-based
- Conflict resolution strategies
- Automatic scheduling

### 6. Monitoring Dashboard

Web-based real-time monitoring:
- System metrics
- Agent status
- Synchronization statistics
- Event stream
- Performance graphs

## Data Flow

### Query Processing

```
User Input (Natural Language)
    ↓
Linguistic Agent
    ├─→ Load Schema
    ├─→ Retrieve Learning History
    ├─→ Generate SQL via LLM
    └─→ Validate SQL
    ↓
Optimizer Agent (optional)
    ├─→ Analyze Execution Plan
    ├─→ Suggest Optimizations
    └─→ Apply Safe Optimizations
    ↓
Execute on Database
    ↓
Memory Agent
    ├─→ Generate Embedding
    ├─→ Store Learning Entry
    └─→ Update History
    ↓
Return Results
```

### Learning Flow

```
Query Execution
    ↓
Generate Text Embedding
    ↓
Store in Learning History
    ├─→ Natural language query
    ├─→ Generated SQL
    ├─→ Embedding vector
    ├─→ Success flag
    └─→ Metadata
    ↓
Future Queries
    ├─→ Find Similar via Embeddings
    ├─→ Retrieve Example SQL
    ├─→ Improve Translation
    └─→ Learn from Patterns
```

## Database Schema

### Core Tables

#### neurobase_learning_history
```sql
CREATE TABLE neurobase_learning_history (
  id TEXT PRIMARY KEY,
  natural_language TEXT,
  sql TEXT,
  user_id TEXT,
  timestamp TIMESTAMP,
  success BOOLEAN,
  corrected BOOLEAN,
  embedding vector(384),  -- pgvector
  context JSONB
);
```

#### neurobase_corrections
```sql
CREATE TABLE neurobase_corrections (
  id TEXT PRIMARY KEY,
  original_query TEXT,
  original_sql TEXT,
  corrected_sql TEXT,
  reason TEXT,
  user_id TEXT,
  timestamp TIMESTAMP
);
```

### Multi-Agent Tables

#### neurobase_agents
```sql
CREATE TABLE neurobase_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  fork_id TEXT,
  status TEXT NOT NULL,
  config JSONB,
  metrics JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### neurobase_agent_tasks
```sql
CREATE TABLE neurobase_agent_tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES neurobase_agents(id),
  task_type TEXT NOT NULL,
  payload JSONB,
  status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 5,
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### neurobase_agent_messages
```sql
CREATE TABLE neurobase_agent_messages (
  id TEXT PRIMARY KEY,
  from_agent_id TEXT,
  to_agent_id TEXT,
  message_type TEXT NOT NULL,
  payload JSONB,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## LLM Integration

### Provider Abstraction

```typescript
interface BaseLLMProvider {
  generateCompletion(messages, options): Promise<Response>
  generateEmbedding(text): Promise<number[]>
  createSQLPrompt(query, schema, examples): string
}
```

### Supported Providers

1. **OpenAI** (GPT-4)
2. **Anthropic** (Claude)
3. **Ollama** (Local models)

### Embedding Generation

Uses local Transformers.js (`all-MiniLM-L6-v2`) for:
- 384-dimensional vectors
- No external API calls
- Privacy-focused
- Cosine similarity search

## Fork-Based Architecture

### Why Forks?

- **Safety**: Test changes without risk
- **Isolation**: Agents don't interfere
- **Parallelism**: True concurrent execution
- **Cost**: Zero-copy = no duplication

### Fork Creation

```typescript
const fork = await forkManager.createFork({
  name: 'agent-fork',
  strategy: 'now',  // or 'last-snapshot', 'to-timestamp'
  waitForCompletion: true
});
```

### Fork Synchronization

```typescript
await synchronizer.createSyncJob({
  source: 'fork-1',
  target: 'fork-2',
  tables: ['neurobase_learning_history'],
  mode: 'incremental',
  direction: 'push'
});
```

## Event System

### Event Types

- `agent:started` - Agent started
- `agent:stopped` - Agent stopped
- `agent:error` - Agent error
- `task:completed` - Task finished
- `fork:created` - Fork created
- `sync:started` - Sync job started
- `sync:completed` - Sync job finished

### Event Handling

```typescript
orchestrator.on((event) => {
  console.log(`[${event.type}] ${event.timestamp}`);
  // Handle event
});
```

## Security

- **SQL Injection Prevention**: Parameterized queries
- **Dangerous Pattern Detection**: Blocks DROP, TRUNCATE, etc.
- **Read-only Mode**: Restrict to SELECT only
- **API Rate Limiting**: 100 requests per 15 minutes
- **Query Timeout**: 30 second maximum
- **Fork Isolation**: Complete separation

## Performance

### Optimizations

- **Schema Caching**: 5-minute TTL
- **Connection Pooling**: Max 20 connections
- **Embedding Cache**: In-memory
- **Local Embeddings**: No external API calls
- **Incremental Sync**: Only changed data

### Benchmarks

- Fork creation: ~2 seconds
- Query translation: <500ms (LLM dependent)
- Embedding generation: <100ms
- Sync (incremental): 100-1000 records/second

## Scalability

- Multiple agents on separate forks
- Parallel task execution
- Horizontal scaling via fork distribution
- Efficient resource usage (~5 connections per agent)

## Monitoring

- Real-time dashboard
- Event logging
- Metric tracking
- Performance analytics
- Error tracking
