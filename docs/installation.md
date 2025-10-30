# NeuroBase Installation Guide

Complete installation instructions for all platforms.

---

## System Requirements

### Minimum Requirements
- **OS**: Linux, macOS, or Windows (with WSL2)
- **Node.js**: v18.0.0 or higher
- **RAM**: 2 GB minimum (4 GB recommended)
- **Disk Space**: 500 MB for dependencies

### Recommended Requirements
- **Node.js**: v20.0.0+
- **RAM**: 8 GB
- **CPU**: Multi-core processor
- **Network**: Stable internet connection for LLM APIs

---

## Prerequisites

### 1. Node.js Installation

#### macOS

```bash
# Using Homebrew
brew install node@20

# Or using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

#### Linux

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Or using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

#### Windows

```powershell
# Download and install from nodejs.org
# Or use Chocolatey
choco install nodejs-lts

# Or use WSL2 (recommended)
wsl --install
# Then follow Linux instructions
```

### 2. Git Installation

```bash
# macOS
brew install git

# Linux
sudo apt-get install git

# Windows
# Download from git-scm.com
```

### 3. Tiger Data Account

1. Visit [https://www.tigerdata.io/](https://www.tigerdata.io/)
2. Click "Sign Up"
3. Verify your email
4. Note your credentials

### 4. LLM Provider

Choose one:

#### Option A: OpenAI (Recommended)

1. Visit [https://platform.openai.com/signup](https://platform.openai.com/signup)
2. Create account
3. Add payment method
4. Generate API key at [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
5. Copy key (starts with `sk-`)

**Cost**: ~$0.01 per query with GPT-4 Turbo

#### Option B: Anthropic Claude

1. Visit [https://console.anthropic.com/](https://console.anthropic.com/)
2. Create account
3. Add payment method
4. Generate API key
5. Copy key (starts with `sk-ant-`)

**Cost**: ~$0.015 per query with Claude 3.5 Sonnet

#### Option C: Ollama (Free, Local)

```bash
# macOS/Linux
curl https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3.2

# Start server
ollama serve
```

**Cost**: Free (runs locally)

---

## Installation Steps

### Step 1: Install Tiger CLI

```bash
# Install
curl -fsSL https://cli.tigerdata.com | sh

# Verify installation
tiger --version

# Authenticate
tiger auth login
```

Follow the prompts to log in with your Tiger Data credentials.

### Step 2: Create Tiger Cloud Database

```bash
# Create service
tiger service create --name neurobase-dev

# Get service ID (save this!)
tiger service list

# Get connection details
tiger db connection-string --service-id <your-service-id>
```

**Save the output!** You'll need:
- Service ID
- Host
- Port
- Database name
- Username
- Password

### Step 3: Clone NeuroBase

```bash
# Clone repository
git clone https://github.com/4n0nn43x/neurobase.git

# Navigate to directory
cd neurobase

# Check contents
ls -la
```

### Step 4: Install Dependencies

```bash
# Install all dependencies
npm install

# This will install:
# - TypeScript and build tools
# - Database drivers
# - LLM SDKs (OpenAI, Anthropic, Ollama)
# - CLI frameworks
# - Logging utilities
```

**Note**: This may take 2-5 minutes depending on your connection.

### Step 5: Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Open in your editor
nano .env
# or
code .env
# or
vim .env
```

Update with your credentials:

```env
# Database Configuration (from Step 2)
DATABASE_URL=postgresql://tsdbadmin:your-password@your-service.tsdb.cloud.timescale.com:5432/tsdb?sslmode=require

# LLM Provider (choose one)
LLM_PROVIDER=openai

# OpenAI Configuration
OPENAI_API_KEY=sk-your-actual-key-here
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_TEMPERATURE=0.1
OPENAI_MAX_TOKENS=2000

# Optional: Anthropic Configuration
# ANTHROPIC_API_KEY=sk-ant-your-key
# ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Optional: Ollama Configuration (if using local)
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.2

# NeuroBase Settings
NEUROBASE_MODE=interactive
NEUROBASE_LOG_LEVEL=info
NEUROBASE_PORT=3000

# Feature Flags
ENABLE_LEARNING=true
ENABLE_OPTIMIZATION=true
ENABLE_SCHEMA_SUGGESTIONS=true
ENABLE_QUERY_CACHE=true

# Security
API_RATE_LIMIT=100
READONLY_MODE=false
MAX_QUERY_TIME=30000
```

**⚠️ Important**: Never commit `.env` to version control!

### Step 6: Build TypeScript

```bash
# Compile TypeScript to JavaScript
npm run build

# Verify build succeeded
ls -la dist/
```

You should see compiled `.js` files in the `dist/` directory.

### Step 7: Initialize Database

```bash
# Run initialization script
npm run init
```

You'll see:

```
🧠 NeuroBase Database Initialization

Connecting to database...
✓ Database connection successful
✓ NeuroBase tables created

Do you want to load sample e-commerce data? (y/n):
```

Type `y` to load sample data (recommended for first-time setup).

Output:

```
Loading sample data...
✓ Schema created
✓ Sample data loaded

Database Statistics:
  Size: 125 MB
  Tables: 5
  Views: 2
  Functions: 3

✓ Initialization complete!
```

### Step 8: Verify Installation

```bash
# Test database connection
tiger db test-connection --service-id <your-service-id>

# Should show:
# ✓ Connection successful
```

---

## First Run

### Interactive CLI

```bash
npm start
```

You should see:

```
🧠 NeuroBase - Intelligent Database Interface

Type your questions in natural language.
Commands: .exit, .help, .schema, .stats, .clear

NeuroBase>
```

Try your first query:

```
NeuroBase> Show me all users
```

### API Server

```bash
npm run serve
```

You should see:

```
NeuroBase API server listening on port 3000
Database connected
Ready to accept queries
```

Test with curl:

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Show me all users"}'
```

---

## Troubleshooting

### Common Issues

#### "Cannot find module"

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### "Connection refused" (Tiger Cloud)

```bash
# Verify service is running
tiger service get <your-service-id>

# Check connection string
tiger db connection-string --service-id <your-service-id>

# Test connection
tiger db test-connection --service-id <your-service-id>
```

#### "Invalid API key" (LLM)

```bash
# Verify OpenAI key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Check .env file
cat .env | grep API_KEY
```

#### "Port already in use"

```bash
# Change port in .env
echo "NEUROBASE_PORT=3001" >> .env

# Or kill existing process
lsof -ti:3000 | xargs kill -9
```

#### TypeScript compilation errors

```bash
# Update TypeScript
npm install -g typescript@latest

# Clean build
rm -rf dist/
npm run build
```

---

## Platform-Specific Notes

### macOS

- Uses native SSL for database connections
- Ollama works natively
- Recommended: Use iTerm2 for better CLI experience

### Linux

- May need to install build tools:
  ```bash
  sudo apt-get install build-essential
  ```
- Ollama requires CUDA for GPU acceleration (optional)

### Windows (WSL2)

- **Strongly recommended** to use WSL2
- Install WSL2:
  ```powershell
  wsl --install
  ```
- Then follow Linux instructions inside WSL2
- Native Windows support is experimental

---

## Optional Enhancements

### 1. Install Prettier (Code Formatting)

```bash
npm install --save-dev prettier
```

### 2. Install ESLint (Code Linting)

```bash
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

### 3. Install Jest (Testing)

```bash
npm install --save-dev jest @types/jest ts-jest
```

### 4. Use PM2 (Process Management)

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start dist/api.js --name neurobase

# Monitor
pm2 monit

# Logs
pm2 logs neurobase

# Auto-restart on file changes
pm2 start dist/api.js --name neurobase --watch
```

---

## Updating

### Pull Latest Changes

```bash
git pull origin main
npm install
npm run build
```

### Update Dependencies

```bash
npm update
npm audit fix
```

---

## Uninstalling

### Remove NeuroBase

```bash
cd ..
rm -rf neurobase
```

### Remove Tiger CLI

```bash
rm $(which tiger)
```

### Delete Tiger Cloud Service

```bash
tiger service delete --service-id <your-service-id>
```

---

## Next Steps

✅ Installation complete!

Now:
1. Read [QUICKSTART.md](QUICKSTART.md) for usage examples
2. Explore [README.md](README.md) for full documentation
3. Check [docs/API.md](docs/API.md) for API reference
4. Try example queries from [sql/seed.sql](sql/seed.sql)

---

## Support

- **Issues**: [GitHub Issues](https://github.com/4n0nn43x/neurobase/issues)
- **Discussions**: [GitHub Discussions](https://github.com/4n0nn43x/neurobase/discussions)
- **Email**: support@neurobase.dev

---

**Happy querying! 🧠✨**
