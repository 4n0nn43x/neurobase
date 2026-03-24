# Guide d'installation

## Pre-requis

- **Node.js** 18+ (20+ recommande)
- **Base de donnees** : PostgreSQL, MySQL, SQLite ou MongoDB
- **Fournisseur LLM** : cle API OpenAI, cle API Anthropic, ou Ollama (local, gratuit)

## Option 1 : npx (le plus rapide)

```bash
npx neurobase setup        # assistant de configuration interactif
npx neurobase interactive  # commencer a interroger
```

Aucune installation necessaire. S'execute directement depuis npm.

## Option 2 : Installation globale

```bash
npm install -g neurobase
neurobase setup
neurobase interactive
```

## Option 3 : Docker

```bash
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase
cp .env.example .env
# Editez .env avec vos identifiants
docker compose up
```

Cela demarre NeuroBase + PostgreSQL. L'API est disponible sur `http://localhost:3000`.

## Option 4 : Depuis les sources

```bash
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase
npm install
```

### Configurer

**Assistant interactif (recommande) :**

```bash
npx tsx src/cli.ts setup
```

L'assistant vous guide pour la base de donnees, le fournisseur LLM, les fonctionnalites et le mode de confidentialite.

**Configuration manuelle :**

```bash
cp .env.example .env
```

Editez `.env` :

```env
# Base de donnees
DB_ENGINE=postgresql
DATABASE_URL=postgresql://user:password@localhost:5432/mydb

# Fournisseur LLM (choisir un)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Ou OpenAI
# LLM_PROVIDER=openai
# OPENAI_API_KEY=sk-...

# Ou Ollama (gratuit, local)
# LLM_PROVIDER=ollama
# OLLAMA_MODEL=llama3.2

# Fonctionnalites
ENABLE_LEARNING=true
ENABLE_OPTIMIZATION=true
ENABLE_SELF_CORRECTION=true
ENABLE_MULTI_CANDIDATE=false

# Confidentialite (strict | schema-only | permissive)
PRIVACY_MODE=schema-only
```

### Initialiser la base

```bash
npm run init
```

Tapez `y` quand c'est demande pour charger les donnees e-commerce d'exemple (recommande pour le premier lancement).

### Demarrer

```bash
# CLI interactif
npm run dev

# Serveur API
npm run serve

# API multi-agent + tableau de bord
npm run serve:multi-agent

# Serveur MCP (pour Claude Desktop / Cursor)
npm run serve:mcp
```

## Configuration des fournisseurs LLM

### Anthropic (Claude)

1. Creez un compte sur [console.anthropic.com](https://console.anthropic.com/)
2. Generez une cle API
3. Configurez dans `.env` :
   ```env
   LLM_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-sonnet-4-20250514
   ```

### OpenAI

1. Creez un compte sur [platform.openai.com](https://platform.openai.com/)
2. Generez une cle API
3. Configurez dans `.env` :
   ```env
   LLM_PROVIDER=openai
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4-turbo-preview
   ```

### Ollama (gratuit, local)

```bash
# Installer Ollama
curl https://ollama.ai/install.sh | sh

# Telecharger un modele
ollama pull llama3.2

# Ollama demarre automatiquement
```

Configurez dans `.env` :
```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=llama3.2
OLLAMA_BASE_URL=http://localhost:11434
```

## Configuration du serveur MCP (Claude Desktop)

Ajoutez a votre config Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` sur macOS) :

```json
{
  "mcpServers": {
    "neurobase": {
      "command": "npx",
      "args": ["tsx", "/chemin/vers/neurobase/src/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/mydb",
        "LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Outils disponibles : `query`, `schema`, `explain`, `correct`, `diagnose`, `stats`.

## Modele semantique (optionnel)

Pour definir des concepts metier, copiez et personnalisez :

```bash
cp neurobase.semantic.example.yml neurobase.semantic.yml
```

Quand present, le LLM utilise vos termes metier ("chiffre d'affaires", "client actif") au lieu des noms de colonnes bruts.

## Verifier l'installation

```bash
# Verification des types
npm run typecheck

# Lancer les tests
npm test

# Essayer une requete
npx tsx src/cli.ts query "montre toutes les tables"
```

## Depannage

### "Cannot find module"
```bash
rm -rf node_modules package-lock.json
npm install
```

### "Connection refused"
Verifiez que votre base de donnees tourne et que `DATABASE_URL` est correct.

### "Invalid API key"
Verifiez votre cle API dans `.env`.

### "Port already in use"
```bash
NEUROBASE_PORT=3001 npm run serve
```

## Mise a jour

```bash
git pull origin main
npm install
npm run build
```
