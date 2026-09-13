# Serveur MCP DEALR (unifié, multi-utilisateurs via OAuth)

Un seul serveur MCP, une seule URL, déployé UNE FOIS — utilisable comme
connecteur à la fois dans **Claude** et dans **ChatGPT** (Developer Mode).
Chaque personne qui l'ajoute se connecte avec **son propre compte DEALR** au
moment de l'autorisation OAuth — plus aucune clé API codée en dur dans
l'environnement du serveur, et plus besoin d'un déploiement par utilisateur.

## Comment ça marche

1. Claude/ChatGPT découvre les endpoints OAuth du serveur (`/.well-known/oauth-authorization-server`).
2. L'utilisateur est redirigé vers `/oauth/authorize` → un écran de connexion DEALR (email/mot de passe — les mêmes identifiants que sur le site web).
3. À la connexion, le serveur mine une clé `dlr_live_...` pour CET utilisateur via `create_api_key()` (déjà dans `schema.sql`), avec son propre token Supabase — donc ses propres droits RLS.
4. Claude/ChatGPT reçoit cette clé comme "access token" et l'envoie automatiquement (`Authorization: Bearer dlr_live_...`) à chaque appel `/mcp` — le serveur l'utilise directement pour parler à l'API DEALR.

Aucune base d'utilisateurs à gérer côté serveur MCP : tout repose sur
Supabase Auth (déjà en place) et les clés `dlr_live_...` existantes.

## 8 outils

| Outil | Fait quoi |
|---|---|
| `dealr_search` | Cherche des annonces disponibles |
| `dealr_get_listing` | Détail d'une annonce |
| `dealr_start_negotiation` | Démarre une négociation (1ère offre) |
| `dealr_make_offer` | Contre-offre sur une négociation existante |
| `dealr_get_negotiation` | Historique/timeline d'une négociation |
| `dealr_accept_offer` | Accepte le prix sur la table |
| `dealr_reject_offer` | Rejette et clôt sans accord |
| `dealr_finalize_transaction` | Crée/complète la Transaction Room après accord |

## 1. Installer

```bash
npm install
```

## 2. Variables d'environnement

| Variable | Description |
|---|---|
| `DEALR_BASE_URL` | `https://TON-PROJECT-REF.supabase.co` (avec ou sans `/functions/v1`, les deux marchent) |
| `SUPABASE_ANON_KEY` | Clé publique Supabase (Project Settings → API) — **pas** la service role |
| `PUBLIC_URL` | L'URL publique de CE serveur une fois déployé (ex. `https://xxxx.ngrok-free.dev`), **sans** slash final |
| `PORT` | Optionnel, défaut 3000 |
| `ALLOWED_HOSTS` | Optionnel — domaines autorisés pour l'en-tête `Host` (ex. via un tunnel). Sans ça, le serveur se bind en `0.0.0.0` sans restriction (pratique pour tester, à durcir en prod). |

⚠️ Il n'y a plus de `DEALR_API_KEY` à configurer — chaque utilisateur apporte la sienne via OAuth.

## 3. Lancer en local (test)

```bash
DEALR_BASE_URL=https://TON-PROJECT-REF.supabase.co \
SUPABASE_ANON_KEY=eyJ... \
PUBLIC_URL=http://localhost:3000 \
npm start
```

## 4. Déployer publiquement

Doit être accessible en HTTPS (Render, Railway, Fly.io, un tunnel type ngrok
pour tester...). Mets à jour `PUBLIC_URL` pour qu'il corresponde exactement à
l'URL publique réelle — l'OAuth s'appuie dessus pour construire ses propres
endpoints.

## 5. Connecter à Claude / ChatGPT

Réglages → Connecteurs → Ajouter un connecteur personnalisé → colle
`https://TON-URL-PUBLIQUE/mcp`. Claude découvre automatiquement le flow
OAuth et affiche l'écran de connexion DEALR au moment d'autoriser.

M�me chose côté ChatGPT (Developer Mode → app MCP personnalisée).
