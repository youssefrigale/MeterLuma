# Additional provider icons

These assets identify providers in the compact connection list and sidebar. `sources.json` records each catalog ID, asset, source URL, SHA-256 hash and rendering mode. The 44 entries use 42 distinct bundled files; region variants share the relevant service mark. No icon is fetched at runtime.

Lobe Icons files are an unmodified static SVG subset pinned to `@lobehub/icons-static-svg` 1.101.0, with its MIT license retained in `LICENSE-LobeIcons.txt`. Other assets come from public provider or owner sources. `NOTICE.txt` retains their provenance and is included by `scripts/generate-notices.py` in the app's third-party notices. Trademark rights remain with their owners.

CrofAI uses its documentation owner's public monogram because the former provider site redirects and a service-specific logo was unavailable. Pioneer uses the favicon currently returned by its dashboard redirect. These are source limitations, not newly drawn product marks.

`src/additional/logos.ts` maps the assets into the frontend. Monochrome assets use their alpha shape as a theme-colored CSS mask; other assets retain their supplied colors. `AdditionalLogo.tsx` quotes the mask URL so Vite's embedded SVG URLs remain valid CSS. Original asset bytes stay unchanged.

Antigravity uses the supplied monochrome vector variant for a sharp small icon. Its color variant is retained as a source asset, but is not bundled by the current mapping because it contains a blur effect.

Warp uses the 196 × 196 image supplied by its official favicon links, replacing the earlier 16 × 16 source for sharper Retina rendering.

OpenCode’s vector also supplies the [native macOS menu template](../../../src-tauri/icons/providers/README.md), shown beside its selected allowance.
