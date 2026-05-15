# WinUAE-DBG compatibility

Fork maintained for use with [WinUAE-DBG](https://github.com/BartmanAbyss/vscode-amiga-debug) profiling and the Amiga Debug VS Code extension.

## Screen tab (Graphics Debugger)

Patches in `src/client/screen.ts` and `src/client/debugger/screen.tsx`:

- **AGA palette**: initialize Denise color table from `agaColors` / custom registers before DMA replay (fixes grayscale or blank Screen view on profiles from WinUAE-DBG).
- **Timeline CRT sweep**: in **Live** mode, replay DMA only up to the current profiler time so scrubbing the timeline shows the frame being drawn; scanline overlay still uses the white crosshair.

Requires a matching WinUAE-DBG build that exports DMA via `export_dma_records_profile()` (227×313 grid from `dma_record_lines`, not the cyclic debug buffer).

## Build & install

```bash
npm install
npm run compile
```

Then install the VSIX or copy `dist/` into your extension folder, or use **Extension Development Host** (F5) from this repo.

Upstream: [BartmanAbyss/vscode-amiga-debug](https://github.com/BartmanAbyss/vscode-amiga-debug)
