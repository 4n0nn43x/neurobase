## NeuroBase Architecture

### Overview

NeuroBase is a cognitive database system built on Agentic Postgres that uses a multi-agent architecture to provide natural language query capabilities with continuous learning.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       User Interface                         │
│                    (CLI / REST API / Web)                    │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                      NeuroBase Core                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Query Orchestrator                       │  │
│  │  - Request handling                                   │  │
│  │  - Agent coordination                                 │  │
│  │  - Response formatting                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                             │                                │
│  ┌──────────────┬──────────┼──────────┬──────────────────┐ │
│  ▼              ▼           ▼          ▼                  │ │
│  ┌──────────┐  ┌──────────┐ ┌──────────┐ ┌──────────────┐│ │
│  │Linguistic│  │Optimizer │ │  Memory  │ │   Schema     ││ │
│  │  Agent   │  │  Agent   │ │  Agent   │ │Introspector  ││ │
│  └──────────┘  └──────────┘ └──────────┘ └──────────────┘│ │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                      LLM Provider Layer                      │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐     │
│  │  OpenAI  │    │  Anthropic   │    │    Ollama    │     │
│  │  GPT-4   │    │   Claude     │    │   (Local)    │     │
│  └──────────┘    └──────────────┘    └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                    Tiger Cloud / Postgres                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  - User Data                                          │  │
│  │  - Learning History (neurobase_learning_history)     │  │
│  │  - Corrections (neurobase_corrections)               │  │
│  │  - Schema Metadata                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. NeuroBase Core (`src/core/neurobase.ts`)

The main orchestrator that coordinates all agents and manages the query lifecycle.

**Responsibilities:**
- Initialize and coordinate agents
- Handle natural language queries
- Manage conversation context
- Emit events for monitoring
- Store learning data

**Key Methods:**
- `query(text: string): Promise<QueryResult>` - Main query entry point
- `correct(originalQuery, correctSQL, reason)` - Store corrections
- `getSuggestions(userId)` - Get query suggestions
- `getStats()` - Get database statistics

### 2. Linguistic Agent (`src/agents/linguistic.ts`)

Translates natural language to SQL using LLM providers.

**Workflow:**
1. Receive natural language query
2. Load database schema
3. Retrieve similar past queries (from learning history)
4. Generate SQL using LLM with context
5. Validate SQL syntax
6. Return SQL with confidence score

**Features:**
- Context-aware translation
- Example-based learning
- Confidence scoring
- Clarification requests for ambiguous queries
- SQL validation

### 3. Optimizer Agent (`src/agents/optimizer.ts`)

Analyzes and optimizes query performance.

**Workflow:**
1. Execute EXPLAIN ANALYZE on query
2. Parse execution plan
3. Identify performance bottlenecks
4. Generate optimization suggestions
5. Apply safe optimizations (if enabled)

**Optimization Types:**
- **Index Creation**: Suggests indexes for sequential scans
- **Query Rewriting**: Better join strategies, subquery optimization
- **Caching**: Materialized views for frequent queries
- **Partitioning**: Table partitioning for large datasets

**Analysis Metrics:**
- Execution time
- Buffer hits/misses
- Index usage
- Join performance

### 4. Memory Agent (`src/agents/memory.ts`)

Manages learning history and semantic search.

**Storage:**
- `neurobase_learning_history`: Successful query translations
- `neurobase_corrections`: User corrections

**Features:**
- Embedding-based semantic search
- Context retrieval for similar queries
- Correction tracking
- User-specific learning

**Operations:**
- `store(entry)`: Save new learning entry
- `retrieve(query)`: Find similar past queries
- `update(entry)`: Update existing entry
- `storeCorrection()`: Record user corrections

### 5. Schema Introspector (`src/database/schema.ts`)

Provides schema awareness to agents.

**Capabilities:**
- Tables, columns, types
- Primary keys, foreign keys
- Indexes and their columns
- Views and functions
- Row count estimates
- Schema caching (5-minute TTL)

**Output Formats:**
- Structured TypeScript objects
- Text format for LLM consumption
- JSON for API responses

---

## Data Flow

### Query Processing Flow

```
1. User Input
   │
   ▼
2. NeuroBase Core
   │
   ├─▶ Load Schema (cached)
   │
   ├─▶ Retrieve Learning History
   │
   ▼
3. Linguistic Agent
   │
   ├─▶ Format schema for LLM
   │
   ├─▶ Add similar examples
   │
   ├─▶ Generate SQL via LLM
   │
   ├─▶ Validate SQL
   │
   ▼
4. Optimizer Agent (if enabled)
   │
   ├─▶ Get execution plan
   │
   ├─▶ Analyze performance
   │
   ├─▶ Generate suggestions
   │
   ├─▶ Apply optimizations
   │
   ▼
5. Execute SQL
   │
   ▼
6. Memory Agent (if enabled)
   │
   ├─▶ Generate embedding
   │
   ├─▶ Store learning entry
   │
   ▼
7. Return Results
   │
   ▼
8. User Output
```

### Learning Flow

```
1. Query Execution
   │
   ▼
2. Generate Embedding
   │  (OpenAI text-embedding-3-small)
   │
   ▼
3. Store Entry
   │  - Natural Language
   │  - Generated SQL
   │  - Embedding vector
   │  - Context metadata
   │
   ▼
4. Future Queries
   │
   ▼
5. Semantic Search
   │  (Cosine similarity)
   │
   ▼
6. Retrieve Similar Examples
   │
   ▼
7. Enhance New Query
```

---

## LLM Integration

### Provider Architecture

```typescript
BaseLLMProvider (Abstract)
  │
  ├─▶ OpenAIProvider
  │     └─ GPT-4 Turbo
  │
  ├─▶ AnthropicProvider
  │     └─ Claude 3.5 Sonnet
  │
  └─▶ OllamaProvider
        └─ Llama 3.2 (local)
```

### LLM Usage Points

1. **SQL Generation**
   - Input: Natural language + schema + examples
   - Output: SQL + explanation + confidence

2. **Query Optimization**
   - Input: SQL + execution plan + schema
   - Output: Optimized SQL + suggestions

3. **Embeddings** (for semantic search)
   - Input: Natural language query
   - Output: Vector embedding (1536 dimensions)

---

## Database Schema

### NeuroBase Internal Tables

```sql
-- Learning history
neurobase_learning_history
  ├─ id (TEXT, PK)
  ├─ natural_language (TEXT)
  ├─ sql (TEXT)
  ├─ user_id (TEXT, nullable)
  ├─ timestamp (TIMESTAMP)
  ├─ success (BOOLEAN)
  ├─ corrected (BOOLEAN)
  ├─ embedding (TEXT) -- JSON array
  └─ context (TEXT) -- JSON object

-- Corrections
neurobase_corrections
  ├─ id (TEXT, PK)
  ├─ original_query (TEXT)
  ├─ original_sql (TEXT)
  ├─ corrected_sql (TEXT)
  ├─ corrected_query (TEXT, nullable)
  ├─ reason (TEXT)
  ├─ user_id (TEXT, nullable)
  └─ timestamp (TIMESTAMP)
```

---

## Configuration

### Environment-Based Config

```typescript
Config
  ├─ tiger: TigerConfig
  │   ├─ serviceId
  │   ├─ host
  │   ├─ port
  │   ├─ database
  │   ├─ user
  │   └─ password
  │
  ├─ llm: LLMConfig
  │   ├─ provider (openai | anthropic | ollama)
  │   ├─ openai?: OpenAIConfig
  │   ├─ anthropic?: AnthropicConfig
  │   └─ ollama?: OllamaConfig
  │
  ├─ neurobase: NeuroBaseConfig
  │   ├─ mode (interactive | api | readonly)
  │   ├─ logLevel (debug | info | warn | error)
  │   └─ port
  │
  ├─ features: FeatureFlags
  │   ├─ enableLearning
  │   ├─ enableOptimization
  │   ├─ enableSchemaSuggestions
  │   └─ enableQueryCache
  │
  └─ security: SecurityConfig
      ├─ apiRateLimit
      ├─ readonlyMode
      └─ maxQueryTime
```

---

## Security

### SQL Injection Prevention

1. **Parameterized Queries**: All user data uses parameterized queries
2. **SQL Validation**: Basic pattern matching for dangerous operations
3. **LLM Prompt Engineering**: Explicit instructions to prevent injection
4. **Read-only Mode**: Option to restrict to SELECT queries only

### Access Control

1. **User-specific Learning**: Learning history can be user-scoped
2. **API Rate Limiting**: Configurable rate limits
3. **Query Timeout**: Maximum execution time enforcement
4. **SSL Connections**: Encrypted database connections

---

## Performance Optimization

### Caching Strategy

1. **Schema Cache**: 5-minute TTL
2. **Embedding Cache**: In-memory cache for query embeddings
3. **Connection Pooling**: PostgreSQL connection pool (max 20)

### Query Optimization

1. **Automatic Index Suggestions**: Based on execution plans
2. **Query Rewriting**: LLM-based optimization
3. **Materialized Views**: Suggested for frequent patterns

---

## Extensibility

### Adding New LLM Providers

```typescript
class CustomProvider extends BaseLLMProvider {
  async generateCompletion(messages, options) {
    // Implementation
  }

  async generateEmbedding(text) {
    // Implementation
  }
}
```

### Adding New Agents

```typescript
class CustomAgent implements Agent {
  name = 'CustomAgent';

  async process(input: any): Promise<any> {
    // Implementation
  }
}
```

### Event System

```typescript
neurobase.on((event: NeuroBaseEvent) => {
  switch (event.type) {
    case 'query:start':
      // Handle query start
      break;
    case 'query:complete':
      // Handle completion
      break;
    // ...
  }
});
```

---

## Monitoring & Observability

### Logging

Uses **Pino** logger with configurable levels:
- Debug: Verbose internal operations
- Info: Query execution, optimization events
- Warn: Recoverable errors
- Error: Failures and exceptions

### Events

- `query:start` - Query begins processing
- `query:complete` - Query completed successfully
- `query:error` - Query failed
- `learning:new` - New learning entry stored
- `optimization:applied` - Optimization applied
- `schema:updated` - Schema cache refreshed

### Metrics

- Query execution time
- LLM token usage
- Cache hit rates
- Error rates
- Learning accuracy

---

## Future Enhancements

1. **Vector Database Integration** (pgvector)
2. **Advanced Query Caching** (Redis)
3. **Multi-tenancy Support**
4. **Real-time Collaboration**
5. **Query Performance Dashboard**
6. **Custom Agent Plugins**
7. **Federated Learning** across users
8. **Graph-based Schema Understanding**

---

For more details, see:
- [API Documentation](API.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Contributing Guidelines](CONTRIBUTING.md)
