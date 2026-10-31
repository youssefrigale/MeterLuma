# Native menu-bar provider icons

`opencode.png` is a 96 × 96 transparent raster of the bundled [OpenCode vector](../../../src/assets/additional/opencode.svg), preserving its geometry and clear space. Its source and license are recorded in [additional icon sources](../../../src/assets/additional/README.md). macOS treats it as a template and sizes its visible mark to 13.5 points.

Regenerate it from the existing SVG with librsvg:

```sh
rsvg-convert -w 96 -h 96 -o src-tauri/icons/providers/opencode.png src/assets/additional/opencode.svg
```

`codex.png` is an 80 × 80 native menu raster derived from the official [Blossom SVG](../../../src/assets/providers/codex-on-light.svg). The menu copy removes the empty outer canvas and displays the unchanged mark at 13.5 points; the native button supplies its surrounding spacing. The source SVG and all interface SVGs remain unchanged. This replaces the former 80 × 80 raster whose mark occupied only 40 × 40 pixels and required a 27-point image box.

Regenerate the Codex menu raster with librsvg and ImageMagick:

```sh
rsvg-convert -w 160 -h 160 -o /tmp/meterluma-codex-full.png src/assets/providers/codex-on-light.svg
magick /tmp/meterluma-codex-full.png -trim +repage PNG32:src-tauri/icons/providers/codex.png
```
