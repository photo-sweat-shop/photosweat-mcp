# PhotoSweat — background removal

This extension adds one remote MCP server, `photosweat` (`https://photosweat.shop/mcp`), with a
single tool:

- `remove_background` — takes `image_base64` **or** `image_url`, plus optional `background`
  (`transparent` | `white` | `color`), `color` (`#rrggbb`), and `format` (`png` | `jpeg`).
  Returns the cut-out image.

Use it when the user asks to remove, erase, or replace the background of a photo, or wants a
transparent PNG cut-out of a product or portrait.

Notes:

- 10 MB max per image; JPG, PNG or WebP.
- Free tier is 10 images a day per IP with no key. Do not ask the user for a key unless the
  call fails with `quota_exceeded`.
- Transparency needs `format: "png"` (the default). `jpeg` only works with an opaque background.
- If the call returns `404 tool_paused`, the tool is temporarily disabled — tell the user
  instead of retrying.
