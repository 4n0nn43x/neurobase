# NeuroBase Quick Start Guide

Get started with NeuroBase in 5 minutes!

---

## Prerequisites

- Node.js 18+ installed
- Tiger Data account (free)
- OpenAI API key (or Anthropic/Ollama)

---

## Step 1: Get Tiger Data Credentials

### Create Account

1. Visit [https://www.tigerdata.io/](https://www.tigerdata.io/)
2. Sign up for free account
3. Verify your email

### Install Tiger CLI

```bash
curl -fsSL https://cli.tigerdata.com | sh
tiger auth login
```

### Create Database

```bash
# Create service
tiger service create --name my-neurobase

# Get connection details (save these!)
tiger db connection-string
```

---

## Step 2: Get LLM API Key

### Option A: OpenAI (Recommended)

1. Visit [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create new API key
3. Copy the key (starts with `sk-...`)

### Option B: Anthropic

1. Visit [https://console.anthropic.com/](https://console.anthropic.com/)
2. Create API key
3. Copy the key (starts with `sk-ant-...`)

### Option C: Ollama (Local, Free)

```bash
# Install Ollama
curl https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3.2

# Start Ollama server
ollama serve
```

---

## Step 3: Install NeuroBase

```bash
# Clone repository
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase

# Install dependencies
npm install
```

---

## Step 4: Configure

```bash
# Copy environment template
cp .env.example .env
```

Edit `.env`:

```env
# Tiger Data (from Step 1)
TIGER_SERVICE_ID=your-service-id
TIGER_DB_HOST=your-host.tigerdata.cloud
TIGER_DB_PORT=5432
TIGER_DB_NAME=tsdb
TIGER_DB_USER=postgres
TIGER_DB_PASSWORD=your-password

# LLM Provider (from Step 2)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4-turbo-preview
```

---

## Step 5: Initialize

```bash
npm run init
```

When prompted, type `y` to load sample e-commerce data.

You should see:

```
✓ Database connection successful
✓ NeuroBase tables created
✓ Schema created
✓ Sample data loaded

Database Statistics:
  Size: 125 MB
  Tables: 5
  Views: 2
  Functions: 3
```

---

## Step 6: Start Using NeuroBase!

### Interactive CLI

```bash
npm start
```

Try these queries:

```
NeuroBase> Show me all users

NeuroBase> What are the top 5 products by sales?

NeuroBase> How many orders were placed this week?

NeuroBase> Show me users who haven't ordered in 30 days
```

### API Server

```bash
npm run serve
```

Then query via HTTP:

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Show me all active users"}'
```

### Programmatic Usage

```typescript
import { NeuroBase, loadConfig } from 'neurobase';

const config = loadConfig();
const nb = new NeuroBase(config);

await nb.initialize();

const result = await nb.query("Show me recent orders");
console.log(result.data);

await nb.close();
```

---

## Example Queries to Try

### Basic Queries

```
"Show me all users"
"How many products do we have?"
"List all categories"
```

### Aggregations

```
"What's the total sales this month?"
"Show me average order value by category"
"Count orders by status"
```

### Joins

```
"Show me users with their orders"
"List products with their categories"
"Show me orders with customer names"
```

### Filters

```
"Show me users created this week"
"Find products with price over $500"
"Show me pending orders"
```

### Complex Queries

```
"Show me the top 5 customers by total spending"
"What products have the highest ratings?"
"Which categories have the most sales?"
```

---

## Understanding the Output

```
NeuroBase> Show me the top 5 customers by total purchases

🧠 Analyzing query...

💡 This query finds customers with highest purchase totals

📝 Generated SQL:
   SELECT u.name, SUM(o.total_amount) as total
   FROM users u
   JOIN orders o ON u.id = o.user_id
   GROUP BY u.name
   ORDER BY total DESC
   LIMIT 5;

⚡ Execution time: 45ms

📊 Results (5 rows):

┌──────────────┬──────────┐
│ name         │ total    │
├──────────────┼──────────┤
│ John Smith   │ $5240.00 │
│ Alice Brown  │ $4890.00 │
│ Bob Johnson  │ $3750.00 │
│ Carol White  │ $3200.00 │
│ David Lee    │ $2980.00 │
└──────────────┴──────────┘

✓ Learned from this interaction
```

---

## Learning in Action

### First Time

```
NeuroBase> Show me inactive customers
```

NeuroBase generates SQL based on general understanding.

### Correction

```
NeuroBase> Actually, I meant customers who haven't ordered in 90 days

💡 Got it! Updating my understanding...
```

### Next Time

```
NeuroBase> Show me inactive customers
```

NeuroBase now remembers: "inactive" = no orders in 90 days!

---

## CLI Commands

While in interactive mode:

- `.exit` - Exit NeuroBase
- `.help` - Show help
- `.schema` - Display database schema
- `.stats` - Show statistics
- `.clear` - Clear screen

---

## Troubleshooting

### "Cannot connect to database"

```bash
# Test connection
tiger db test-connection --service-id your-service-id

# Verify credentials in .env
cat .env | grep TIGER
```

### "Invalid API key"

```bash
# Verify OpenAI key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Check .env
cat .env | grep OPENAI
```

### "Module not found"

```bash
# Reinstall dependencies
rm -rf node_modules
npm install
```

---

## Next Steps

### Learn More

- [Full Documentation](README.md)
- [Architecture Guide](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)

### Try Advanced Features

1. **Query Optimization**
   ```env
   ENABLE_OPTIMIZATION=true
   ```

2. **Multiple LLM Providers**
   ```bash
   # Try Anthropic
   LLM_PROVIDER=anthropic

   # Try Ollama (local)
   LLM_PROVIDER=ollama
   ```

3. **Use Your Own Data**
   - Connect to your existing database
   - Update TIGER_* credentials
   - Skip sample data during init

### Build Something Cool

Ideas for projects:
- Slack bot for database queries
- Analytics dashboard
- Customer support tool
- Internal data exploration tool

---

## Get Help

- [GitHub Issues](https://github.com/4n0nn43x/neurobase/issues)
- [Discussions](https://github.com/4n0nn43x/neurobase/discussions)
- [Discord](https://discord.gg/neurobase)
- Email: support@neurobase.dev

---

## What's Happening Under the Hood?

```
Your Query
    │
    ▼
┌─────────────────┐
│Linguistic Agent │  ← Understands your question
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Generate SQL   │  ← Creates optimized PostgreSQL
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Execute Query   │  ← Runs on Tiger Cloud
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Memory Agent    │  ← Learns for next time
└────────┬────────┘
         │
         ▼
    Results!
```

---

**You're all set! Start asking questions in natural language! 🧠✨**
