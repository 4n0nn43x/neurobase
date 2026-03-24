# Reference API

## URL de base

```
http://localhost:3000
```

## Authentification

Pas d'authentification requise actuellement. Pour la production, implementez un middleware d'authentification.

---

## Endpoint de diagnostic (v3)

### Diagnostiquer les performances d'une requete

```http
POST /api/diagnose
```

Analyse une requete SQL pour detecter les problemes de performance via une recherche diagnostique par arbre.

**Corps de la requete :**
```json
{
  "sql": "SELECT * FROM orders WHERE status = 'pending'"
}
```

**Reponse :**
```json
{
  "success": true,
  "diagnostic": {
    "rootCause": "2 probleme(s) trouve(s) pour la requete sur \"orders\"",
    "path": ["Diagnostic Performance", "Detection Scan Sequentiel", "Index Manquant"],
    "recommendations": [
      "Scan sequentiel detecte. Ajoutez un index sur les colonnes filtrees.",
      "La table \"orders\" a peu ou pas d'index."
    ],
    "details": {
      "sql": "SELECT * FROM orders WHERE status = 'pending'",
      "primaryTable": "orders"
    }
  }
}
```

---

## Endpoints principaux

### Verification de sante

```http
GET /health
```

**Reponse :**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-31T12:00:00.000Z",
  "version": "3.0.0",
  "agents": {
    "total": 3,
    "running": 2
  }
}
```

---

### Execution de requete

```http
POST /api/query
```

Execute une requete en langage naturel.

**Corps de la requete :**
```json
{
  "query": "Montre moi tous les utilisateurs crees aujourd'hui",
  "userId": "user123",
  "conversationId": "conv456",
  "dryRun": false,
  "includeExplanation": true,
  "includeSuggestions": true
}
```

**Reponse :**
```json
{
  "success": true,
  "data": [...],
  "sql": "SELECT * FROM users WHERE created_at::date = CURRENT_DATE",
  "executionTime": 45,
  "rowCount": 12,
  "explanation": "Cette requete recupere tous les utilisateurs crees aujourd'hui...",
  "suggestions": ["Considerez ajouter un index sur created_at"],
  "corrected": false
}
```

---

### Information du schema

```http
GET /api/schema
```

Retourne le schema de la base en JSON.

```http
GET /api/schema/text
```

Schema en texte formate.

```http
GET /api/schema/uml
```

Schema en diagramme ER Mermaid.

---

### Statistiques

```http
GET /api/stats
```

---

## Endpoints multi-agent

### Gestion des agents

#### Enregistrer un agent

```http
POST /api/agents/register
```

**Corps :**
```json
{
  "name": "Agent Evolution Schema",
  "type": "schema-evolution",
  "enabled": true,
  "forkStrategy": "now"
}
```

#### Lister les agents

```http
GET /api/agents
```

#### Details d'un agent

```http
GET /api/agents/:agentId
```

#### Demarrer / Arreter un agent

```http
POST /api/agents/:agentId/start
POST /api/agents/:agentId/stop
```

---

### Gestion des taches

#### Soumettre une tache

```http
POST /api/agents/:agentId/tasks
```

**Corps :**
```json
{
  "taskType": "analyze",
  "payload": { "timeframe": "7 days" },
  "priority": 10
}
```

#### Statut d'une tache

```http
GET /api/tasks/:taskId
```

---

### Validation de requete

```http
POST /api/validate
```

**Corps :**
```json
{
  "sql": "SELECT * FROM users WHERE id = 1"
}
```

---

### Synchronisation de forks

#### Creer un job de sync

```http
POST /api/sync
```

**Corps :**
```json
{
  "source": "fork-agent-1",
  "target": "fork-agent-2",
  "tables": ["neurobase_learning_history"],
  "mode": "incremental",
  "direction": "push"
}
```

#### Statut du job

```http
GET /api/sync/:jobId
```

---

### Tests A/B

```http
POST /api/experiments
GET /api/experiments
```

---

### Statistiques systeme

```http
GET /api/statistics
```

---

## Reponses d'erreur

Tous les endpoints retournent les erreurs dans ce format :

```json
{
  "success": false,
  "error": "Message d'erreur ici"
}
```

**Codes HTTP courants :**
- `200` - Succes
- `400` - Requete invalide
- `404` - Non trouve
- `500` - Erreur serveur
- `503` - Service indisponible

---

## Limitation de debit

Par defaut : 100 requetes par 15 minutes par IP.

---

## Exemples

### cURL

```bash
# Requete
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "montre tous les utilisateurs"}'

# Diagnostic
curl -X POST http://localhost:3000/api/diagnose \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM orders"}'
```

### JavaScript

```javascript
const response = await fetch('http://localhost:3000/api/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: "Montre les produits en rupture de stock"
  })
});

const result = await response.json();
console.log(result.data);
```

### Python

```python
import requests

response = requests.post('http://localhost:3000/api/query', json={
    'query': 'montre tous les utilisateurs'
})

data = response.json()
print(data['data'])
```
