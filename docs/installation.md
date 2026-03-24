# Installation Guide

## Requirements

- **Node.js** 18+ (20+ recommended)
- **Database**: PostgreSQL, MySQL, SQLite, or MongoDB
- **LLM provider**: OpenAI API key, Anthropic API key, or Ollama (local, free)

## Option 1: npx (fastest)

```bash
npx neurobase setup        # interactive configuration wizard
npx neurobase interactive  # start querying
```

No installation needed. Runs directly from npm.

## Option 2: Global install

```bash
npm install -g neurobase
neurobase setup
neurobase interactive
```

## Option 3: Docker

```bash
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase
cp .env.example .env
# Edit .env with your credentials
docker compose up
```

This starts NeuroBase + PostgreSQL. The API is available at `http://localhost:3000`.

## Option 4: From source

```bash
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase
npm install
```

### Configure

**Interactive wizard (recommended):**

```bash
npx tsx src/cli.ts setup
```

This walks you through database, LLM provider, features, and privacy settings.

**Manual configuration:**

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Database
DB_ENGINE=postgresql
DATABASE_URL=postgresql://user:password@localhost:5432/mydb

# LLM Provider (choose one)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Or OpenAI
# LLM_PROVIDER=openai
# OPENAI_API_KEY=sk-...

# Or Ollama (free, local)
# LLM_PROVIDER=ollama
# OLLAMA_MODEL=llama3.2

# Features
ENABLE_LEARNING=true
ENABLE_OPTIMIZATION=true
ENABLE_SELF_CORRECTION=true
ENABLE_MULTI_CANDIDATE=false

# Privacy (strict | schema-only | permissive)
PRIVACY_MODE=schema-only
```

### Initialize database

```bash
npm run init
```

When prompted, type `y` to load sample e-commerce data (recommended for first run).

### Start

```bash
# Interactive CLI
npm run dev

# API server
npm run serve

# Multi-agent API + dashboard
npm run serve:multi-agent

# MCP server (for Claude Desktop / Cursor)
npm run serve:mcp
```

## LLM Provider Setup

### Anthropic (Claude)

1. Create account at [console.anthropic.com](https://console.anthropic.com/)
2. Generate API key
3. Set in `.env`:
   ```env
   LLM_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-sonnet-4-20250514
   ```

### OpenAI

1. Create account at [platform.openai.com](https://platform.openai.com/)
2. Generate API key
3. Set in `.env`:
   ```env
   LLM_PROVIDER=openai
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4-turbo-preview
   ```

### Ollama (free, local)

```bash
# Install Ollama
curl https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3.2

# Ollama starts automatically
```

Set in `.env`:
```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=llama3.2
OLLAMA_BASE_URL=http://localhost:11434
```

## MCP Server Setup (Claude Desktop)

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "neurobase": {
      "command": "npx",
      "args": ["tsx", "/path/to/neurobase/src/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/mydb",
        "LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Tools available: `query`, `schema`, `explain`, `correct`, `diagnose`, `stats`.

## Semantic Model (optional)

To define business concepts, copy and customize:

```bash
cp neurobase.semantic.example.yml neurobase.semantic.yml
```

When present, the LLM uses your business terms ("revenue", "active customer") instead of raw column names.

## Verify Installation

```bash
# Type check
npm run typecheck

# Run tests
npm test

# Try a query
npx tsx src/cli.ts query "show all tables"
```

## Troubleshooting

### "Cannot find module"
```bash
rm -rf node_modules package-lock.json
npm install
```

### "Connection refused"
Check that your database is running and `DATABASE_URL` is correct.

### "Invalid API key"
Verify your API key in `.env`. Test directly:
```bash
# OpenAI
curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"

# Anthropic
curl https://api.anthropic.com/v1/messages -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"
```

### "Port already in use"
```bash
NEUROBASE_PORT=3001 npm run serve
```

## Updating

```bash
git pull origin main
npm install
npm run build
```
