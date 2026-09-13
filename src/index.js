// ============================================================================
// DEALR — Serveur MCP unifié (multi-utilisateurs, OAuth)
//
// Un seul serveur, un seul protocole (MCP standard via Streamable HTTP) :
// la MÊME URL se connecte aussi bien comme connecteur personnalisé dans
// Claude que comme connecteur MCP personnalisé dans ChatGPT (Developer
// Mode). Pas besoin de deux implémentations différentes — MCP est justement
// fait pour ça.
//
// Authentification : OAuth 2.1 (voir oauth.js) plutôt qu'une clé DEALR fixée
// dans l'environnement du serveur. Chaque utilisateur se connecte avec son
// propre compte DEALR au moment d'ajouter le connecteur ; le token qu'il
// obtient est directement une clé dlr_live_..., propre à lui, utilisée pour
// CHAQUE appel /mcp qu'il fait — un seul déploiement sert tout le monde.
//
// 8 outils, alignés sur l'API DEALR réelle (Edge Functions /discovery,
// /negotiate, /negotiations, /transaction-room) :
//   dealr_search, dealr_get_listing, dealr_start_negotiation,
//   dealr_make_offer, dealr_get_negotiation, dealr_accept_offer,
//   dealr_reject_offer, dealr_finalize_transaction
//
// Ce serveur ne prend AUCUNE décision de négociation lui-même : c'est
// l'agent qui l'appelle (Claude ou ChatGPT) qui décide des prix. DEALR/ce
// serveur ne fait que transmettre, avec la clé de l'utilisateur connecté,
// et laisser le Policy Engine côté backend arbitrer les propositions du
// vendeur.
// ============================================================================
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import * as z from "zod/v4";
import { createOAuthRouter } from "./oauth.js";

const configuredBaseUrl = process.env.DEALR_BASE_URL;
const DEALR_BASE_URL = configuredBaseUrl
  ? configuredBaseUrl.replace(/\/+$/, "").replace(/\/functions\/v1$/, "") + "/functions/v1"
  : null; // https://<ref>.supabase.co/functions/v1
const SUPABASE_URL = configuredBaseUrl ? configuredBaseUrl.replace(/\/+$/, "").replace(/\/functions\/v1$/, "") : null;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY; // clé publique (safe), Project Settings → API
const PUBLIC_URL = process.env.PUBLIC_URL; // l'URL publique de CE serveur (ngrok/render/...), sans slash final

if (!DEALR_BASE_URL || !SUPABASE_ANON_KEY || !PUBLIC_URL) {
  console.error("DEALR_BASE_URL, SUPABASE_ANON_KEY et PUBLIC_URL sont requis (variables d'environnement).");
  process.exit(1);
}

async function dealrGet(apiKey, path) {
  const res = await fetch(`${DEALR_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`DEALR ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function dealrPost(apiKey, path, payload) {
  const res = await fetch(`${DEALR_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`DEALR ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function textResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// Modes de transaction acceptés par /transaction-room, et leurs champs requis
// (dupliqué côté backend pour validation finale — ici c'est indicatif pour
// que l'agent sache quoi demander à l'utilisateur avant d'appeler l'outil).
const TRANSACTION_MODES = ["hand_delivery", "parcel", "seller_delivery", "pickup", "relay", "bulk_freight", "digital"];

// apiKey : la clé dlr_live_ de LA PERSONNE qui a fait cette requête HTTP
// précise (extraite de son Authorization header — voir app.post("/mcp")
// plus bas), jamais une clé globale au serveur.
function getServer(apiKey) {
  const server = new McpServer({ name: "dealr", version: "3.0.0" });

  server.registerTool(
    "dealr_search",
    {
      description: "Cherche des annonces disponibles sur DEALR. Utilise cet outil en premier quand l'utilisateur veut acheter quelque chose.",
      inputSchema: {
        product: z.string().optional().describe("Ce que l'utilisateur cherche à acheter"),
        category: z.string().optional(),
        city: z.string().optional(),
        max_price: z.number().optional().describe("Budget privé de l'acheteur — ne JAMAIS l'envoyer au vendeur ni le mentionner dans une offre"),
      },
    },
    async ({ product, category, city }) => {
      const params = new URLSearchParams();
      if (product) params.set("q", product);
      if (category) params.set("category", category);
      if (city) params.set("city", city);
      return textResult(await dealrGet(apiKey, `/discovery?${params}`));
    }
  );

  server.registerTool(
    "dealr_get_listing",
    {
      description: "Récupère le détail d'une annonce précise par son id.",
      inputSchema: { listing_id: z.string() },
    },
    async ({ listing_id }) => {
      const data = await dealrGet(apiKey, `/discovery?q=${encodeURIComponent(listing_id)}`);
      const listing = (data.listings || []).find((l) => l.id === listing_id);
      if (!listing) throw new Error("Annonce introuvable");
      return textResult({ listing });
    }
  );

  server.registerTool(
    "dealr_start_negotiation",
    {
      description: "Démarre une négociation acheteur sur une annonce choisie. Le budget maximum de l'acheteur doit rester privé et ne jamais être envoyé comme prix d'ouverture.",
      inputSchema: {
        listing_id: z.string(),
        opening_price: z.number().describe("Première offre — doit rester en dessous du budget max privé de l'acheteur"),
        shipping_method: z.string().optional(),
        message: z.string().optional(),
      },
    },
    async ({ listing_id, opening_price, shipping_method, message }) =>
      textResult(await dealrPost(apiKey, "/negotiate", { listing_id, action: "propose", price: opening_price, shipping_method, message }))
  );

  server.registerTool(
    "dealr_make_offer",
    {
      description: "Soumet une contre-offre dans une négociation déjà démarrée (côté acheteur ou vendeur).",
      inputSchema: {
        listing_id: z.string(),
        negotiation_id: z.string(),
        price: z.number(),
        message: z.string().optional(),
        shipping_method: z.string().optional(),
      },
    },
    async (args) => textResult(await dealrPost(apiKey, "/negotiate", { ...args, action: "propose" }))
  );

  server.registerTool(
    "dealr_get_negotiation",
    {
      description: "Lit l'état actuel d'une négociation et sa timeline auditable complète.",
      inputSchema: { negotiation_id: z.string() },
    },
    async ({ negotiation_id }) => textResult(await dealrGet(apiKey, `/negotiations?id=${encodeURIComponent(negotiation_id)}`))
  );

  server.registerTool(
    "dealr_accept_offer",
    {
      description: "Accepte le prix actuellement sur la table. Action à conséquence — traiter comme définitive.",
      inputSchema: { listing_id: z.string(), negotiation_id: z.string(), message: z.string().optional() },
    },
    async ({ listing_id, negotiation_id, message }) =>
      textResult(await dealrPost(apiKey, "/negotiate", { listing_id, negotiation_id, action: "accept", message }))
  );

  server.registerTool(
    "dealr_reject_offer",
    {
      description: "Rejette l'offre actuelle et clôt la négociation sans accord.",
      inputSchema: { listing_id: z.string(), negotiation_id: z.string(), message: z.string().optional() },
    },
    async ({ listing_id, negotiation_id, message }) =>
      textResult(await dealrPost(apiKey, "/negotiate", { listing_id, negotiation_id, action: "reject", message }))
  );

  server.registerTool(
    "dealr_finalize_transaction",
    {
      description:
        `Crée ou met à jour la Transaction Room structurée après un accord (negotiations.status = agreement_reached). ` +
        `Modes disponibles : ${TRANSACTION_MODES.join(", ")}. Si des champs requis manquent pour le mode choisi, ` +
        `la réponse renverra "needs_information" — redemande alors les champs manquants à l'utilisateur plutôt que d'ouvrir un chat libre.`,
      inputSchema: {
        negotiation_id: z.string(),
        mode: z.enum(TRANSACTION_MODES),
        details: z.record(z.string(), z.any()).optional().describe("Champs requis selon le mode (adresse, date, incoterm, etc.)"),
      },
    },
    async ({ negotiation_id, mode, details }) => textResult(await dealrPost(apiKey, "/transaction-room", { negotiation_id, mode, details: details || {} }))
  );

  return server;
}

const app = createMcpExpressApp(
  process.env.ALLOWED_HOSTS
    ? { allowedHosts: process.env.ALLOWED_HOSTS.split(",").map((h) => h.trim()) }
    : { host: "0.0.0.0" } // pas de restriction de Host — pratique pour tester via un tunnel, à éviter en prod (préférer ALLOWED_HOSTS)
);

app.use(createOAuthRouter({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY, publicUrl: PUBLIC_URL }));

function unauthorized(res) {
  res
    .status(401)
    .set("WWW-Authenticate", `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`)
    .json({ jsonrpc: "2.0", error: { code: -32001, message: "Authentification requise (OAuth)" }, id: null });
}

app.post("/mcp", async (req, res) => {
  const match = (req.headers.authorization || "").match(/^Bearer\s+(dlr_live_\S+)$/);
  if (!match) return unauthorized(res);
  const apiKey = match[1];

  try {
    const server = getServer(apiKey);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Erreur MCP:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.writeHead(405).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur MCP DEALR (unifié, OAuth) en écoute sur le port ${PORT}`));
