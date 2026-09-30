import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { labelForRedirect, verifyPkce, displayLabel } from "../src/oauth-helpers.js";

test("labelForRedirect reconnaît Claude", () => {
  assert.equal(labelForRedirect("https://claude.ai/api/mcp/callback"), "claude");
  assert.equal(labelForRedirect("https://www.claude.com/callback"), "claude");
});

test("labelForRedirect reconnaît ChatGPT", () => {
  assert.equal(labelForRedirect("https://chatgpt.com/connector_platform_oauth_redirect"), "chatgpt");
  assert.equal(labelForRedirect("https://api.openai.com/callback"), "chatgpt");
});

test("labelForRedirect retombe sur le nom d'hôte pour un client inconnu", () => {
  assert.equal(labelForRedirect("https://mon-app.example.com/cb"), "mon-app.example.com");
});

test("labelForRedirect ne plante jamais sur une URL invalide", () => {
  assert.equal(labelForRedirect("pas-une-url"), "app");
  assert.equal(labelForRedirect(""), "app");
  assert.equal(labelForRedirect(undefined), "app");
});

test("verifyPkce accepte le bon code_verifier", () => {
  const verifier = "un-secret-genere-par-le-client-1234567890";
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(verifyPkce(verifier, challenge), true);
});

test("verifyPkce rejette un mauvais code_verifier", () => {
  const challenge = crypto.createHash("sha256").update("le-bon-verifier").digest("base64url");
  assert.equal(verifyPkce("un-mauvais-verifier", challenge), false);
});

test("verifyPkce rejette un code_verifier absent", () => {
  const challenge = crypto.createHash("sha256").update("le-bon-verifier").digest("base64url");
  assert.equal(verifyPkce(undefined, challenge), false);
});

test("displayLabel traduit les labels connus, sinon renvoie tel quel", () => {
  assert.equal(displayLabel("claude"), "Claude");
  assert.equal(displayLabel("chatgpt"), "ChatGPT");
  assert.equal(displayLabel("mon-app.example.com"), "mon-app.example.com");
});
