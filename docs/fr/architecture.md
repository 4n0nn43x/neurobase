# Architecture NeuroBase

## Vue d'ensemble

NeuroBase est un moteur conversationnel multi-bases de donnees qui traduit le langage naturel en SQL, apprend des corrections, et s'auto-corrige en cas d'echec. Il supporte PostgreSQL, MySQL, SQLite et MongoDB via une interface d'adaptateur unifiee, avec support multi-fournisseurs LLM (OpenAI, Anthropic, Ollama).

## Architecture systeme

```
┌─────────────────────────────────────────────────────────┐
│                  Interfaces utilisateur                   │
│    CLI (interactif)  │  API REST  │  Serveur MCP         │
└───────────┬───────────┴──────┬─────┴───────┬────────────┘
            │                  │             │
┌───────────▼──────────────────▼─────────────▼────────────┐
│                    Coeur NeuroBase                        │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Routeur de   │  │  Garde de    │  │  Catalogue     │  │
│  │  Confiance    │  │  Confidentia.│  │  Semantique    │  │
│  │  (RAG 4 niv.) │  │  (3 modes)   │  │  (auto-gen)    │  │
│  └──────┬───────┘  └──────────────┘  └───────────────┘  │
│         │                                                │
│  ┌──────▼───────────────────────────────────────────┐   │
│  │              Agent Linguistique                   │   │
│  │  + Explorateur de valeurs (verifie les donnees)   │   │
│  │  + Elagueur de schema (budget tokens)             │   │
│  │  + Modele semantique (concepts metier)            │   │
│  └──────┬───────────────────────────────────────────┘   │
│         │                                                │
│  ┌──────▼───────────────────────────────────────────┐   │
│  │       Selecteur de candidats (optionnel)          │   │
│  │  Genere N candidats → filtre → classe par cout    │   │
│  └──────┬───────────────────────────────────────────┘   │
│         │                                                │
│  ┌──────▼──────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Verificateur│  │  Agent       │  │  Boucle        │  │
│  │  de resultats│  │  Optimiseur  │  │  d'auto-       │  │
│  │  (5 etapes)  │  │              │  │  correction    │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Agent       │  │  Agent       │  │  Recherche     │  │
│  │  Memoire     │  │  Explicateur │  │  Diagnostique  │  │
│  │  (apprentis.)│  │  (post-exec) │  │  (perf debug)  │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                   Couche Base de Donnees                  │
│  ┌──────────┐ ┌────────┐ ┌────────┐ ┌─────────┐       │
│  │PostgreSQL│ │ MySQL  │ │ SQLite │ │ MongoDB │       │
│  └──────────┘ └────────┘ └────────┘ └─────────┘       │
└─────────────────────────────────────────────────────────┘
```

## Pipeline de traitement des requetes

```
Requete en langage naturel
        │
        ▼
┌─ Routeur de Confiance ──────────────────────────────┐
│  Niveau 1 (≥0.95) : hit cache → pas d'appel LLM     │
│  Niveau 2 (≥0.80) : few-shot avec exemples proches   │
│  Niveau 3 (≥0.50) : pipeline complet + schema         │
│  Niveau 4 (<0.50) : fallback LLM avec contexte total  │
└───────┬─────────────────────────────────────────────┘
        │
        ▼
┌─ Explorateur de Valeurs ────────────────────────────┐
│  Detecte les valeurs de filtre ("dans Electronics")  │
│  Requete DISTINCT sur la BDD                         │
│  Trouve la meilleure correspondance                  │
│  Injecte les vraies valeurs dans le prompt LLM       │
│  (desactive en mode strict/schema-only)              │
└───────┬─────────────────────────────────────────────┘
        │
        ▼
┌─ Elagueur de Schema ───────────────────────────────┐
│  Score par table : mots-cles + proximite FK          │
│                  + frequence d'usage + descriptions   │
│  Serialise les tables top jusqu'au budget tokens     │
│  Format compact pour les tables limites              │
│  (saute si <10 tables)                               │
└───────┬─────────────────────────────────────────────┘
        │
        ▼
┌─ Agent Linguistique (appel LLM) ───────────────────┐
│  Prompt : schema + exemples + valeurs + semantique   │
│  Gere : generation SQL, conversation, clarification  │
│  Multi-langue : francais + anglais + mixte           │
└───────┬─────────────────────────────────────────────┘
        │
        ▼ (si multi-candidats active)
┌─ Selecteur de Candidats ───────────────────────────┐
│  Genere 3 SQL (temp 0.0, 0.2, 0.4) en parallele    │
│  Filtre : quickVerify elimine les refs invalides     │
│  Classe : comparaison des couts EXPLAIN              │
│  Departage : le LLM choisit si couts a 20% pres     │
└───────┬─────────────────────────────────────────────┘
        │
        ▼
┌─ Agent Optimiseur ─────────────────────────────────┐
│  Analyse EXPLAIN → suggestions de reecriture         │
│  Recommandations d'index                             │
│  (optionnel, configurable)                           │
└───────┬─────────────────────────────────────────────┘
        │
        ▼
┌─ Execution sur la BDD ─────────────────────────────┐
│  Requete parametree avec timeout                     │
│  En cas d'echec → Boucle d'auto-correction (3x)     │
│    tentative 1 : temp 0.1                            │
│    tentative 2 : temp 0.3                            │
│    tentative 3 : temp 0.5                            │
└───────┬─────────────────────────────────────────────┘
        │
        ▼
┌─ Post-traitement ──────────────────────────────────┐
│  Agent Memoire : stocke le mapping NL→SQL            │
│  Agent Explicateur : "47 commandes de la semaine"    │
│  Boucle de feedback : ponderation a decroissance     │
└───────┬─────────────────────────────────────────────┘
        │
        ▼
     Resultats
```

## Composants principaux

### Coeur NeuroBase (`src/core/neurobase.ts`)

Orchestrateur central qui connecte tous les composants. Instancie les agents, gere le pipeline de requetes, gere l'auto-correction, et expose les methodes `query()`, `correct()`, `diagnose()`.

### Agents (`src/agents/`)

| Agent | Fichier | Role |
|-------|---------|------|
| Linguistique | `linguistic.ts` | Traduction NL → SQL avec contexte schema/valeurs/semantique |
| Optimiseur | `optimizer.ts` | Reecriture basee sur EXPLAIN |
| Memoire | `memory.ts` | Stockage d'apprentissage avec embeddings |
| Explorateur de valeurs | `value-explorer.ts` | Verifie que les valeurs referencees existent en BDD |
| Explicateur | `explainer.ts` | Resume post-execution en langage naturel |
| Evolution de schema | `schema-evolution.ts` | Recommandations d'index/vues/partitions |
| Validateur de requetes | `query-validator.ts` | Validation de securite et performance |
| Agregateur d'apprentissage | `learning-aggregator.ts` | Synthese d'insights inter-agents |
| Tests A/B | `ab-testing.ts` | Comparaison de strategies en parallele |

### Pipeline RAG (`src/rag/`)

| Composant | Fichier | Role |
|-----------|---------|------|
| Routeur de confiance | `confidence-router.ts` | Routage 4 niveaux base sur la confiance |
| Auto-correction | `self-correction.ts` | Reessai du SQL echoue avec contexte d'erreur |
| Selecteur de candidats | `candidate-selector.ts` | Generation multi-SQL et classement |
| Elagueur de schema | `schema-pruner.ts` | Filtrage de schema avec budget tokens |
| Verificateur de resultats | `result-verifier.ts` | Pipeline de validation SQL en 5 etapes |
| Boucle de feedback | `feedback-loop.ts` | Poids d'apprentissage a decroissance temporelle |
| Cache vectoriel | `vector-cache.ts` | Cache d'embeddings en memoire avec LRU |

### Couche semantique (`src/semantic/`)

| Composant | Fichier | Role |
|-----------|---------|------|
| Auto-Catalogue | `auto-catalog.ts` | Genere des descriptions table/colonne par LLM |
| Chargeur | `loader.ts` | Charge le modele semantique YAML |
| Rendu | `renderer.ts` | Convertit le modele en texte pour le prompt LLM |

### Fournisseurs LLM (`src/llm/`)

Interface abstraite `BaseLLMProvider` avec implementations :
- **OpenAI** — GPT-4 Turbo, text-embedding-3-small
- **Anthropic** — Claude Sonnet/Opus
- **Ollama** — Modeles locaux (llama3.2, etc.)

### Adaptateurs BDD (`src/database/`)

Interface abstraite `DatabaseAdapter` avec implementations pour PostgreSQL, MySQL, SQLite, MongoDB. Chaque adaptateur fournit : introspection du schema, execution de requetes, transactions, EXPLAIN, forking.

### Observabilite (`src/observability/`)

- **OpenTelemetry** avec exporteur OTLP HTTP
- **Definitions de spans** pour tout le cycle de vie (16 types)
- **Systeme d'alertes** avec regles metriques et canaux webhook/log
- **Moniteur de sante** avec actions d'auto-guerison

### Securite (`src/security/`)

- **Parseur SQL** — detection de patterns dangereux par AST
- **Garde de confidentialite** — controle des donnees a 3 niveaux (strict/schema-only/permissive)
- **Journal d'audit** — trace immuable en ajout seul

### Diagnostics (`src/diagnostics/`)

Analyse de cause racine par arbre pour la performance des requetes. Parcours d'un arbre de connaissances : scan sequentiel → index manquant, contention de verrous, jeu de resultats trop grand, jointures complexes, bloat de table.

## Tables de la base

### Coeur
- `neurobase_learning_history` — mappings NL→SQL avec embeddings
- `neurobase_corrections` — corrections utilisateur pour l'apprentissage
- `neurobase_semantic_catalog` — descriptions auto-generees des tables/colonnes

### Multi-Agent
- `neurobase_agents` — metadonnees et statut des agents
- `neurobase_agent_tasks` — file de taches avec priorite
- `neurobase_agent_messages` — communication inter-agents

### Audit
- `neurobase_audit_log` — trace immuable des operations

## Points d'entree

| Entree | Fichier | Commande |
|--------|---------|----------|
| CLI interactif | `src/cli.ts` | `neurobase interactive` |
| API REST | `src/api.ts` | `npm run serve` |
| API Multi-Agent | `src/multi-agent-api.ts` | `npm run serve:multi-agent` |
| Serveur MCP | `src/mcp/server.ts` | `npm run serve:mcp` |

## Patterns de conception

- **Factory** — LLMFactory, AdapterFactory pour la selection de fournisseur/BDD
- **Strategy** — differents adaptateurs implementant la meme interface
- **Observer** — gestionnaires d'evenements dans le coeur NeuroBase
- **Circuit Breaker** — chaine de failover entre fournisseurs LLM
- **Pipeline** — traitement multi-etapes (RAG → traduction → verification → execution → apprentissage)
