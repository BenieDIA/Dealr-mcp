# Serveur MCP DEALR (unifié, multi-utilisateurs via OAuth)
Lien vers le network : https://getdealr.network/
Un seul serveur MCP, une seule URL, déployé **UNE FOIS** — utilisable comme connecteur à la fois dans **Claude** et dans **ChatGPT** (Developer Mode).

Chaque personne qui l'ajoute se connecte avec **son propre compte DEALR** au moment de l'autorisation OAuth — plus aucune clé API codée en dur dans l'environnement du serveur, et plus besoin d'un déploiement par utilisateur.

## Le réseau DEALR

Ce serveur MCP fait partie du **réseau DEALR**.

L'idée du réseau DEALR est de créer une couche d'interconnexion entre les assistants IA et les services de la plateforme DEALR. Le MCP sert de **point d'accès standardisé** permettant à des assistants comme Claude ou ChatGPT d'interagir avec DEALR de manière sécurisée, tout en conservant les droits et l'identité de chaque utilisateur.

Le réseau repose sur trois principes :

* **Un point d'accès unique** : un seul serveur MCP public peut être utilisé par l'ensemble des utilisateurs et des assistants compatibles.
* **Une identité par utilisateur** : chaque utilisateur s'authentifie avec son propre compte DEALR via OAuth. Le serveur ne partage donc pas une clé API commune entre les utilisateurs.
* **Des permissions respectées de bout en bout** : les opérations effectuées via le MCP utilisent les droits associés au compte DEALR de l'utilisateur.

On peut ainsi voir le réseau DEALR comme une **passerelle entre les agents IA et l'écosystème DEALR** :

```text
                    RÉSEAU DEALR
                         │
                         ▼
                ┌─────────────────┐
                │   Serveur MCP   │
                │      DEALR      │
                └────────┬────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
          OAuth / Auth         API DEALR
              │                     │
      ┌───────┴───────┐             │
      │               │             │
   Claude          ChatGPT          │
      │               │             │
      └───────┬───────┘             │
              │                     │
              ▼                     ▼
       Compte utilisateur      Services DEALR
       + droits associés       + données RLS
```

Le serveur MCP ne devient donc pas une nouvelle base d'utilisateurs : **Supabase Auth reste la source d'identité**, tandis que le MCP agit comme une passerelle sécurisée entre les assistants IA et les services DEALR.

## Comment ça marche

1. Claude/ChatGPT découvre les endpoints OAuth du serveur (`/.well-known/oauth-authorization-server`).
2. L'utilisateur est redirigé vers `/oauth/authorize` → un écran de connexion DEALR (email/mot de passe — les mêmes identifiants que sur le site web).
3. À la connexion, le serveur génère une clé `dlr_live_...` pour **cet utilisateur** via `create_api_key()` (déjà présente dans `schema.sql`), avec son propre token Supabase — donc ses propres droits RLS.
4. Claude/ChatGPT reçoit cette clé comme **access token** et l'envoie automatiquement (`Authorization: Bearer dlr_live_...`) à chaque appel `/mcp` — le serveur l'utilise directement pour communiquer avec l'API DEALR.

Aucune base d'utilisateurs à gérer côté serveur MCP : tout repose sur **Supabase Auth** (déjà en place) et les clés `dlr_live_...` existantes.

## 8 outils

| Outil                        | Fait quoi                                           |
| ---------------------------- | --------------------------------------------------- |
| `dealr_search`               | Cherche des annonces disponibles                    |
| `dealr_get_listing`          | Affiche le détail d'une annonce                     |
| `dealr_start_negotiation`    | Démarre une négociation (1re offre)                 |
| `dealr_make_offer`           | Fait une contre-offre sur une négociation existante |
| `dealr_get_negotiation`      | Affiche l'historique/la timeline d'une négociation  |
| `dealr_accept_offer`         | Accepte le prix proposé                             |
| `dealr_reject_offer`         | Rejette l'offre et clôt la négociation sans accord  |
| `dealr_finalize_transaction` | Crée/complète la Transaction Room après accord      |

## 1. Installer

```bash
npm install
```

## 2. Variables d'environnement

| Variable            | Description                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEALR_BASE_URL`    | `https://TON-PROJECT-REF.supabase.co` (avec ou sans `/functions/v1`, les deux fonctionnent)                                                                                                                     |
| `SUPABASE_ANON_KEY` | Clé publique Supabase (Project Settings → API) — **pas** la service role key                                                                                                                                    |
| `PUBLIC_URL`        | L'URL publique de **CE serveur** une fois déployé (ex. `https://xxxx.example.com`), **sans slash final**                                                                                                        |
| `PORT`              | Optionnel, valeur par défaut : `3000`                                                                                                                                                                           |
| `ALLOWED_HOSTS`     | Optionnel — domaines autorisés pour l'en-tête `Host`. Sans cette variable, le serveur se bind sur `0.0.0.0` sans restriction. En production, il est recommandé de définir explicitement les domaines autorisés. |

⚠️ Il n'y a plus de `DEALR_API_KEY` à configurer — chaque utilisateur apporte la sienne via OAuth.

## 3. Déployer publiquement

Le serveur doit être accessible en **HTTPS**.

Le déploiement peut être effectué sur une plateforme comme Render, Railway, Fly.io ou tout autre hébergeur compatible.

Une fois le serveur déployé, mets à jour `PUBLIC_URL` pour qu'il corresponde **exactement** à l'URL publique réelle. OAuth s'appuie sur cette URL pour construire ses endpoints.

Le serveur MCP doit être accessible publiquement afin que Claude et ChatGPT puissent communiquer avec lui.

## 4. Connecter à Claude / ChatGPT

Dans Claude ou ChatGPT, ajoute le serveur MCP en utilisant son endpoint public :

```text
https://TON-URL-PUBLIQUE/mcp
```

Claude/ChatGPT découvre automatiquement le flow OAuth et affiche l'écran de connexion DEALR au moment de l'autorisation.

Chaque utilisateur se connecte alors avec **son propre compte DEALR**.

Même serveur, même URL, mêmes outils — mais **une authentification et des permissions propres à chaque utilisateur**.

### Architecture finale

```text
                    ┌──────────────────────┐
                    │      Claude          │
                    └──────────┬───────────┘
                               │
                               │ OAuth + MCP
                               │
                    ┌──────────▼───────────┐
                    │                      │
                    │   RÉSEAU DEALR       │
                    │                      │
                    │     Serveur MCP      │
                    │                      │
                    └──────────┬───────────┘
                               │
                               │ Authentification
                               │ par utilisateur
                               ▼
                    ┌──────────────────────┐
                    │    Supabase Auth     │
                    └──────────┬───────────┘
                               │
                               │ Token utilisateur
                               ▼
                    ┌──────────────────────┐
                    │      API DEALR       │
                    │                      │
                    │   RLS + données      │
                    └──────────────────────┘
                               ▲
                               │
                    ┌──────────┴───────────┐
                    │                      │
             ┌──────┴──────┐       ┌──────┴──────┐
             │   User A    │       │   User B    │
             │             │       │             │
             │ dlr_live_*  │       │ dlr_live_*  │
             └─────────────┘       └─────────────┘
```

**Un seul serveur. Une seule URL. Plusieurs utilisateurs. Plusieurs assistants IA. Une identité DEALR par utilisateur.**
