---
cadmpeg-ts: prerelease
---

The WebAssembly backend now converts STEP and CADIR input straight to OpenUSD and the other native writers, as the native addon does, instead of round-tripping through STEP first. A Tau cube written as OpenUSD was 14,819 bytes with 15 losses on the native addon and 14,680 bytes with 22 losses on WebAssembly; both now write the same bytes and report the same losses.

Where a WebAssembly writer module cannot read the source, such as SolidWorks to OpenUSD, the native addon now crosses as STEP bytes too, so both backends take the same route; its output for those routes changes accordingly. Some inputs, SolidWorks parts among them, still differ across backends by an ulp in a few coordinates, a known issue in the pinned cadmpeg listed in `compatibility.md`.
