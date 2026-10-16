# Provider logos

These logos identify the services MeterLuma reads usage from. They are not MeterLuma branding, and MeterLuma's license does not cover them. Each owner keeps all rights in its marks. MeterLuma is not affiliated with or endorsed by Anthropic, OpenAI or Anysphere (Cursor).

Every file is the owner's official artwork, byte-for-byte as downloaded on 2026-10-16:

| File | Mark | Owner | Official source (file name there) |
| --- | --- | --- | --- |
| `claude.svg` | Claude Spark, Clay | Anthropic | [Anthropic press kit](https://www.anthropic.com/press-kit) (`Claude Spark - Clay.svg`) |
| `codex-on-light.svg`, `codex-on-dark.svg` | OpenAI Blossom, black and white | OpenAI | [OpenAI brand guidelines](https://openai.com/brand/), "Download logos" (`OAI_OpenAI-Blossom_Black.svg`, `OAI_OpenAI-Blossom_White.svg`) |
| `cursor-on-light.svg`, `cursor-on-dark.svg` | Cursor cube, 2D | Anysphere | [Cursor brand guidelines](https://cursor.com/brand) (`CUBE_2D_LIGHT.svg`, `CUBE_2D_DARK.svg`) |

Rules for these files:

- **Never edit a file.** Don't change colors, shapes or proportions, or crop the Blossom's built-in clear space. Size them with CSS instead; `styles.css` scales the Blossom because its file includes OpenAI's required clear space.
- **Pick the file for the background.** `*-on-light` files are for the light theme and `*-on-dark` files for the dark theme. `ProviderLogo.tsx` renders both, and CSS shows the one that matches. The Claude Spark has a single color for both themes.
- **Use them only to identify the service** next to its name, never as MeterLuma's own branding. MeterLuma's name and mark stay more prominent.
- **OpenAI.** The owner accepted OpenAI's Marks usage terms on 2026-10-16 to download the logos. Use the Blossom in black or white only, never as primary branding, and with open space around it. OpenAI may require changes or end the permission at any time.
- **Anthropic.** Anthropic's [trademark guidelines](https://www.anthropic.com/legal/trademark-guidelines) allow its marks only as specifically permitted, in materials it approves beforehand.
- **Cursor.** Refer to it as "Cursor", not "Cursor AI" or "Cursor Code".
