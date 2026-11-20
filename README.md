# PhotoSweat MCP server

An [MCP](https://modelcontextprotocol.io) server for **background removal**. An agent hands
it the absolute path to a photo; it calls the hosted PhotoSweat API, writes the cut-out PNG
next to the original, and returns that path.

No GPU, no API client to write, no key required to start — the free tier is 10 images a day
per IP.

```text
photo_image_cutout({ path: "/Users/me/photo.jpg" })
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

Claude Code:

```bash
claude mcp add photo-workshop -- node /absolute/path/to/photosweat-mcp/server.mjs
```

Claude Desktop / Cursor / any client that reads an MCP config file:

```json
{
  "mcpServers": {
    "photo-workshop": {
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

That endpoint exposes one tool, `remove_background`, taking `image_url` or `image_base64` and
returning the cut-out as an image content block. The anonymous quota is 10 images/day per IP.
Per-client instructions: https://photosweat.shop/remove-background-mcp

Registered in the official MCP Registry as `shop.photosweat/remove-background`.

Note that the tool names differ by transport: the local server in this repo generates its tools
from `/api/capabilities` (currently `photo_image_cutout`, which takes a **file path**), while the
remote endpoint exposes `remove_background`, which takes **image bytes**. Same pipeline, same
allowance — only where the file lives differs.

## Tools

Exactly one tool is registered today, because exactly one capability is open.

| Tool | Arguments |
|---|---|
| `photo_image_cutout` | `path` (required), `out`, `background`, `color`, `format` |

- `path` — absolute path to a JPG / PNG / WebP file, 10 MB max.
- `out` — where to write the result; defaults to `<input>-<capability>.<ext>`.
- `background` — `transparent` (default), `white`, or `color`.
- `color` — `#rrggbb`, only used when `background` is `color`.
- `format` — `png` (default) or `jpeg`. JPEG only works on opaque backgrounds; transparency
  requires PNG.

Other capabilities in the document (restore, colorize, white-background, erase, upscale,
extend) are `paused` and will be registered automatically if they reopen.

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
- 10 images/day anonymously (per IP), 30/day with a key, 200/day signed in on the website.
- Past the free allowance: prepaid credits at **$0.01/image** ($10 = 1,000 images).
- Anonymous requests are rate-limited to 30/minute.
- Results are deleted after 24 hours. Save them yourself.

## Development

`server.mjs` and `client.mjs` in this repository are **generated** from the private worker
source and carry a header saying so. Change them upstream and re-sync; edits here are
overwritten. Behaviour is versioned together with the API, which is why the server reports its
own version rather than tracking the npm package independently.

## License

MIT. See `LICENSE`.
