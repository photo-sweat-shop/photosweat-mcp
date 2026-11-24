# Photo Sweat Shop MCP server

An [MCP](https://modelcontextprotocol.io) server for **background removal and upscaling**. An agent
hands it the absolute path to a photo; it calls the hosted Photo Sweat Shop API, writes the result next to
the original, and returns that path.

One server, several tools — today the live `remove_background` and the beta `upscale`, both named
after their REST slugs. The list grows as capabilities open, and nothing is hand-written twice.

No GPU, no API client to write, no key required to start — the free tier is 10 credits a day
per IP (one cutout = 1 credit, one upscale = 2).

```text
remove_background({ path: "/Users/me/photo.jpg" })
  → Saved image/png to /Users/me/photo-cutout.png (1437218 bytes). jobId: 5f0c…
```

## Why this one

- **The tool list is generated, not hand-written.** On startup the server reads
  `GET /api/capabilities` and registers one tool per open capability, deriving each parameter
  schema (type, range, default, enum) from that document. There is no second copy of the API
  to drift out of date.
- **Only capabilities that actually answer are registered.** Tools marked `paused` in the
  capability document are skipped, so an agent never picks a tool that would return
  `404 tool_paused`. A short tool list beats a wasted call.
- **Hosted on real GPUs.** Edges are hair-level, output is a real alpha channel.

## Install

```bash
git clone <this-repo> photosweat-mcp
cd photosweat-mcp
npm install
```

Node 18 or newer.

## Connect it

Gemini CLI — the extension points at the hosted endpoint, so there is nothing to clone or build:

```bash
gemini extensions install https://github.com/photo-sweat-shop/photosweat-mcp
```

Agent Plugins hosts (Cursor, VS Code, Copilot, ChatGPT, Codex, Kiro) — this repository is also an
[Agent Plugins 1.0](https://agent-plugins.org) package: `plugin.json` plus a root `mcp.json` that
declares the hosted server as `streamable-http`, so those hosts pick up the same endpoint with no
local process.

Claude Code:

```bash
claude mcp add photosweat -- node /absolute/path/to/photosweat-mcp/server.mjs
```

Claude Desktop / Cursor / any client that reads an MCP config file:

```json
{
  "mcpServers": {
    "photosweat": {
      "command": "node",
      "args": ["/absolute/path/to/photosweat-mcp/server.mjs"],
      "env": {
        "PHOTO_API": "https://photosweat.shop"
      }
    }
  }
}
```

`env` can be omitted entirely — the defaults below are the public API.

| Variable | Default | Meaning |
|---|---|---|
| `PHOTO_API` | `https://photosweat.shop` | Base URL of the API |
| `PHOTO_KEY` | *(unset)* | API key. Raises the daily allowance to 30 and gives you a stable identity |
| `PHOTO_MCP_ALL` | *(unset)* | `1` also registers paused tools. For testing the schema generation; don't set it in normal use |

## Or skip the install

The same capability is served remotely over Streamable HTTP — no clone, no `npm install`, no key:

```json
{ "mcpServers": { "photosweat": { "url": "https://photosweat.shop/mcp" } } }
```

Claude Code:

```bash
claude mcp add --transport http photosweat https://photosweat.shop/mcp
```

That endpoint exposes the same two tools the local server registers — `remove_background` and the
beta `upscale` — taking `image_url` or `image_base64` and returning the result as an image content
block. Names are derived from the REST slugs, so they match `POST /api/remove-background` and
`POST /api/upscale`. The anonymous quota is 10 credits/day per IP (an upscale costs 2).
Per-client instructions: https://photosweat.shop/remove-background-mcp

Registered in the official MCP Registry as `shop.photosweat/remove-background`.

The only difference between the two transports is where the image lives: the local server in this
repo takes a **file path**, the remote endpoint takes **image bytes**. Same pipeline, same
allowance. An upscale takes 30–60 s, longer than a tool call should block, so on the hosted
endpoint it usually returns text carrying a `status_url` — poll that and fetch `result_url` rather
than resending the image.

## Tools

Two tools are registered today: the live cutout and the beta upscale. Both are generated from
`/api/capabilities` at startup, so a parameter's default is whatever that document says, and the
names are the same ones the hosted endpoint uses.

| Tool | Arguments |
|---|---|
| `remove_background` | `path` (required), `out`, `background`, `color`, `format`, `fillRatio`, `longEdge`, `verifyText` |
| `upscale` *(beta)* | `path` (required), `out`, `scale`, `engine`, `face`, `verifyText` |
| `erase` *(beta)* | `path` (required), `mask` (required), `out` |

- `path` — absolute path to a JPG / PNG / WebP file, 10 MB max.
- `out` — where to write the result; defaults to `<input>-<capability>.<ext>`.
- `background` — `transparent` (default), `white`, or `color`.
- `color` — `#rrggbb`, only used when `background` is `color`.
- `format` — `png` (default) or `jpeg`. JPEG only works on opaque backgrounds; transparency
  requires PNG.
- `fillRatio` — marketplace framing, `0` (default) keeps the canvas at the input size. `1`–`100`
  crops to the subject and centres it on a square canvas, the subject's **longest side** taking
  that share of the canvas side — the measure marketplaces use for "subject fill".
- `longEdge` — side of that square canvas in px, `0`–`4096`, default `0` (derive it from
  `fillRatio` without resampling the subject).
- `verifyText` — **off by default**. Turn it on to OCR the source and the result and receive a
  list of missing or changed characters; it adds roughly 4–30 s, because it runs on CPU. On the
  small backup GPU it may come back as `unavailable` instead of a verdict; the image is
  unaffected either way.
- `scale` — `2` or `4` (default `4`); prefer `2` for packaging, labels and other dense text.
- `engine` — `ultrasharp` (default) or `x4plus`; `x4plus` keeps text edges cleaner.
- `face` — **on by default**. After enlarging, faces are restored once (no reshaping, no blue-iris
  artifact), about a second per face, up to 8 faces per image. Send `false` to skip it. Same price
  either way.
- `verifyText` — **off by default**. Turn it on to OCR the source and the result and receive a
  list of missing or changed characters; it adds roughly 5 s on sparse text and up to 30 s on
  dense layouts, because it runs on CPU.

`erase` is **beta** as of 2026-11-23. This stdio server already knows how to send a mask, so it
registers the tool with an extra `mask` argument (absolute path to a PNG: white = the area to
erase). The hosted `/mcp` endpoint has no mask channel yet, so it deliberately does not list
`erase` — use this package, or REST multipart, for erasing.

Other capabilities in the document (restore, colorize, extend, scan-text, generate) are
`paused` and will be registered automatically if they reopen.

## Under the hood

Each call is the same three-step flow the website uses: `POST /api/presign` → `PUT` the bytes
to the returned presigned URL → `POST /api/jobs` → poll `GET /api/jobs/{id}` → download the
result. `PHOTO_KEY`, when set, is sent as `Authorization: Bearer …` on the API calls only —
never on the presigned URL, whose signature does not cover that header.

## Using the HTTP API directly instead

If you are not driving an agent, the single-request endpoint is simpler:

```bash
curl -sS https://photosweat.shop/api/remove-background \
  -H "Authorization: Bearer $PHOTO_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data-binary @photo.jpg \
  -o photo-cutout.png
```

It returns the image bytes with `200`, or `202` with a JSON body containing `status_url` if
the synchronous wait (20 s by default, `?wait=N` to change it) runs out — poll that URL rather
than resending the image. Add `?format=json` to always get JSON with a `result_url` instead of
bytes, and `?params={"background":"white"}` to change the options.

- `GET /api/capabilities` — every capability, its parameters, status and price.
- `GET /openapi.json` — the full OpenAPI description.
- `https://photosweat.shop/apikey` — keys, quickstart, batch endpoint, SDK.

## Limits

- 10 MB per image; JPG, PNG or WebP.
- 10 credits/day anonymously (per IP), 30 credits/day with a free account (the website and your API key share it).
- Past the free allowance: prepaid credits at **$0.01/credit** ($10 = 1,000 credits); a cutout costs 1, an upscale 2.
- Anonymous requests are rate-limited to 30/minute.
- Results are deleted after 24 hours. Save them yourself.

## Development

`server.mjs` and `client.mjs` in this repository are **generated** from the private worker
source and carry a header saying so. Change them upstream and re-sync; edits here are
overwritten. Behaviour is versioned together with the API, which is why the server reports its
own version rather than tracking the npm package independently.

## License

MIT. See `LICENSE`.
