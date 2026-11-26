#!/usr/bin/env node
// GENERATED FILE — do not edit in this repository.
// Source of truth: photo-tool/web/mcp/server.mjs. Re-sync with `node tools/sync-mcp-repo.mjs`.
// Photo Sweat Shop MCP server (stdio).
//
// The tool list is not hand-written: on startup we read GET /api/capabilities once and
// register one tool per capability, generating each parameter schema from the capability
// document. Add a capability upstream and the tool appears after a restart — no drift.
//
// stdout is the protocol channel, so every log line goes to console.error.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEFAULT_API, fetchCapabilities, runJob } from "./client.mjs";

const API = DEFAULT_API;
// 产品名（2026-11-25 统一）：这里原来写的是 "photo-workshop"，和线上服务卡、托管 MCP 的
// serverInfo 对不上。`name` 是客户端上显示的实现名，标识符走 npm 包名 `photosweat-mcp`。
const NAME = "Photo Sweat Shop";
const VERSION = "0.3.5";

function paramZod(spec) {
  let s;
  switch (spec.type) {
    case "enum":
      s = z.enum(spec.values);
      break;
    case "boolean":
      s = z.boolean();
      break;
    case "int":
      s = z.number().int();
      if (spec.min !== undefined) s = s.min(spec.min);
      if (spec.max !== undefined) s = s.max(spec.max);
      break;
    case "number":
      s = z.number();
      if (spec.min !== undefined) s = s.min(spec.min);
      if (spec.max !== undefined) s = s.max(spec.max);
      break;
    case "color":
      s = z.string().regex(/^#[0-9a-fA-F]{6}$/);
      break;
    default:
      s = z.string();
  }
  const help = [spec.desc?.en || spec.title?.en || "", `default: ${spec.default}`].filter(Boolean).join(" · ");
  if (help) s = s.describe(help);
  return spec.default !== undefined ? s.default(spec.default) : s.optional();
}

// 工具名与托管端点同一套规则：能力 slug 派生（remove_background / upscale），
// 也就是 /api/{slug} 和 /api/tools 里的那个名字。加能力只改能力表，两端一起变。
const toolName = (cap) =>
  (cap.slug ?? cap.id.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()).replace(/-/g, "_");

async function main() {
  let doc;
  try {
    doc = await fetchCapabilities(API);
  } catch (e) {
    console.error(`[photo-sweat-shop] could not load ${API}/api/capabilities: ${e.message}`);
    console.error("[photo-sweat-shop] check the network, or set PHOTO_API to a different base URL and retry.");
    process.exit(1);
  }

  const server = new McpServer({ name: NAME, version: VERSION });

  // Register only what is actually open (live / beta). The capability document also lists
  // paused tools; registering them would just invite the agent to pick one that is
  // guaranteed to answer 404 tool_paused — better one tool fewer than one wasted call.
  // PHOTO_MCP_ALL=1 registers everything, which the local tests use to check that the
  // parameter schemas really are generated from the capability document.
  const ALL = process.env.PHOTO_MCP_ALL === "1";

  let registered = 0;
  for (const cap of doc.capabilities) {
    if (!ALL && cap.status !== "live" && cap.status !== "beta") {
      console.error(`[photo-sweat-shop] skip ${cap.id} (${cap.status})`);
      continue;
    }
    registered++;
    const shape = {
      path: z.string().describe("Absolute path to the input image (JPG / PNG / WebP, max 10 MB)"),
      out: z.string().optional().describe("Where to write the result; defaults to <input>-<capability>.<ext>"),
    };
    if (cap.requiresMask) {
      shape.mask = z.string().describe("Absolute path to a PNG mask; white = the area to process");
    }
    for (const [name, spec] of Object.entries(cap.params || {})) shape[name] = paramZod(spec);

    server.registerTool(
      toolName(cap),
      {
        title: cap.title?.en || cap.id,
        description:
          `${cap.title?.en || cap.id} — ${cap.summary?.en || ""} ` +
          `Returns ${cap.output}, about ${cap.costSeconds}s. ` +
          (cap.requiresMask ? "Requires a PNG mask (white = area to process). " : "") +
          "Writes the result to disk and returns its path.",
        inputSchema: shape,
      },
      async (args) => {
        const { path: filePath, out, mask, ...params } = args;
        try {
          const r = await runJob({
            api: API,
            file: filePath,
            capability: cap.id,
            params,
            mask: mask || null,
            out,
            log: (m) => console.error(`[${cap.id}] ${m}`),
          });
          return {
            content: [
              { type: "text", text: `Saved ${cap.output} to ${r.file} (${r.bytes} bytes). jobId: ${r.jobId}` },
            ],
          };
        } catch (e) {
          return { content: [{ type: "text", text: `Failed: ${e.message}` }], isError: true };
        }
      }
    );
    console.error(`[photo-sweat-shop] tool ${toolName(cap)}`);
  }

  await server.connect(new StdioServerTransport());
  console.error(`[photo-sweat-shop] ready · ${registered} tools · ${API}`);
}

main().catch((e) => {
  console.error("[photo-sweat-shop] fatal:", e?.message || e);
  process.exit(1);
});
