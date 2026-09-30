// ============================================================================
// DEALR MCP — Fonctions pures de l'OAuth, extraites d'oauth.js pour être
// testables indépendamment (aucune dépendance à Express, à l'état en
// mémoire, ni au réseau).
// ============================================================================
import crypto from "node:crypto";

// Déduit quelle application se connecte à partir de l'hôte de son
// redirect_uri — sert uniquement à l'AFFICHAGE ("Claude est connecté"),
// jamais à limiter l'accès : une seule connexion est autorisée au total,
// quelle que soit l'application (voir create_api_key() côté base).
export function labelForRedirect(redirectUri) {
  try {
    const host = new URL(redirectUri).hostname;
    if (host.endsWith("claude.ai") || host.endsWith("claude.com")) return "claude";
    if (host.endsWith("chatgpt.com") || host.endsWith("openai.com")) return "chatgpt";
    return host.replace(/[^a-z0-9.-]/gi, "").slice(0, 40) || "app";
  } catch {
    return "app";
  }
}

// Vérifie un couple (code_verifier, code_challenge) selon PKCE / RFC 7636,
// méthode S256 uniquement.
export function verifyPkce(codeVerifier, codeChallenge) {
  const computed = crypto.createHash("sha256").update(codeVerifier || "").digest("base64url");
  return computed === codeChallenge;
}

// Nom lisible pour l'interface (dashboard) à partir du label technique.
export const APP_LABELS = { claude: "Claude", chatgpt: "ChatGPT", manual: "Manuel", legacy: "Ancienne connexion" };
export function displayLabel(label) {
  return APP_LABELS[label] || label;
}
