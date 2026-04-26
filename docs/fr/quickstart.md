# Demarrage rapide

NeuroBase operationnel en moins de 5 minutes.

## 1. Configurer

```bash
npx neurobase setup
```

L'assistant demande :
- Fournisseur LLM (Anthropic / OpenAI / OpenRouter / Ollama) et cle API — validee en direct
- Moteur de base de donnees et URL de connexion — testee en direct
- Fonctionnalites a activer
- Mode de confidentialite

Le resultat est sauvegarde dans `~/.neurobase/` (profil + identifiants, pas
de `.env` necessaire). Tu peux relancer une section seule plus tard :
`setup db`, `setup token`, `setup model`, etc.

## 2. Verifier que tout est branche

```bash
npx neurobase doctor
```

## 3. Donnees d'exemple (optionnel)

```bash
npx neurobase init
```

Tapez `y` pour charger le schema e-commerce d'exemple.

## 4. Commencer a interroger

```bash
npx neurobase
```

## Exemples de requetes

### Basiques

```
neurobase > montre moi tous les utilisateurs
neurobase > combien de produits on a ?
neurobase > liste toutes les categories
```

### Agregations

```
neurobase > total des ventes ce mois-ci
neurobase > valeur moyenne des commandes par categorie
neurobase > nombre de commandes par statut
```

### Jointures

```
neurobase > montre les utilisateurs avec leurs commandes
neurobase > produits avec le nom de leur categorie
neurobase > commandes avec les details clients
```

### Filtres

```
neurobase > utilisateurs crees cette semaine
neurobase > produits a plus de 500 euros
neurobase > commandes en attente
```

### Complexes

```
neurobase > top 5 clients par depense totale
neurobase > produits les mieux notes qui sont en stock
neurobase > tendance du chiffre d'affaires mensuel cette annee
```

### Suivi de conversation (contexte preserve)

```
neurobase > montre moi toutes les categories
neurobase > avec le nombre de produits
neurobase > trie par nombre decroissant
```

### Anglais (fonctionne aussi)

```
neurobase > show me all users
neurobase > top 10 products by revenue
neurobase > orders from last week
```

## Commandes REPL

| Commande | Action |
|----------|--------|
| `/help` | Afficher toutes les commandes |
| `/schema` | Afficher le schema avec les relations |
| `/stats` | Afficher les statistiques |
| `/clear` | Effacer l'ecran et l'historique |
| `/model [id]` | Changer le modele LLM (picker recherchable sans id) |
| `/db [nom]` | Lister ou changer la base active |
| `/fork` | Creer un fork de la base (bac a sable) |
| `/forks` | Lister les forks actifs |
| `/fork-delete <id>` | Supprimer un fork |
| `/exit` | Quitter |

Le prefixe `.` reste accepte silencieusement pour la retrocompatibilite.

## Mode API

```bash
npx neurobase serve
```

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "montre tous les utilisateurs"}'
```

## Auto-correction en action

Si votre requete reference une valeur mal orthographiee, NeuroBase corrige automatiquement :

```
neurobase > montre les produits de la categorie "electronik"

  ╭── ⟩ SQL ──────────────────────────────────────────╮
  │ SELECT p.* FROM products p                         │
  │ JOIN categories c ON p.category_id = c.id          │
  │ WHERE LOWER(c.name) = LOWER('electronics')         │
  ╰────────────────────────────────────────────────────╯

  ⊞ 5 lignes  │  ⏱ 120ms  │  ⟳ auto-corrige  │  ◉ appris
```

L'explorateur de valeurs a detecte que "electronik" n'existe pas, a trouve "Electronics" comme correspondance la plus proche, et le LLM a utilise la bonne valeur.

## Prochaines etapes

- [Documentation complete](../../README.md)
- [Guide d'architecture](architecture.md)
- [Reference API](api-reference.md)
- [Systeme multi-agent](multi-agent-system.md)
