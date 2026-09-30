import { test } from "node:test";
import assert from "node:assert/strict";
import { imageContentBlocks } from "../src/image-content.js";

const supabaseUrl = "https://example.supabase.co";
const imageUrl = `${supabaseUrl}/storage/v1/object/public/listing-photos/item/photo.png`;

test("imageContentBlocks returns an MCP image block for a public listing photo", async () => {
  const blocks = await imageContentBlocks(
    [{ url: imageUrl, label: "Vélo" }],
    supabaseUrl,
    async () => new Response(Buffer.from("fake-image"), { headers: { "content-type": "image/png" } })
  );

  assert.deepEqual(blocks, [
    { type: "text", text: "Photo de « Vélo »" },
    { type: "image", data: Buffer.from("fake-image").toString("base64"), mimeType: "image/png" },
  ]);
});

test("imageContentBlocks does not fetch external or non-storage URLs", async () => {
  let fetchCount = 0;
  const blocks = await imageContentBlocks(
    [
      { url: "https://attacker.example/image.png", label: "external" },
      { url: `${supabaseUrl}/storage/v1/object/public/other-bucket/image.png`, label: "other bucket" },
    ],
    supabaseUrl,
    async () => { fetchCount += 1; return new Response(); }
  );

  assert.deepEqual(blocks, []);
  assert.equal(fetchCount, 0);
});

test("imageContentBlocks ignores unsupported content types", async () => {
  const blocks = await imageContentBlocks(
    [{ url: imageUrl, label: "not an image" }],
    supabaseUrl,
    async () => new Response("html", { headers: { "content-type": "text/html" } })
  );

  assert.deepEqual(blocks, []);
});

test("imageContentBlocks ignores files larger than four MiB", async () => {
  const largeImageUrl = `${supabaseUrl}/storage/v1/object/public/listing-photos/item/large.png`;
  const blocks = await imageContentBlocks(
    [{ url: largeImageUrl, label: "too large" }],
    supabaseUrl,
    async () => new Response("x", {
      headers: { "content-type": "image/png", "content-length": String(5 * 1024 * 1024) },
    })
  );

  assert.deepEqual(blocks, []);
});

test("imageContentBlocks limits each tool response to four image URLs", async () => {
  let fetchCount = 0;
  const images = Array.from({ length: 6 }, (_, index) => ({ url: imageUrl, label: String(index) }));
  const blocks = await imageContentBlocks(images, supabaseUrl, async () => {
    fetchCount += 1;
    return new Response(Buffer.from("img"), { headers: { "content-type": "image/png" } });
  });

  assert.equal(fetchCount, 4);
  assert.equal(blocks.filter((block) => block.type === "image").length, 4);
});