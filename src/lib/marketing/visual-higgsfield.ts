/**
 * Wave 4 Phase 6c — Higgsfield REST generate API (NOT MCP).
 * Server-only. Submit + poll. Copy output into our storage; never persist HF URLs.
 */

import { isHiggsfieldConfigured } from "@/lib/marketing/visual-flags";
import type { VisualGenKind } from "@/lib/marketing/visual-pack-ui";

export const HIGGSFIELD_API_BASE = "https://api.higgsfield.ai";
export const HIGGSFIELD_NANO_T2I_PATH = "/nano-banana-2/text-to-image";
export const HIGGSFIELD_NANO_I2I_PATH = "/nano-banana-2/image-to-image";
/** Cloud strongest Nano Banana 2 setting. Pro is not on Cloud. Lite is weaker. */
export const HIGGSFIELD_NANO_RESOLUTION = "4k";
/**
 * Preferred Cloud Seedance (OpenAPI). This account 404s it (`model_not_found`);
 * Generate then retries lite. Still Seedance — not Kling/Veo. No 2.0 path.
 */
export const HIGGSFIELD_SEEDANCE_I2V_PATH =
  "/bytedance/seedance/v1/pro/fast/image-to-video";
export const HIGGSFIELD_SEEDANCE_T2V_PATH =
  "/bytedance/seedance/v1/pro/fast/text-to-video";
export const HIGGSFIELD_SEEDANCE_I2V_FALLBACK_PATH =
  "/bytedance/seedance/v1/lite/image-to-video";
export const HIGGSFIELD_SEEDANCE_T2V_FALLBACK_PATH =
  "/bytedance/seedance/v1/lite/text-to-video";
/** Same Seedance paths on platform if Cloud api 404s this account. Not Kling/Veo. */
export const HIGGSFIELD_SEEDANCE_SUBMIT_BASES = [
  HIGGSFIELD_API_BASE,
  "https://platform.higgsfield.ai",
] as const;
/** Strongest setting Cloud documents for this path (480 / 720 / 1080). */
export const HIGGSFIELD_SEEDANCE_RESOLUTION = "1080";
/** Cloud I2V schema is a single start frame (`image_url`). */
export const HIGGSFIELD_SEEDANCE_PACK_PHOTO_LIMIT = 1;
const HIGGSFIELD_NANO_PACK_PHOTO_LIMIT = 8;

const POLL_START_MS = 2000;
const POLL_MAX_MS = 10_000;
const POLL_DEADLINE_MS = 150_000;
const DOWNLOAD_MAX_BYTES = 32 * 1024 * 1024;

export type VisualGenRunnerInput = {
  tool: "nano_banana" | "seedance";
  prompt: string;
  photos: Array<{ bytes: Buffer; mimeType: string }>;
  motionClip: { bytes: Buffer; mimeType: string } | null;
};

export type VisualGenRunnerResult =
  | { ok: true; media: { bytes: Buffer; mimeType: string; kind: VisualGenKind } }
  | {
      ok: false;
      error: "api_error" | "nsfw" | "no_keys" | "hf_credits" | "hf_model";
    };

/** Map Higgsfield HTTP status. Never parse detail text for control flow. */
export function mapHiggsfieldHttpStatus(
  status: number,
): "hf_credits" | "hf_model" | "api_error" {
  if (status === 403) return "hf_credits";
  if (status === 404) return "hf_model";
  return "api_error";
}

function higgsfieldLogTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "(bad-url)";
  }
}

function logHiggsfieldFailure(url: string, extra: string): void {
  console.error(`[higgsfield] ${higgsfieldLogTarget(url)} ${extra}`);
}

type HfCredentials = { keyId: string; secret: string };

/** Nano still vs Seedance clip (image-to-image / image-to-video when a pack photo exists). */
export function higgsfieldSubmitPath(
  tool: "nano_banana" | "seedance",
  photoCount: number,
): string {
  if (tool === "nano_banana") {
    return photoCount > 0 ? HIGGSFIELD_NANO_I2I_PATH : HIGGSFIELD_NANO_T2I_PATH;
  }
  return seedanceSubmitPaths(photoCount)[0]!;
}

/** Preferred Seedance path first; lite if this Cloud account 404s pro/fast. */
export function seedanceSubmitPaths(photoCount: number): string[] {
  if (photoCount > 0) {
    return [
      HIGGSFIELD_SEEDANCE_I2V_PATH,
      HIGGSFIELD_SEEDANCE_I2V_FALLBACK_PATH,
    ];
  }
  return [HIGGSFIELD_SEEDANCE_T2V_PATH, HIGGSFIELD_SEEDANCE_T2V_FALLBACK_PATH];
}

/** api host first, then platform — still Seedance only. */
export function seedanceSubmitUrls(photoCount: number): string[] {
  const paths = seedanceSubmitPaths(photoCount);
  return HIGGSFIELD_SEEDANCE_SUBMIT_BASES.flatMap((base) =>
    paths.map((p) => `${base}${p}`),
  );
}

export function resolveHiggsfieldCredentials(
  env: Record<string, string | undefined> = process.env,
): HfCredentials | null {
  const keyId = env.HF_API_KEY_ID?.trim() ?? "";
  const secret = env.HF_API_KEY_SECRET?.trim() ?? "";
  if (!keyId || !secret) return null;
  return { keyId, secret };
}

function authHeader(creds: HfCredentials): string {
  return `Key ${creds.keyId}:${creds.secret}`;
}

function isHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isHiggsfieldStatusUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname;
    return (
      u.protocol === "https:" &&
      (host === "api.higgsfield.ai" || host === "platform.higgsfield.ai") &&
      /^\/requests\/[^/]+\/status$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

async function hfJson(
  url: string,
  creds: HfCredentials,
  init?: RequestInit,
): Promise<
  { ok: true; body: unknown } | { ok: false; status?: number }
> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: authHeader(creds),
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      logHiggsfieldFailure(url, `${res.status} ${detail}`);
      return { ok: false, status: res.status };
    }
    return { ok: true, body: await res.json() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch_failed";
    logHiggsfieldFailure(url, msg);
    return { ok: false };
  }
}

async function uploadInputFile(
  creds: HfCredentials,
  bytes: Buffer,
  mimeType: string,
): Promise<string | null> {
  const mime = mimeType.trim() || "image/jpeg";
  const created = await hfJson(
    `${HIGGSFIELD_API_BASE}/files/generate-upload-url`,
    creds,
    {
      method: "POST",
      body: JSON.stringify({ content_type: mime }),
    },
  );
  if (!created.ok || !created.body || typeof created.body !== "object") {
    return null;
  }
  const row = created.body as {
    public_url?: unknown;
    upload_url?: unknown;
    upload_headers?: unknown;
  };
  const publicUrl = typeof row.public_url === "string" ? row.public_url : "";
  const uploadUrl = typeof row.upload_url === "string" ? row.upload_url : "";
  if (!isHttpsUrl(publicUrl) || !isHttpsUrl(uploadUrl)) return null;
  const headers: Record<string, string> = {};
  if (row.upload_headers && typeof row.upload_headers === "object") {
    for (const [k, v] of Object.entries(
      row.upload_headers as Record<string, unknown>,
    )) {
      if (typeof v === "string") headers[k] = v;
    }
  }
  try {
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(30_000),
    });
    if (!put.ok) return null;
    return publicUrl;
  } catch {
    return null;
  }
}

type HfStatus = {
  status?: unknown;
  status_url?: unknown;
  images?: unknown;
  video?: unknown;
  error?: unknown;
  request_id?: unknown;
};

function outputUrlFromStatus(body: HfStatus, kind: VisualGenKind): string | null {
  if (kind === "clip") {
    const video = body.video;
    if (video && typeof video === "object" && "url" in video) {
      const url = (video as { url?: unknown }).url;
      return typeof url === "string" && isHttpsUrl(url) ? url : null;
    }
  }
  const images = body.images;
  if (Array.isArray(images) && images[0] && typeof images[0] === "object") {
    const url = (images[0] as { url?: unknown }).url;
    if (typeof url === "string" && isHttpsUrl(url)) return url;
  }
  return null;
}

async function pollUntilDone(
  creds: HfCredentials,
  statusUrl: string,
  kind: VisualGenKind,
): Promise<VisualGenRunnerResult> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  let delay = POLL_START_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, POLL_MAX_MS);
    const polled = await hfJson(statusUrl, creds);
    if (!polled.ok || !polled.body || typeof polled.body !== "object") {
      continue;
    }
    const body = polled.body as HfStatus;
    const status = typeof body.status === "string" ? body.status : "";
    if (status === "nsfw") return { ok: false, error: "nsfw" };
    if (status === "failed" || status === "canceled") {
      const err =
        "error" in body && typeof body.error === "string" ? body.error : "";
      logHiggsfieldFailure(statusUrl, `${status} ${err}`.trim());
      return { ok: false, error: "api_error" };
    }
    if (status === "completed") {
      const url = outputUrlFromStatus(body, kind);
      if (!url) return { ok: false, error: "api_error" };
      const media = await downloadOutput(url, kind);
      return media;
    }
  }
  return { ok: false, error: "api_error" };
}

async function downloadOutput(
  url: string,
  kind: VisualGenKind,
): Promise<VisualGenRunnerResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { ok: false, error: "api_error" };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length <= 0 || buf.length > DOWNLOAD_MAX_BYTES) {
      return { ok: false, error: "api_error" };
    }
    const headerMime = res.headers.get("content-type")?.split(";")[0]?.trim();
    const mimeType =
      headerMime ||
      (kind === "clip" ? "video/mp4" : "image/jpeg");
    return { ok: true, media: { bytes: buf, mimeType, kind } };
  } catch {
    return { ok: false, error: "api_error" };
  }
}

function seedancePrompt(input: VisualGenRunnerInput): string {
  if (!input.motionClip) return input.prompt;
  return `${input.prompt}\nProduct-motion proof (pour/collapse) exists — imply that motion; do not edit founder footage.`;
}

export async function runHiggsfieldVisualGen(
  input: VisualGenRunnerInput,
  env: Record<string, string | undefined> = process.env,
): Promise<VisualGenRunnerResult> {
  if (!isHiggsfieldConfigured(env)) return { ok: false, error: "no_keys" };
  const creds = resolveHiggsfieldCredentials(env);
  if (!creds) return { ok: false, error: "no_keys" };

  const photoLimit =
    input.tool === "seedance"
      ? HIGGSFIELD_SEEDANCE_PACK_PHOTO_LIMIT
      : HIGGSFIELD_NANO_PACK_PHOTO_LIMIT;
  const photoUrls: string[] = [];
  for (const photo of input.photos.slice(0, photoLimit)) {
    const url = await uploadInputFile(creds, photo.bytes, photo.mimeType);
    if (url) photoUrls.push(url);
  }
  if (
    input.tool === "seedance" &&
    input.photos.length > 0 &&
    photoUrls.length === 0
  ) {
    logHiggsfieldFailure(
      `${HIGGSFIELD_API_BASE}/files/generate-upload-url`,
      "seedance start-frame upload missed; text-to-video",
    );
  }

  const kind: VisualGenKind = input.tool === "seedance" ? "clip" : "still";
  const path = higgsfieldSubmitPath(input.tool, photoUrls.length);
  let payload: Record<string, unknown>;

  if (input.tool === "nano_banana") {
    if (photoUrls.length > 0) {
      payload = {
        prompt: input.prompt,
        image_urls: photoUrls,
        resolution: HIGGSFIELD_NANO_RESOLUTION,
        aspect_ratio: "4:5",
        output_format: "jpeg",
      };
    } else {
      payload = {
        prompt: input.prompt,
        resolution: HIGGSFIELD_NANO_RESOLUTION,
        aspect_ratio: "4:5",
        output_format: "jpeg",
        batch_size: 1,
      };
    }
  } else if (photoUrls[0]) {
    payload = {
      prompt: seedancePrompt(input),
      image_url: photoUrls[0],
      duration: 5,
      resolution: HIGGSFIELD_SEEDANCE_RESOLUTION,
      aspect_ratio: "9:16",
    };
  } else {
    payload = {
      prompt: seedancePrompt(input),
      duration: 5,
      resolution: HIGGSFIELD_SEEDANCE_RESOLUTION,
      aspect_ratio: "9:16",
    };
  }

  const seedanceUrls =
    input.tool === "seedance"
      ? seedanceSubmitUrls(photoUrls.length)
      : [`${HIGGSFIELD_API_BASE}${path}`];
  let submitted: Awaited<ReturnType<typeof hfJson>> | null = null;
  let usedUrl = seedanceUrls[0] ?? `${HIGGSFIELD_API_BASE}${path}`;
  for (const tryUrl of seedanceUrls) {
    usedUrl = tryUrl;
    submitted = await hfJson(tryUrl, creds, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (submitted.ok) break;
    if (submitted.status === 404 && tryUrl !== seedanceUrls.at(-1)) {
      continue;
    }
    break;
  }
  if (
    !submitted ||
    !submitted.ok ||
    !submitted.body ||
    typeof submitted.body !== "object"
  ) {
    return {
      ok: false,
      error:
        submitted && submitted.ok === false && submitted.status
          ? mapHiggsfieldHttpStatus(submitted.status)
          : "api_error",
    };
  }
  const body = submitted.body as HfStatus;
  const status = typeof body.status === "string" ? body.status : "";
  if (status === "nsfw") return { ok: false, error: "nsfw" };
  if (status === "failed" || status === "canceled") {
    const err =
      "error" in body && typeof body.error === "string" ? body.error : "";
    logHiggsfieldFailure(usedUrl, `${status} ${err}`.trim());
    return { ok: false, error: "api_error" };
  }
  if (status === "completed") {
    const url = outputUrlFromStatus(body, kind);
    if (!url) return { ok: false, error: "api_error" };
    return downloadOutput(url, kind);
  }
  const requestId =
    "request_id" in body && typeof body.request_id === "string"
      ? body.request_id
      : "";
  let usedOrigin = HIGGSFIELD_API_BASE;
  try {
    usedOrigin = new URL(usedUrl).origin;
  } catch {
    usedOrigin = HIGGSFIELD_API_BASE;
  }
  const statusUrl =
    typeof body.status_url === "string"
      ? body.status_url
      : requestId
        ? `${usedOrigin}/requests/${encodeURIComponent(requestId)}/status`
        : "";
  if (!isHiggsfieldStatusUrl(statusUrl)) return { ok: false, error: "api_error" };
  return pollUntilDone(creds, statusUrl, kind);
}
