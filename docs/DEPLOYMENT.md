# NeuroBase Deployment Guide

This guide covers deploying NeuroBase to production environments.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Tiger Cloud Setup](#tiger-cloud-setup)
3. [Local Development](#local-development)
4. [Production Deployment](#production-deployment)
5. [Environment Variables](#environment-variables)
6. [Security Considerations](#security-considerations)
7. [Monitoring](#monitoring)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required

- Node.js 18+ or Python 3.10+
- Tiger Data account (free tier available)
- At least one LLM provider:
  - OpenAI API key, OR
  - Anthropic API key, OR
  - Ollama running locally

### Recommended

- PostgreSQL client (`psql`) for database management
- `jq` for JSON processing
- `curl` for API testing

---

## Tiger Cloud Setup

### 1. Create Tiger Data Account

1. Visit [https://www.tigerdata.io/](https://www.tigerdata.io/)
2. Sign up for a free account
3. Verify your email

### 2. Install Tiger CLI

```bash
# Install Tiger CLI
curl -fsSL https://cli.tigerdata.com | sh

# Authenticate
tiger auth login

# Verify installation
tiger auth status
```

### 3. Create Database Service

```bash
# Create a new service
tiger service create --name neurobase-prod

# Get service details
tiger service list

# Get connection string
tiger db connection-string --service-id <your-service-id>
```

### 4. Initialize Database

```bash
# Connect to your database
tiger db connect --service-id <your-service-id>

# Run initialization script
\i sql/init.sql

# (Optional) Load sample data
\i sql/seed.sql

# Exit
\q
```

---

## Local Development

### 1. Clone Repository

```bash
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase
```

### 2. Install Dependencies

```bash
npm install
# or
yarn install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Database Configuration
DATABASE_URL=postgresql://tsdbadmin:your-password@your-service.tsdb.cloud.timescale.com:5432/tsdb?sslmode=require

# LLM Provider
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

### 4. Initialize NeuroBase

```bash
npm run init
```

### 5. Start Development Server

```bash
# Interactive CLI
npm run dev

# API Server
npm run serve
```

---

## Production Deployment

### Option 1: Docker Deployment

#### Create Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source
COPY src ./src
COPY sql ./sql

# Build
RUN npm run build

# Expose port
EXPOSE 3000

# Start
CMD ["node", "dist/api.js"]
```

#### Build and Run

```bash
# Build image
docker build -t neurobase:latest .

# Run container
docker run -d \
  --name neurobase \
  -p 3000:3000 \
  --env-file .env \
  neurobase:latest
```

#### Docker Compose

```yaml
version: '3.8'

services:
  neurobase:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - LLM_PROVIDER=${LLM_PROVIDER}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Option 2: Cloud Platform Deployment

#### Heroku

```bash
# Login to Heroku
heroku login

# Create app
heroku create neurobase-app

# Set environment variables
heroku config:set DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
heroku config:set OPENAI_API_KEY=sk-...

# Deploy
git push heroku main
```

#### Vercel / Netlify

For serverless deployment, use the API mode:

```javascript
// api/query.ts (Vercel Function)
import { NeuroBase } from '../src/core/neurobase';
import { config } from '../src/config';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query } = req.body;
  const nb = new NeuroBase(config);

  try {
    await nb.initialize();
    const result = await nb.query(query);
    await nb.close();

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
```

#### AWS EC2

```bash
# SSH into EC2 instance
ssh -i your-key.pem ubuntu@your-instance

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone repository
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase

# Install dependencies
npm install

# Build
npm run build

# Install PM2 for process management
sudo npm install -g pm2

# Start with PM2
pm2 start dist/api.js --name neurobase

# Save PM2 config
pm2 save
pm2 startup
```

---

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL/TimescaleDB connection string | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `LLM_PROVIDER` | LLM provider | `openai` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEUROBASE_MODE` | Mode of operation | `interactive` |
| `NEUROBASE_LOG_LEVEL` | Log level | `info` |
| `NEUROBASE_PORT` | API server port | `3000` |
| `ENABLE_LEARNING` | Enable learning | `true` |
| `ENABLE_OPTIMIZATION` | Enable query optimization | `true` |
| `READONLY_MODE` | Read-only mode | `false` |
| `MAX_QUERY_TIME` | Max query time (ms) | `30000` |
| `API_RATE_LIMIT` | Requests per 15 min | `100` |

---

## Security Considerations

### 1. Environment Variables

**Never commit `.env` files to version control.**

```bash
# Add to .gitignore
echo ".env" >> .gitignore
```

### 2. API Key Management

Use environment-specific secrets management:

- **Development**: `.env` file
- **Production**: Cloud provider secrets (AWS Secrets Manager, Heroku Config Vars, etc.)

### 3. Database Access

- Use SSL connections (enabled by default)
- Restrict database user permissions
- Enable read-only mode for production queries
- Set query timeouts

```env
READONLY_MODE=true
MAX_QUERY_TIME=10000  # 10 seconds
```

### 4. Rate Limiting

Configure rate limits to prevent abuse:

```env
API_RATE_LIMIT=100  # requests per 15 minutes
```

### 5. Network Security

- Use HTTPS for API endpoints
- Enable CORS with specific origins
- Use API authentication (JWT, API keys)

---

## Monitoring

### Application Logs

NeuroBase uses Pino for structured logging:

```bash
# View logs (PM2)
pm2 logs neurobase

# View logs (Docker)
docker logs -f neurobase

# JSON formatted logs for production
export NODE_ENV=production
```

### Health Checks

```bash
# Database connection
curl http://localhost:3000/health/db

# Service health
curl http://localhost:3000/health
```

### Metrics

Monitor these key metrics:

1. **Query Performance**
   - Average execution time
   - 95th percentile latency
   - Error rate

2. **LLM Usage**
   - Tokens consumed
   - API costs
   - Response times

3. **Database**
   - Connection pool utilization
   - Query execution times
   - Cache hit rates

4. **Learning System**
   - New entries per day
   - Correction rate
   - Confidence scores

### Log Aggregation

Use tools like:
- **ELK Stack** (Elasticsearch, Logstash, Kibana)
- **Splunk**
- **Datadog**
- **CloudWatch** (AWS)

---

## Troubleshooting

### Connection Issues

**Problem**: Cannot connect to Tiger Cloud database

```bash
# Test connection
tiger db test-connection --service-id <your-service-id>

# Check service status
tiger service get <your-service-id>

# Verify credentials
tiger auth status
```

### LLM API Errors

**Problem**: LLM provider returning errors

```bash
# Test OpenAI connection
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Test Anthropic connection
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":1024,"messages":[{"role":"user","content":"test"}]}'
```

### Performance Issues

**Problem**: Slow query execution

1. Enable query optimization:
   ```env
   ENABLE_OPTIMIZATION=true
   ```

2. Check execution plans:
   ```sql
   EXPLAIN ANALYZE SELECT ...;
   ```

3. Review indexes:
   ```sql
   SELECT * FROM pg_indexes WHERE schemaname = 'public';
   ```

### Memory Issues

**Problem**: High memory usage

1. Reduce connection pool size
2. Clear schema cache more frequently
3. Limit embedding cache size
4. Use smaller LLM models (Ollama)

---

## Backup and Recovery

### Database Backups

Tiger Cloud provides automatic backups. To create manual backups:

```bash
# Backup using pg_dump
tiger db connect --service-id <your-service-id> -- pg_dump > backup.sql

# Restore
tiger db connect --service-id <your-service-id> -- psql < backup.sql
```

### Learning Data Export

```sql
-- Export learning history
COPY neurobase_learning_history TO '/tmp/learning_backup.csv' CSV HEADER;

-- Export corrections
COPY neurobase_corrections TO '/tmp/corrections_backup.csv' CSV HEADER;
```

---

## Scaling

### Horizontal Scaling

Deploy multiple instances behind a load balancer:

```
┌─────────────┐
│Load Balancer│
└──────┬──────┘
       │
   ┌───┴────┬────────┬────────┐
   ▼        ▼        ▼        ▼
┌────┐   ┌────┐   ┌────┐   ┌────┐
│NB 1│   │NB 2│   │NB 3│   │NB 4│
└─┬──┘   └─┬──┘   └─┬──┘   └─┬──┘
  └────────┴────────┴────────┘
           │
    ┌──────▼──────┐
    │Tiger Cloud  │
    │  (Shared)   │
    └─────────────┘
```

### Caching Layer

Add Redis for query caching:

```typescript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Cache SQL translations
const cacheKey = `nl2sql:${hash(query)}`;
const cached = await redis.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

const result = await nb.query(query);
await redis.setex(cacheKey, 3600, JSON.stringify(result));
```

---

## Updates and Maintenance

### Updating NeuroBase

```bash
# Pull latest changes
git pull origin main

# Install dependencies
npm install

# Rebuild
npm run build

# Restart service
pm2 restart neurobase
```

### Database Migrations

```bash
# Create migration
tiger db connect -- psql <<EOF
ALTER TABLE neurobase_learning_history ADD COLUMN new_field TEXT;
EOF
```

---

## Support

For deployment issues:
- Check [GitHub Issues](https://github.com/4n0nn43x/neurobase/issues)
- Join [Discord Community](https://discord.gg/neurobase)
- Email: support@neurobase.dev

---

**Next Steps:**
- Review [Architecture](ARCHITECTURE.md)
- Explore [API Documentation](API.md)
- Read [Contributing Guide](CONTRIBUTING.md)
