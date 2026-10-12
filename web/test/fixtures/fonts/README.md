# Font metadata measurements

`metadata-served.json` records read-only Google CSS and binary requests for Orbitron 400–900 and 400/700, Roboto 100–900, and Noto Sans JP 400/700. Each asset has its source URL, byte length, SHA-256 and metadata profile. Profiles give name IDs 1/2/16/17 (null means absent), table presence, selected family/style, fvar axes and every named instance. Shared profiles avoid repeating identical subset metadata; no font binaries are committed.

The Chrome request uses Chrome 155's browser user agent; the non-browser request uses `Mozilla/5.0`. The latter returned static TTF faces, matching the font author's description of game delivery. Both user agents and each CSS rule's source/weight are recorded. Native .NET and the published browser-WASM export independently returned identical metadata for all 151 distinct files.

The original unmodified fvar family names match Orbitron and Roboto's static TTFs. Noto Sans JP's 124 browser subsets instead carry ID1 `Noto Sans JP Thin`, no ID16, ID17 `Thin`, and a default wght of 100: raw 400/700 aliases include the unwanted default-style suffix. This exposed the same issue in other families.

The follow-up on 2026-10-11 used the same two user agents and read-only GETs for **eight more variable families at 400;700**. One representative (the last CSS rule) per weight descriptor was read, deduplicated by exact URL: eight WOFF2 files and sixteen static TTFs, **24 additional files inspected in native .NET only**. Follow-up requests record these inspected rules and the total CSS rule/file counts; their other subsets were not decoded. Original 151-file browser-WASM results remain separate.

Page-variable family derivation uses the font alone: ID16 wins. Otherwise the default style is ID17, then the named instance matching **all** fvar axis defaults, then ID2. A non-Regular style or non-400 default wght requires ID1 to end with a space plus that exact non-Regular style; removing that suffix must leave a nonempty family. Ambiguous metadata fails with a stated cause, readable fallback and unchanged export. Regular defaults retain their family. Static files and local imports retain their metadata names. No family whitelist, CSS-derived name, or weight-to-style guess is used.

| Family | Browser default wght / style | Family route | Compared aliases | Result |
| --- | --- | --- | --- | --- |
| Orbitron | 400 / Regular | unchanged | six at 400..900; two at 400;700 | exact |
| Roboto | 400 / Regular | unchanged | nine at 100..900 | exact |
| Noto Sans JP | 100 / Thin | default-style suffix | Noto Sans JP; Noto Sans JP Bold | exact after derivation |
| Noto Sans SC | 100 / Thin | default-style suffix | Noto Sans SC; Noto Sans SC Bold | exact after derivation |
| Noto Serif JP | 200 / ExtraLight | default-style suffix | Noto Serif JP; Noto Serif JP Bold | exact after derivation |
| Noto Sans TC | 100 / Thin | default-style suffix | Noto Sans TC; Noto Sans TC Bold | exact after derivation |
| Noto Serif SC | 200 / ExtraLight | default-style suffix | Noto Serif SC; Noto Serif SC Bold | exact after derivation |
| Noto Sans KR | 100 / Thin | default-style suffix | Noto Sans KR; Noto Sans KR Bold | exact after derivation |
| Montserrat | 100 / Thin | default-style suffix | Montserrat; Montserrat Bold | exact after derivation |
| Oswald | 400 / Regular | unchanged | Oswald; Oswald Bold | exact |
| Open Sans | 400 / Regular | unchanged | Open Sans; Open Sans Bold | exact |

All eight new families match; six exercise non-Regular defaults. Including the original profiles, all twelve requested-range comparisons match after derivation. JSON preserves the raw mismatches separately from derived results. Offline registry tests consume the recorded name IDs, axes and instances and compare registration directly against the static TTF names. These measurements establish the sampled naming rule, not every Google family or uninspected subset. The default-instance interpretation follows the [OpenType fvar specification](https://learn.microsoft.com/en-us/typography/opentype/spec/fvar#instancerecord).

The browser-WASM runtime pack includes native Brotli but its managed Brotli assembly throws `IOCompressionBrotli_PlatformNotSupported`. The reader therefore calls the already linked native decoder's public streaming API in browser-WASM, using the managed API on desktop. No decoder dependency or glyph reconstruction was added. Source: [runtime project](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.IO.Compression.Brotli/src/System.IO.Compression.Brotli.csproj), [Brotli C API](https://github.com/google/brotli/blob/master/c/include/brotli/decode.h).

After a fresh publish and `npm run precore`, `node test/fontMetadata.wasm.mjs` checks the published runtime under Node. It reads synthetic SFNT/WOFF2, malformed Brotli and directory lengths, and an advisory huge size; a valid 160 MiB name table reaches the external memory budget. It also exits an independent metadata runtime and terminates an unresponsive worker at 5000 ms while the real chip continues ticks/frames with its memory intact. These test-only failures require no fault-injection API in the application. Linear WASM memory is monotonic, so the recorded post-job size is the runtime's allocated high-water mark, not a GC-live or browser-process memory measurement.

No browser surface was available for this measurement. Real-browser startup, abort/watchdog behavior, selected-axis rendering and merged UI cancellation remain integration acceptance checks. The metadata caller takes an optional AbortSignal; abort requests when their link or project departs, and handle `cancelled` without registration. Local-file suggestion callers migrate to the same asynchronous `readFontMetadata` interface in the registry work.

`metadata-axes-served.json` records a follow-up Chrome-agent CSS/representative WOFF2 GET for `Roboto:wdth,wght@75..100,100..900`, read in native .NET only. Requesting both axes retains the width table: wght default 400, wdth default 100, nine named instances at wdth 100 and nine Condensed instances at wdth 75. The offline registry test passes this recorded metadata to a weight/style-only group, which does not select width, and verifies only the nine default-width aliases and explicit wdth 100 descriptors. Expected aliases come from the original weight-only Roboto static TTF comparison. The wider source query measures the table; it does not assert that its CSS width range is supported by the page-group interface. No binary is committed or new WASM/rendering result claimed.
