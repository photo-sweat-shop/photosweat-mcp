# Photo Sweat Shop — background removal, upscaling and old photo restoration

This extension adds one remote MCP server, `photosweat` (`https://photosweat.shop/mcp`), with three
tools:

- `remove_background` — takes `image_base64` **or** `image_url`, plus optional `background`
  (`transparent` | `white` | `color`), `color` (`#rrggbb`), `format` (`png` | `jpeg`),
  `fillRatio` (`0`–`100`, default `0` = keep the input canvas; otherwise crop to the subject and
  centre it on a square canvas, its longest side taking that share) and `longEdge` (that square
  canvas's side in px, `0`–`4096`, default `0` = derive it from `fillRatio`).
  Returns the cut-out image.
- `upscale` *(beta)* — same image arguments, plus `scale` (`2` | `4`, default `4`), `engine`
  (`ultrasharp` | `x4plus`), `face` (bool, default **on**: restores faces after enlarging,
  about a second per face, up to 8 faces; `false` skips it) and `verifyText` (bool, default off).
  Enlarges the image 2× or 4×.
  It takes 30–60 s, so it usually returns text with a `status_url` — poll that and fetch
  `result_url`; do not resend the image.
- `colorize` *(beta)* — old photo restoration (the web page is `/restore`). Same image arguments and
  **no parameters**: faces are redrawn with the rest of the photo, nothing is pasted back. Redraws
  the whole photo to remove halftone and print grain, reduce scratches and stains, and restore
  natural colour (the aspect ratio is unchanged). The result is always a JPEG whose long edge is at
  most 1024 px. Colour photos are restored too — same model, same 2 credits.

Use it when the user asks to remove, erase, or replace the background of a photo, wants a
transparent PNG cut-out of a product or portrait, asks to enlarge / upscale an image, or wants an
old photo restored (scratches reduced, colour brought back).

Notes:

- 10 MB max per image; JPG, PNG or WebP.
- Free tier is 10 credits a day per IP with no key (a cutout costs 1; an upscale or an old photo restoration 2).
  Do not ask the user for a key unless the call fails with `quota_exceeded`.
- Transparency needs `format: "png"` (the default). `jpeg` only works with an opaque background.
- If the call returns `404 tool_paused`, the tool is temporarily disabled — tell the user
  instead of retrying.
