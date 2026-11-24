// GENERATED FILE — do not edit in this repository.
// Source of truth: photo-tool/web/mcp/client.mjs. Re-sync with `node tools/sync-mcp-repo.mjs`.
// Three-step upload → submit → poll client. Shared by the MCP server and the tests,
// so the flow is written down exactly once (the curl examples in the docs must match this).
import fs from "node:fs";
import path from "node:path";

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const DEFAULT_API = process.env.PHOTO_API || "https://photosweat.shop";
const MAX_BYTES = 10 * 1024 * 1024;

// Optional API key. Anonymous access is 10 credits/day per exit IP; a key is 30 credits/day and
// gives you a stable identity (anonymous accounting follows the IP, so a proxy hop
// makes you a different person).
const KEY = process.env.PHOTO_KEY || "";

// Only our own API calls get Authorization. The R2 presigned URLs must NOT carry it —
// the signature does not include that header, and an extra header fails the check.
function authHeaders(extra) {
  if (!KEY) return extra || {};
  return { ...(extra || {}), authorization: "Bearer " + KEY };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mimeOf(file) {
  const t = MIME[path.extname(file).toLowerCase()];
  if (!t) throw new Error(`Unsupported format: ${path.extname(file) || "(no extension)"} (JPG / PNG / WebP only)`);
  return t;
}

async function asJson(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const detail = body && (body.details ? body.details.join("; ") : body.error);
    throw new Error(`${res.status} ${detail || res.statusText}`);
  }
  return body;
}

function abs(api, url) {
  return /^https?:\/\//i.test(url) ? url : new URL(url, api).toString();
}

/**
 * Run one job: upload → submit → poll → write the result to disk.
 * @returns {Promise<{jobId:string, file:string, bytes:number, status:string}>}
 */
export async function runJob({
  api = DEFAULT_API,
  file,
  capability,
  params = {},
  mask = null,
  out,
  timeoutMs = 180000,
  pollMs = 800,
  log = () => {},
}) {
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_BYTES) throw new Error(`Image is ${bytes.length} bytes, over the 10 MB limit`);
  const type = mimeOf(file);

  log(`presign ${path.basename(file)} (${bytes.length} B)`);
  const pre = await asJson(
    await fetch(api + "/api/presign", {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ size: bytes.length, type }),
    })
  );

  log("upload");
  const put = await fetch(abs(api, pre.uploadUrl), {
    method: "PUT",
    headers: { "content-type": type },
    body: bytes,
  });
  if (!put.ok) throw new Error(`Upload failed: ${put.status} ${await put.text()}`);

  let hasMask = false;
  if (mask) {
    const mbytes = fs.readFileSync(mask);
    log(`mask ${path.basename(mask)} (${mbytes.length} B)`);
    const mp = await asJson(
      await fetch(api + "/api/presign", {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ jobId: pre.jobId, size: mbytes.length, type: "image/png", mask: true }),
      })
    );
    const mput = await fetch(abs(api, mp.uploadUrl), {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: mbytes,
    });
    if (!mput.ok) throw new Error(`Mask upload failed: ${mput.status}`);
    hasMask = true;
  }

  log(`submit ${capability}`);
  const job = await asJson(
    await fetch(api + "/api/jobs", {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ jobId: pre.jobId, capability, params, mask: hasMask }),
    })
  );
  const jobId = job.jobId || pre.jobId;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await asJson(await fetch(`${api}/api/jobs/${jobId}`, { headers: authHeaders() }));
    if (s.status === "done") {
      if (!s.resultUrl) throw new Error("Job finished but returned no resultUrl");
      const r = await fetch(abs(api, s.downloadUrl || s.resultUrl));
      if (!r.ok) throw new Error(`Download failed: ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      // Take the extension from the returned Content-Type (cutout is PNG, white-bg is JPEG).
      const ct = r.headers.get("content-type") || "";
      const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpg";
      const target = out || file.replace(/\.[^.]+$/, "") + `-${capability.split(".")[1]}` + ext;
      fs.writeFileSync(target, buf);
      return { jobId, file: target, bytes: buf.length, status: s.status };
    }
    if (s.status === "failed" || s.status === "error") throw new Error(s.error || "Job failed");
    if (s.status === "expired") throw new Error("Result expired (kept for 24 hours)");
    await sleep(pollMs);
  }
  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s, jobId=${jobId}`);
}

/** Fetch the capability list: both the MCP tool list and the parameter schemas come from it. */
export async function fetchCapabilities(api = DEFAULT_API) {
  const doc = await asJson(await fetch(api + "/api/capabilities"));
  if (!doc || !Array.isArray(doc.capabilities)) throw new Error("Unexpected capability document");
  return doc;
}
