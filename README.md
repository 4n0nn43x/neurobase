# NeuroBase 🧠

**An intelligent, self-learning conversational database system**

NeuroBase transforms PostgreSQL into a cognitive system that understands natural language, automatically optimizes queries, and learns from every interaction through autonomous AI agents.

---

## 🎯 Vision

> "You don't speak SQL to your database anymore. Your database understands you and becomes smarter with every question."

NeuroBase is a **learning database system** featuring:

- 🗣️ **Natural language queries** - Ask questions in plain English
- ⚡ **Automatic SQL generation** - Context-aware translation
- 🧠 **Continuous learning** - Improves from corrections
- 🤖 **Multi-agent architecture** - Specialized AI agents on isolated forks
- 🔍 **Query optimization** - Automatic performance tuning
- 💾 **Context retention** - Remembers conversation history
- 🔄 **Zero-copy forks** - Safe testing environment for agents

---

## 🏗️ Architecture

### Core System

```
┌─────────────────────────────────────────────────────────┐
│                    NeuroBase Core                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Linguistic  │  │  Optimizer   │  │   Memory     │ │
│  │    Agent     │  │    Agent     │  │   Agent      │ │
│  │              │  │              │  │              │ │
│  │ NL → SQL     │  │ Performance  │  │ Learning     │ │
│  │ Translation  │  │ Analysis     │  │ Engine       │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│         │                  │                  │        │
│         └──────────────────┼──────────────────┘        │
│                            │                           │
└────────────────────────────┼───────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   PostgreSQL    │
                    │  (Tiger Cloud)  │
                    └─────────────────┘
```

### Multi-Agent System

```
Multi-Agent Orchestrator (Main DB)
├── Agent Registry & Task Queue
├── Event System & Monitoring
└── Inter-Agent Communication

Specialized Agents (Each on Fork)
├── Schema Evolution Agent → Optimizes database structure
├── Query Validator Agent → Validates before execution
├── Learning Aggregator Agent → Synthesizes insights
└── A/B Testing Agent → Tests strategies in parallel

Fork Synchronizer
└── Shares knowledge across agents
```

---

## ✨ Features

### Core Capabilities

- ✅ **Natural Language Interface** - SQL-free queries
- ✅ **Multi-LLM Support** - OpenAI, Anthropic Claude, Ollama
- ✅ **Automatic SQL Generation** - Intelligent translation
- ✅ **Query Optimization** - Performance analysis and tuning
- ✅ **Learning System** - Improves with each interaction
- ✅ **Schema Awareness** - Understands database structure
- ✅ **Context Memory** - Conversational interface
- ✅ **Transparent Mode** - Shows generated SQL

### Multi-Agent Features

- 🤖 **Schema Evolution** - Analyzes patterns, recommends optimizations
- ✅ **Query Validation** - Safety checks before execution
- 🧠 **Learning Aggregation** - Cross-agent insights
- 🧪 **A/B Testing** - Parallel strategy comparison
- 🔄 **Fork Synchronization** - Knowledge sharing
- 📊 **Real-Time Dashboard** - Web-based monitoring
- 🎯 **Event System** - Activity tracking

### Advanced Features

- 🔄 **Zero-Copy Forks** - Instant isolated environments
- 📊 **Performance Analytics** - Query tracking
- 🔐 **Safe Execution** - Read-only mode
- 🎯 **Intent Recognition** - Goal understanding
- 📝 **Audit Trail** - Complete history
- 🧬 **Local Embeddings** - Privacy-focused semantic search
- 🚀 **pgvector Integration** - Native vector search

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+
- **PostgreSQL** database (Tiger Cloud recommended)
- **Tiger CLI** (for fork management)
- At least one LLM provider:
  - OpenAI API key, OR
  - Anthropic API key, OR
  - Ollama running locally

### Installation

```bash
# Clone repository
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Initialize database
npm run init
```

### Configuration

Edit `.env`:

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require

# LLM Provider
LLM_PROVIDER=openai  # Options: openai, anthropic, ollama

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4-turbo-preview

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# Multi-Agent
ENABLE_MULTI_AGENT=true
```

### Run

```bash
# Interactive CLI
npm start

# API Server
npm run serve

# Multi-Agent API with Dashboard
npm run serve:multi-agent

# Development mode
npm run dev
npm run dev:multi-agent
```

---

## 💻 Usage

### CLI Mode

```bash
npm start
```

```
NeuroBase> Show me users who signed up today

🧠 Analyzing query...
📝 Generated SQL:
   SELECT * FROM users
   WHERE created_at::date = CURRENT_DATE;

⚡ Execution time: 23ms

┌────┬─────────────┬──────────────────┬─────────────────────┐
│ id │ name        │ email            │ created_at          │
├────┼─────────────┼──────────────────┼─────────────────────┤
│ 42 │ John Smith  │ john@example.com │ 2025-10-31 10:15:00 │
│ 43 │ Jane Doe    │ jane@example.com │ 2025-10-31 14:30:00 │
└────┴─────────────┴──────────────────┴─────────────────────┘

💡 Learned: "users who signed up today" → created_at::date = CURRENT_DATE
```

### API Mode

```bash
npm run serve
```

```javascript
// Query endpoint
const response = await fetch('http://localhost:3000/api/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: "Show me top 10 products by revenue",
    includeExplanation: true
  })
});

const result = await response.json();
console.log(result.data);
console.log(result.sql);
```

### Multi-Agent Mode

```bash
npm run serve:multi-agent
```

Access dashboard: `http://localhost:3000/dashboard`

```javascript
// Register agent
await fetch('http://localhost:3000/api/agents/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Schema Evolution Agent',
    type: 'schema-evolution',
    enabled: true,
    forkStrategy: 'now'
  })
});
```

### Programmatic

```typescript
import { NeuroBase } from 'neurobase';

const nb = new NeuroBase({
  provider: 'openai',
  connectionString: process.env.DATABASE_URL
});

await nb.initialize();

const result = await nb.query(
  "Which products had highest sales last quarter?"
);

console.log(result.data);
console.log(result.sql);
```

---

## 🤖 Multi-Agent System

### Specialized Agents

#### Schema Evolution Agent
Analyzes query patterns and recommends database optimizations.

```typescript
import { SchemaEvolutionAgent } from 'neurobase/agents';

const agent = new SchemaEvolutionAgent(pool, llmProvider);
const analysis = await agent.analyzeAndRecommend();

// Test recommendations on fork
for (const rec of analysis.recommendations) {
  const result = await agent.testRecommendation(rec);
  if (result.performanceGain > 30) {
    await agent.applyRecommendation(rec, mainPool);
  }
}
```

#### Query Validator Agent
Validates queries for safety and performance before execution.

```typescript
import { QueryValidatorAgent } from 'neurobase/agents';

const validator = new QueryValidatorAgent(pool);
const validation = await validator.validateQuery(sql);

if (!validation.isSafe) {
  throw new Error(`Unsafe query: ${validation.errors}`);
}
```

#### Learning Aggregator Agent
Synthesizes insights from all agents.

```typescript
import { LearningAggregatorAgent } from 'neurobase/agents';

const aggregator = new LearningAggregatorAgent(pool);
const insights = await aggregator.aggregateAndSynthesize();

// Get actionable high-impact insights
const important = await aggregator.getInsights({
  actionable: true,
  impact: 'high'
});
```

#### A/B Testing Agent
Tests multiple strategies in parallel.

```typescript
import { ABTestingAgent } from 'neurobase/agents';

const experiment = await abTesting.createExperiment(
  "SQL Strategies",
  "Compare approaches",
  [strategyA, strategyB, strategyC]
);

await abTesting.startExperiment(experiment.id);
const results = await abTesting.analyzeResults(experiment.id);
console.log(`Winner: ${results.winner}`);
```

### Orchestrator

```typescript
import { MultiAgentOrchestrator } from 'neurobase/orchestrator';

const orchestrator = new MultiAgentOrchestrator(DATABASE_URL);
await orchestrator.initialize();

// Register and start agent
const agent = await orchestrator.registerAgent({
  name: 'My Agent',
  type: 'schema-evolution',
  enabled: true,
  forkStrategy: 'now',
  autoStart: true
});

// Submit task
const taskId = await orchestrator.submitTask(
  agent.id,
  'analyze',
  { timeframe: '7 days' }
);
```

---

## 📊 Monitoring Dashboard

Access at `http://localhost:3000/dashboard`

Features:
- 📈 Real-time system metrics
- 🤖 Agent status and performance
- 🔄 Synchronization statistics
- 📝 Live event stream
- ⚡ Performance analytics
- 🎯 Auto-refresh (10 seconds)

---

## 📚 Documentation

- **[Architecture Guide](docs/architecture.md)** - System design and components
- **[API Reference](docs/api-reference.md)** - Complete API documentation
- **[Multi-Agent System](docs/multi-agent-system.md)** - Agent details and usage
- **[Quick Start](docs/quickstart.md)** - Get started in 5 minutes
- **[Installation](docs/installation.md)** - Detailed setup guide

---

## 🧪 Examples

See `examples/` directory:
- `multi-agent-demo.ts` - Complete multi-agent demo
- More examples coming soon

Run demo:
```bash
npx tsx examples/multi-agent-demo.ts
```

---

## 🧪 Testing

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# All tests with coverage
npm run test:all
```

---

## 📈 Performance

- **Query Translation**: <500ms (LLM dependent)
- **Local Ollama**: <200ms for small models
- **Fork Creation**: ~2 seconds (zero-copy)
- **Schema Caching**: 5-minute TTL
- **Embedding Generation**: <100ms (local)
- **Sync Rate**: 100-1000 records/second

---

## 🛡️ Security

- **Parameterized Queries** - SQL injection prevention
- **Query Validation** - Dangerous pattern detection
- **Read-Only Mode** - Restrict to SELECT
- **API Rate Limiting** - 100 requests per 15 minutes
- **Query Timeout** - 30 second maximum
- **Fork Isolation** - Complete separation

---

## 🔧 Development

```bash
# Build
npm run build

# Type checking
npm run typecheck

# Linting
npm run lint

# Format code
npm run format

# Watch mode
npm run dev
```

---

## 🗺️ Roadmap

### Current
- ✅ Multi-agent architecture
- ✅ Natural language to SQL
- ✅ Multi-LLM support
- ✅ Learning system
- ✅ Real-time dashboard

### Planned
- 🔄 Advanced analytics
- 🔄 Custom agent plugins
- 🔄 Web UI for query building
- 🔄 VS Code extension
- 🔄 Query templates marketplace

---

## 🤝 Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- **Tiger Data** for Agentic Postgres and zero-copy forks
- **Anthropic** for Claude and Model Context Protocol
- **OpenAI** for GPT models
- **Ollama** for local LLM support
- The open-source community

---

## 📞 Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/4n0nn43x/neurobase/issues)
- **Discussions**: [GitHub Discussions](https://github.com/4n0nn43x/neurobase/discussions)

---

## 🌟 Star Us!

If you find NeuroBase useful, please star the repository!

---

**Built with ❤️ using PostgreSQL, Tiger Cloud, and AI**
