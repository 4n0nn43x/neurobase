# NeuroBase 🧠

**An intelligent, self-learning conversational database built on Agentic Postgres**

NeuroBase transforms PostgreSQL into a cognitive system that understands natural language, automatically optimizes queries, and learns from every interaction. Built for the [Tiger Data Agentic Postgres Challenge](https://dev.to/devteam/join-the-agentic-postgres-challenge-with-tiger-data-3000-in-prizes-17ip).

---

## 🎯 Vision

> "You don't speak SQL to your database anymore. Your database understands you and becomes smarter with every question."

NeuroBase is not just a natural language interface to SQL—it's a **learning database system** that:

- 🗣️ **Understands natural language queries** in plain English
- ⚡ **Generates optimized SQL** automatically
- 🧠 **Learns from corrections** and improves over time
- 🔍 **Optimizes performance** by analyzing query execution
- 💾 **Remembers context** across conversations
- 🤖 **Supports multiple LLM providers** (OpenAI, Anthropic, Ollama)

---

## 🏗️ Architecture

NeuroBase uses a **multi-agent architecture** powered by Tiger Data's MCP (Model Context Protocol):

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
                    │  Agentic        │
                    │  Postgres       │
                    │  (Tiger Cloud)  │
                    └─────────────────┘
```

### Agents

#### 1. **Linguistic Agent** 🗣️
- Translates natural language to SQL
- Uses schema introspection to understand table structures
- Supports multiple LLM backends (OpenAI GPT-4, Claude, Ollama)
- Handles ambiguous queries with clarifying questions

#### 2. **Optimizer Agent** ⚡
- Analyzes query execution plans (`EXPLAIN ANALYZE`)
- Suggests and applies index optimizations
- Rewrites queries for better performance
- Monitors query execution times

#### 3. **Memory Agent** 🧠
- Stores interaction history (NL query ↔ SQL mapping)
- Creates embeddings for semantic search
- Learns from user corrections
- Builds contextual understanding over time

---

## 🚀 Features

### Core Capabilities

- ✅ **Natural Language Queries**: Ask questions in plain English
- ✅ **Multi-LLM Support**: OpenAI, Anthropic Claude, and Ollama (local models)
- ✅ **Automatic SQL Generation**: Context-aware SQL from natural language
- ✅ **Query Optimization**: Automatic performance tuning
- ✅ **Learning System**: Improves accuracy with each interaction
- ✅ **Schema Awareness**: Understands your database structure
- ✅ **Context Retention**: Remembers previous queries in conversation
- ✅ **Transparent Mode**: Shows generated SQL and execution plans
- ✅ **Error Recovery**: Learns from mistakes and corrections

### Advanced Features

- 🔄 **Adaptive Schema Evolution**: Suggests materialized views for common queries
- 📊 **Performance Analytics**: Tracks and visualizes query performance
- 🔐 **Safe Execution**: Read-only mode for production databases
- 🎯 **Intent Recognition**: Understands user goals beyond literal queries
- 📝 **Interaction History**: Full audit trail of all conversations

---

## 📋 Prerequisites

- **Node.js** 18+ or **Python** 3.10+
- **Tiger Data Account** (free tier available)
- **Tiger CLI** installed
- At least one LLM provider:
  - OpenAI API key, OR
  - Anthropic API key, OR
  - Ollama running locally

---

## 🔧 Installation

### 1. Install Tiger CLI

```bash
curl -fsSL https://cli.tigerdata.com | sh
tiger auth login
```

### 2. Clone and Install NeuroBase

```bash
git clone https://github.com/yourusername/neurobase.git
cd neurobase
npm install
# or for Python: pip install -r requirements.txt
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Tiger Data Configuration
TIGER_SERVICE_ID=your-service-id

# LLM Provider (choose one or more)
LLM_PROVIDER=openai  # Options: openai, anthropic, ollama

# OpenAI Configuration
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4-turbo-preview

# Anthropic Configuration
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Ollama Configuration (local)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# NeuroBase Configuration
NEUROBASE_MODE=interactive  # interactive, api, readonly
NEUROBASE_LOG_LEVEL=info
ENABLE_LEARNING=true
ENABLE_OPTIMIZATION=true
```

### 4. Initialize Database

```bash
npm run init
# This creates the necessary tables for memory/learning
```

---

## 🎮 Usage

### Interactive CLI Mode

```bash
npm start
```

Example conversation:

```
NeuroBase> Show me the top 5 customers by total purchases this month

🧠 Analyzing query...
📝 Generated SQL:
   SELECT c.name, SUM(o.total) as total_purchases
   FROM customers c
   JOIN orders o ON c.id = o.customer_id
   WHERE o.order_date >= date_trunc('month', current_date)
   GROUP BY c.name
   ORDER BY total_purchases DESC
   LIMIT 5;

⚡ Execution time: 45ms

┌──────────────┬─────────────────┐
│ name         │ total_purchases │
├──────────────┼─────────────────┤
│ John Smith   │ $5,240.00       │
│ Alice Brown  │ $4,890.00       │
│ Bob Johnson  │ $3,750.00       │
│ Carol White  │ $3,200.00       │
│ David Lee    │ $2,980.00       │
└──────────────┴─────────────────┘

💡 Learned: "top N by total purchases" → SUM() + GROUP BY + ORDER BY + LIMIT

NeuroBase> What about last month?

🧠 Using context from previous query...
📝 Generated SQL:
   [Same query with adjusted date range]
...
```

### API Mode

```bash
npm run serve
```

```javascript
// Query the API
const response = await fetch('http://localhost:3000/api/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: "Show me products that are running low on stock",
    userId: "user123",
    includeExplanation: true
  })
});

const result = await response.json();
console.log(result.data);
```

### Programmatic Usage

```javascript
import { NeuroBase } from 'neurobase';

const nb = new NeuroBase({
  provider: 'openai',
  serviceId: 'your-service-id',
  enableLearning: true
});

const result = await nb.query(
  "Which products had the highest sales growth last quarter?"
);

console.log(result.data);
console.log(result.sql);
console.log(result.explanation);
```

---

## 🧪 Examples

### Example 1: Simple Query

```
User: "How many users signed up today?"

NeuroBase generates:
SELECT COUNT(*) FROM users
WHERE created_at::date = CURRENT_DATE;
```

### Example 2: Complex Aggregation

```
User: "Show me average order value by product category for the last 6 months"

NeuroBase generates:
SELECT
  pc.name AS category,
  AVG(oi.price * oi.quantity) AS avg_order_value,
  COUNT(DISTINCT o.id) AS order_count
FROM product_categories pc
JOIN products p ON pc.id = p.category_id
JOIN order_items oi ON p.id = oi.product_id
JOIN orders o ON oi.order_id = o.id
WHERE o.created_at >= CURRENT_DATE - INTERVAL '6 months'
GROUP BY pc.name
ORDER BY avg_order_value DESC;
```

### Example 3: Learning from Corrections

```
User: "Show me inactive customers"

NeuroBase: [generates SQL with WHERE last_login < 30 days]

User: "No, I mean customers who haven't ordered in 90 days"

NeuroBase:
✅ Correction learned! Updated definition:
   "inactive customers" → no orders in 90 days

[Stores this mapping for future queries]
```

---

## 🏗️ Project Structure

```
neurobase/
├── src/
│   ├── agents/
│   │   ├── linguistic.ts      # NL → SQL translation
│   │   ├── optimizer.ts       # Query optimization
│   │   └── memory.ts          # Learning & context
│   ├── core/
│   │   ├── neurobase.ts       # Main orchestrator
│   │   ├── database.ts        # Tiger Cloud connection
│   │   └── schema.ts          # Schema introspection
│   ├── llm/
│   │   ├── providers/
│   │   │   ├── openai.ts      # OpenAI integration
│   │   │   ├── anthropic.ts   # Claude integration
│   │   │   └── ollama.ts      # Ollama integration
│   │   └── base.ts            # LLM provider interface
│   ├── ui/
│   │   ├── cli.ts             # Interactive CLI
│   │   └── api.ts             # REST API server
│   └── utils/
│       ├── logger.ts
│       ├── validator.ts
│       └── embeddings.ts
├── examples/
│   ├── ecommerce/             # E-commerce demo
│   ├── analytics/             # Analytics demo
│   └── crm/                   # CRM demo
├── docs/
│   ├── ARCHITECTURE.md        # Detailed architecture
│   ├── API.md                 # API documentation
│   ├── DEPLOYMENT.md          # Deployment guide
│   └── CONTRIBUTING.md        # Contribution guidelines
├── sql/
│   ├── init.sql               # Initial schema
│   └── seed.sql               # Sample data
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🧪 Running Tests

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

## 📊 Performance

NeuroBase is designed for performance:

- **Query Translation**: < 500ms (depends on LLM provider)
- **Local Ollama**: < 200ms for small models
- **Schema Caching**: Reduces introspection overhead
- **Connection Pooling**: Efficient database connections
- **Embedding Cache**: Fast semantic search for learned queries

---

## 🛡️ Security

- **Read-only mode** for production databases
- **Parameterized queries** prevent SQL injection
- **API key encryption** at rest
- **Audit logging** for all queries
- **Rate limiting** on API endpoints

---

## 🗺️ Roadmap

### Phase 1: Core (Current)
- ✅ Multi-agent architecture
- ✅ Natural language to SQL
- ✅ Multi-LLM support
- ✅ Basic learning system

### Phase 2: Intelligence
- 🔄 Advanced context retention
- 🔄 Cross-query optimization
- 🔄 Automatic materialized view suggestions
- 🔄 Performance regression detection

### Phase 3: Ecosystem
- ⏳ Web UI dashboard
- ⏳ VS Code extension
- ⏳ Slack/Discord bot integration
- ⏳ Query templates marketplace

### Phase 4: Enterprise
- ⏳ Multi-tenant support
- ⏳ Role-based access control
- ⏳ Advanced analytics
- ⏳ Custom agent plugins

---

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- **Tiger Data** for Agentic Postgres and the hackathon
- **Anthropic** for Claude and the Model Context Protocol
- **OpenAI** for GPT models
- **Ollama** for local LLM support
- The open-source community

---

## 📞 Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/yourusername/neurobase/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/neurobase/discussions)
- **Email**: support@neurobase.dev

---

## 🌟 Star Us!

If you find NeuroBase useful, please consider starring the repository!

---

**Built with ❤️ for the Tiger Data Agentic Postgres Challenge**
