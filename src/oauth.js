// ============================================================================
// DEALR MCP — Serveur d'autorisation OAuth (multi-utilisateurs)
//
// Ce module transforme le serveur MCP en vrai serveur OAuth 2.1 (Authorization
// Code + PKCE), en réutilisant à 100% ce qui existe déjà côté DEALR :
//   - le login (Supabase Auth, email/mot de passe)
//   - create_api_key() : mint une clé dlr_live_... pour l'utilisateur connecté
//
// Le "token d'accès" qu'on délivre à Claude/ChatGPT à la fin du flow OAuth
// EST directement une clé dlr_live_..., utilisable telle quelle par
// /discovery, /negotiate, /negotiations, /transaction-room (aucune fonction
// backend n'a besoin d'être modifiée).
//
// Résultat concret : un seul serveur MCP déployé, pour tous les utilisateurs
// DEALR. Chacun se connecte avec son propre compte au moment d'ajouter le
// connecteur — plus aucune clé codée en dur dans l'environnement du serveur.
// ============================================================================
import crypto from "node:crypto";
import express from "express";

export function createOAuthRouter({ supabaseUrl, supabaseAnonKey, publicUrl }) {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));
  router.use(express.urlencoded({ extended: true }));

  // Stockage en mémoire — suffisant pour un serveur mono-instance. Les codes
  // et clients expirent vite (codes) ou sont peu nombreux (un client par
  // application connectée : Claude, ChatGPT...). À passer sur une vraie table
  // si le serveur MCP est un jour déployé multi-instance.
  const clients = new Map(); // client_id -> { redirect_uris }
  const authCodes = new Map(); // code -> { apiKey, redirectUri, codeChallenge, expiresAt }

  function cleanupExpiredCodes() {
    const now = Date.now();
    for (const [code, entry] of authCodes) if (entry.expiresAt < now) authCodes.delete(code);
  }

  // ---------------------------------------------------------------------
  // Découverte OAuth — permet à Claude/ChatGPT de trouver automatiquement
  // les bons endpoints sans configuration manuelle.
  // ---------------------------------------------------------------------
  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: publicUrl,
      authorization_endpoint: `${publicUrl}/oauth/authorize`,
      token_endpoint: `${publicUrl}/oauth/token`,
      registration_endpoint: `${publicUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  router.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({
      resource: `${publicUrl}/mcp`,
      authorization_servers: [publicUrl],
    });
  });

  // ---------------------------------------------------------------------
  // Enregistrement dynamique de client (RFC 7591, version minimale) —
  // Claude/ChatGPT s'auto-enregistrent au premier ajout du connecteur.
  // ---------------------------------------------------------------------
  router.post("/oauth/register", (req, res) => {
    const body = req.body ?? {};
    const redirectUris = body.redirect_uris || [];
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      return res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris requis" });
    }
    const clientId = crypto.randomUUID();
    clients.set(clientId, { redirectUris });
    res.status(201).json({
      client_id: clientId,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
  });

  function isKnownRedirect(clientId, redirectUri) {
    const client = clients.get(clientId);
    if (client) return client.redirectUris.includes(redirectUri);
    // Tolérance : si le client ne s'est jamais enregistré via /oauth/register
    // (certains hôtes MCP sautent cette étape), on l'accepte à la volée au
    // premier /authorize et on le mémorise avec ce redirect_uri précis.
    clients.set(clientId, { redirectUris: [redirectUri] });
    return true;
  }

  // ---------------------------------------------------------------------
  // Écran de connexion DEALR — l'utilisateur se connecte avec SON compte
  // DEALR existant (même identifiants que sur le site web).
  // ---------------------------------------------------------------------
  router.get("/oauth/authorize", (req, res) => {
    const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = req.query;

    if (response_type !== "code" || !client_id || !redirect_uri || !code_challenge) {
      return res.status(400).send("Requête OAuth invalide (paramètres manquants).");
    }
    if (code_challenge_method && code_challenge_method !== "S256") {
      return res.status(400).send("code_challenge_method non supporté (S256 uniquement).");
    }
    if (!isKnownRedirect(client_id, redirect_uri)) {
      return res.status(400).send("redirect_uri inconnu pour ce client.");
    }

    res.send(loginPageHtml({ response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, error: null }));
  });

  router.post("/oauth/authorize", async (req, res) => {
    const body = req.body ?? {};
    const { email, password, response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = body;
    const oauthParams = { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope };

    if (!email || !password || !response_type || !client_id || !redirect_uri || !code_challenge) {
      return res.status(400).send(loginPageHtml({ ...oauthParams, error: "Paramètres OAuth manquants." }));
    }

    try {
      // 1) Connexion Supabase Auth — exactement le même mécanisme que le site web.
      const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: supabaseAnonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const authData = await authRes.json();
      if (!authRes.ok || !authData.access_token) {
        return res.status(401).send(loginPageHtml({ ...oauthParams, error: "Email ou mot de passe incorrect." }));
      }

      // 2) Mint une clé dlr_live_... pour CET utilisateur — réutilise create_api_key()
      //    tel quel, avec son propre token Supabase (donc auth.uid() correct côté RLS).
      const keyRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_api_key`, {
        method: "POST",
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${authData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const keyData = await keyRes.json();
      if (!keyRes.ok || !keyData.api_key) {
        return res.status(502).send(loginPageHtml({ ...oauthParams, error: "Connexion réussie mais la génération de la clé a échoué. Réessaie." }));
      }

      // 3) Code d'autorisation temporaire (5 min), lié au challenge PKCE.
      cleanupExpiredCodes();
      const code = crypto.randomUUID();
      authCodes.set(code, {
        apiKey: keyData.api_key,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) redirectUrl.searchParams.set("state", state);
      res.redirect(302, redirectUrl.toString());
    } catch (err) {
      console.error("Erreur OAuth authorize:", err);
      res.status(500).send(loginPageHtml({ ...oauthParams, error: "Erreur serveur, réessaie." }));
    }
  });

  // ---------------------------------------------------------------------
  // Échange du code contre le token d'accès (= la clé dlr_live_ minée à
  // l'étape précédente). Vérifie PKCE avant de la livrer.
  // ---------------------------------------------------------------------
  router.post("/oauth/token", (req, res) => {
    const body = req.body ?? {};
    const { grant_type, code, redirect_uri, code_verifier } = body;

    if (grant_type !== "authorization_code") {
      return res.status(400).json({ error: "unsupported_grant_type" });
    }

    cleanupExpiredCodes();
    const entry = authCodes.get(code);
    if (!entry || entry.expiresAt < Date.now()) {
      return res.status(400).json({ error: "invalid_grant", error_description: "Code invalide ou expiré." });
    }
    if (entry.redirectUri !== redirect_uri) {
      return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri ne correspond pas." });
    }

    const computedChallenge = crypto.createHash("sha256").update(code_verifier || "").digest("base64url");
    if (computedChallenge !== entry.codeChallenge) {
      return res.status(400).json({ error: "invalid_grant", error_description: "code_verifier invalide (PKCE)." });
    }

    authCodes.delete(code); // usage unique
    res.json({ access_token: entry.apiKey, token_type: "Bearer" });
  });

  return router;
}

function loginPageHtml({ response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, error }) {
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${value ? escapeHtml(value) : ""}" />`;
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Connexion DEALR</title>
<style>
  body{font-family:-apple-system,Inter,sans-serif;background:#0D0D0D;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
  form{background:#1a1a1a;padding:32px;border-radius:12px;width:320px;border:1px solid rgba(255,255,255,0.18);}
  h1{font-size:18px;margin:0 0 4px;}
  p{color:rgba(255,255,255,0.6);font-size:13px;margin:0 0 20px;}
  input[type=email],input[type=password]{width:100%;padding:10px;margin-bottom:12px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);background:#0D0D0D;color:#fff;box-sizing:border-box;}
  button{width:100%;padding:10px;border-radius:6px;border:none;background:#18C875;color:#000;font-weight:600;cursor:pointer;}
  .error{color:#ff6b6b;font-size:13px;margin-bottom:12px;}
</style></head>
<body>
  <form method="POST" action="/oauth/authorize">
    <h1>Connecte-toi à DEALR</h1>
    <p>Pour autoriser cette application à négocier en ton nom.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <input type="email" name="email" placeholder="Email" required autofocus />
    <input type="password" name="password" placeholder="Mot de passe" required />
    ${hidden("response_type", response_type)}
    ${hidden("client_id", client_id)}
    ${hidden("redirect_uri", redirect_uri)}
    ${hidden("state", state)}
    ${hidden("code_challenge", code_challenge)}
    ${hidden("code_challenge_method", code_challenge_method)}
    ${hidden("scope", scope)}
    <button type="submit">Autoriser</button>
  </form>
</body></html>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
