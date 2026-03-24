# Systeme Multi-Agent

## Vue d'ensemble

Le systeme multi-agent de NeuroBase permet a plusieurs agents IA specialises de travailler en collaboration sur des forks de base de donnees separes, coordonnes par un orchestrateur central. En v3, des agents inline supplementaires (Explorateur de Valeurs, Explicateur, Recherche Diagnostique) operent dans le pipeline de requetes sans necessiter de forks dedies.

## Architecture

```
Orchestrateur Multi-Agent (BDD principale)
├── Registre d'agents & Gestion du cycle de vie
├── File de taches & Distribution
├── Systeme d'evenements & Monitoring
├── Communication inter-agents
├── Moniteur de sante & Auto-guerison
├── Circuit Breaker (failover LLM)
└── Superviseur d'operations (classification des risques)

Agents sur Fork (environnements isoles)
├── Agent Evolution de Schema → recommandations index/vues
├── Agent Validateur de Requetes → controles securite & perf
├── Agent Agregateur d'Apprentissage → insights inter-agents
└── Agent Tests A/B → comparaison de strategies en parallele

Agents Inline (dans le pipeline de requetes)
├── Agent Explorateur de Valeurs → verifie les valeurs en BDD
├── Agent Explicateur → resumes post-execution
└── Recherche Diagnostique par Arbre → analyse cause racine

Synchroniseur de Forks
└── Partage de connaissances entre agents
```

---

## Agents specialises

### 1. Agent Evolution de Schema

**Role :** Analyse les patterns de requetes et propose des optimisations de la base.

**Capacites :**
- Analyse des patterns de requetes
- Recommandations d'index
- Suggestions de vues materialisees
- Strategies de partitionnement
- Tests d'impact sur les performances

**Utilisation :**
```typescript
const agent = new SchemaEvolutionAgent(pool, llmProvider);
const analysis = await agent.analyzeAndRecommend();

for (const rec of analysis.recommendations) {
  const result = await agent.testRecommendation(rec);
  if (result.performanceGain > 30) {
    await agent.applyRecommendation(rec, mainPool);
  }
}
```

### 2. Agent Validateur de Requetes

**Role :** Valide les requetes en termes de securite et performance avant execution.

**Capacites :**
- Validation syntaxique SQL
- Detection de patterns dangereux (DROP, TRUNCATE, etc.)
- Analyse de performance
- Test en sandbox avant production

### 3. Agent Agregateur d'Apprentissage

**Role :** Collecte et synthetise les apprentissages de tous les agents.

**Capacites :**
- Collecte cross-agent
- Identification de patterns recurrents
- Construction de graphe de connaissances
- Generation d'insights actionnables

### 4. Agent Tests A/B

**Role :** Teste plusieurs strategies en parallele sur des forks isoles.

**Capacites :**
- Creation de forks pour comparaison
- Execution parallele des strategies
- Analyse statistique des resultats
- Determination du gagnant

### 5. Agent Explorateur de Valeurs (v3, inline)

**Role :** Verifie que les valeurs referencees dans les requetes existent reellement en base avant la generation SQL.

**Fonctionnement :**
- Detecte les patterns de filtre ("dans Electronics", "categorie Sport")
- Requete `SELECT DISTINCT` sur les colonnes pertinentes
- Correspondance floue (casse, pluriel, Levenshtein)
- Injecte les valeurs reelles dans le prompt LLM
- Desactive en mode confidentialite strict/schema-only

### 6. Agent Explicateur (v3, inline)

**Role :** Genere un resume en langage naturel apres l'execution d'une requete.

**Exemple :** "47 commandes de la semaine derniere, triees par montant total decroissant."

### 7. Recherche Diagnostique par Arbre (v3)

**Role :** Diagnostic systematique des problemes de performance des requetes.

**Arbre de diagnostic :**
```
"Requete lente"
  ├─ Scan sequentiel ? → index manquant → suggerer CREATE INDEX
  ├─ Contention de verrous ? → pg_locks → suggerer VACUUM
  ├─ Resultat trop gros ? → LIMIT manquant → suggerer pagination
  └─ Jointures complexes ? → vue materialisee → suggerer creation
```

---

## Orchestrateur

L'orchestrateur central gere le cycle de vie des agents, distribue les taches, et coordonne la communication.

```typescript
const orchestrator = new MultiAgentOrchestrator(DATABASE_URL);
await orchestrator.initialize();

// Enregistrer un agent
const agent = await orchestrator.registerAgent({
  name: 'Mon Agent',
  type: 'schema-evolution',
  enabled: true,
  forkStrategy: 'now',
  autoStart: true,
});

// Soumettre une tache
const taskId = await orchestrator.submitTask(
  agent.id,
  'analyze',
  { timeframe: '7 days' }
);

// Verifier le statut
const status = await orchestrator.getTaskStatus(taskId);
```

---

## Synchronisation de forks

Le synchroniseur permet le partage de connaissances entre agents operant sur des forks differents.

```typescript
await synchronizer.createSyncJob({
  source: 'fork-1',
  target: 'fork-2',
  tables: ['neurobase_learning_history'],
  mode: 'incremental',    // ou 'full', 'selective'
  direction: 'push',
  conflictResolution: 'source-wins',
});
```

**Modes de synchronisation :**
- **Incremental** : uniquement les enregistrements nouveaux/modifies
- **Full** : copie complete des donnees
- **Selective** : base sur des filtres

---

## Observabilite

### Moniteur de sante

Surveille l'etat des agents et declenche des actions d'auto-guerison :
- Redemarrage automatique des agents non-responsifs
- Alertes sur les taux d'erreur eleves
- Metriques de performance par agent

### Circuit Breaker LLM

Failover automatique entre fournisseurs LLM :
```
Anthropic (principal) → OpenAI (fallback) → Ollama (local)
```
S'active apres N echecs consecutifs, se reinitialise apres un delai configurable.

### Superviseur d'operations

Classifie le risque de chaque operation :
- **Lecture** : execution directe
- **Ecriture** : verification supplementaire
- **DDL** : approbation requise

---

## Systeme d'evenements

Types d'evenements :
- `agent:started` / `agent:stopped` / `agent:error`
- `task:completed`
- `fork:created`
- `sync:started` / `sync:completed`

```typescript
orchestrator.on((event) => {
  console.log(`[${event.type}] ${event.timestamp}`);
});
```

---

## Tableau de bord

Accessible sur `http://localhost:3000/dashboard` (mode multi-agent).

Fonctionnalites :
- Metriques systeme en temps reel
- Statut et performance des agents
- Statistiques de synchronisation
- Flux d'evenements en direct
- Rafraichissement automatique (10 secondes)
