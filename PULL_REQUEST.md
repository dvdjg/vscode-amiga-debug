# Pull Request: Profile fixes for WinUAE-DBG and source map robustness

## Resumen

Este PR corrige dos errores que impiden usar el **Frame Profiler** cuando:
- Se usa **WinUAE-DBG** (fork BartmanAbyss) en lugar del WinUAE upstream
- El perfil contiene PCs que no tienen entrada en el source map (Kickstart, código externo, etc.)

## Bug 1: `dmaLen mismatch (want 58, got 121)`

### Síntoma
```
Unable to start profiling: Error: <internal error> dmaLen mismatch (want 58, got 121)
```

### Causa
- La extensión esperaba un `dma_rec` de **58 bytes** (formato WinUAE upstream).
- **WinUAE-DBG** escribe una estructura `dma_rec` ampliada de **121 bytes** (`include/debug.h`): hpos, vpos, frame, tick, dhpos, agnus_evt, denise_evt, miscaddr, etc.

### Fix
**Archivo:** `src/backend/profile.ts`

- Se aceptan ambos formatos: `sizeofDmaRecLegacy = 58` y `sizeofDmaRecExtended = 121`.
- Se usan offsets distintos según el tamaño:
  - **Legacy (58):** reg=0, dat=2, size=10, addr=12, evt=16, type=29, extra=31, intlev=33
  - **Extended (121):** reg=28, dat=30, size=38, addr=40, evt=44, type=77, extra=79, intlev=81 (según `struct dma_rec` en WinUAE-DBG `include/debug.h`)

### Referencia
- WinUAE-DBG: `include/debug.h` líneas 252-284, `od-win32/barto_gdbserver.cpp` línea 1308

---

## Bug 2: `Cannot read properties of undefined (reading 'frames')`

### Síntoma
```
Unable to start profiling: TypeError: Cannot read properties of undefined (reading 'frames')
```

### Causa
- En `profileTimeFrame`, cuando el PC apunta a una dirección que **no está en el source map** (p. ej. Kickstart, memoria sin símbolos), `this.sourceMap.uniqueLines[this.sourceMap.lines[pc >> 1]]` devuelve `undefined`.
- El código accedía a `l.frames` sin comprobar si `l` existía.

### Fix
**Archivo:** `src/backend/profile.ts`, método `profileTimeFrame`

- Se valida el índice antes de usarlo.
- Si `l` es `undefined` o `l.frames` está vacío, se añade un frame `[Unknown]` en lugar de lanzar excepción.

```typescript
const lineIndex = pc >> 1;
const uniqueIndex = lineIndex >= 0 && lineIndex < this.sourceMap.lines.length ? this.sourceMap.lines[lineIndex] : undefined;
const l = uniqueIndex !== undefined ? this.sourceMap.uniqueLines[uniqueIndex] : undefined;
if (!l?.frames?.length) {
    callstack.frames.push({ func: '[Unknown]', file: '', line: 0 });
} else {
    // ... existing logic
}
```

---

## Verificación

- Compilación: `npm run compile`
- VSIX: `npx @vscode/vsce package`
- Probar profile con WinUAE-DBG y un ejecutable que genere DMA records en formato 121 bytes.
- Probar profile con PCs en Kickstart o fuera del .text.

---

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `src/backend/profile.ts` | Soporte dma_rec 58 y 121 bytes; guard para source map undefined |
