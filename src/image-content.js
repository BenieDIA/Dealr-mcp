const MAX_IMAGES_PER_RESULT = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 7000;
const IMAGE_BUCKET_PATH = "/storage/v1/object/public/listing-photos/";
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

async function readImageBody(response) {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    byteLength += value.byteLength;
    if (byteLength > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }

  return byteLength ? Buffer.concat(chunks, byteLength) : null;
}

async function fetchImageBlocks({ url, label }, allowedOrigin, fetchImage) {
  let imageUrl;
  try {
    imageUrl = new URL(url);
  } catch {
    return [];
  }

  if (
    imageUrl.origin !== allowedOrigin ||
    !imageUrl.pathname.startsWith(IMAGE_BUCKET_PATH) ||
    imageUrl.username ||
    imageUrl.password
  ) {
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);

  try {
    const response = await fetchImage(imageUrl.href, {
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) return [];

    const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) return [];

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) return [];

    const imageData = await readImageBody(response);
    if (!imageData) return [];

    return [
      { type: "text", text: `Photo de « ${label || "annonce"} »` },
      { type: "image", data: imageData.toString("base64"), mimeType },
    ];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function imageContentBlocks(images, supabaseUrl, fetchImage = fetch) {
  const allowedOrigin = new URL(supabaseUrl).origin;
  const candidates = (Array.isArray(images) ? images : []).filter((image) => image?.url).slice(0, MAX_IMAGES_PER_RESULT);
  const blocks = await Promise.all(candidates.map((image) => fetchImageBlocks(image, allowedOrigin, fetchImage)));
  return blocks.flat();
}