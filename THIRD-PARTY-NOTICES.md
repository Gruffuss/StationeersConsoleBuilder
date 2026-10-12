# Third-party notices

VectorBuilder is released under the MIT License (see `LICENSE`). The site and this repository also contain the third-party
components below, each under its own licence. Each entry says what ships and where, and gives its licence text or a link
to it, taken from the component's own files. The site serves this file as `THIRD-PARTY-NOTICES.txt`.

The MIT License text that several entries below refer to, after their own copyright line:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## The preview core (`_framework/` on the site)

### Lua-CSharp

The Lua 5.2 interpreter the preview and the export check run. Source: https://github.com/nuskey8/Lua-CSharp, vendored at
`core/vendor/lua-csharp` (tag v0.5.6, commit d9fb336); compiled into `_framework/Lua.*.wasm`.

MIT License. Copyright (c) 2025 Yusuke Nakada. Licence text: the MIT License text above (its `LICENSE` file).

### ScriptedScreens Vector

The vector mod whose C# scene core the preview runs. Source: https://github.com/Gruffuss/scripted-screens-vector,
vendored at `core/vendor/vector` (tag v0.11.118, commit 1f877d7); its sources are compiled into
`_framework/VectorBuilder.Core.*.wasm`, and its example scripts ship as `examples/*.lua`.

MIT License. Copyright (c) 2026 Gruffuss. Licence text: the MIT License text above (its `LICENSE` file).

### The .NET runtime

The .NET 10 runtime for the browser (`Microsoft.NETCore.App.Runtime.Mono.browser-wasm`, version 10.0.12 when this file was
written; a build ships the version its .NET SDK installs): `_framework/dotnet.js`, `dotnet.runtime.*.js`,
`dotnet.native.*.js`, `dotnet.native.*.wasm` and the `System.*.wasm` libraries.

MIT License. Copyright (c) .NET Foundation and Contributors. Licence text: the MIT License text above (the runtime pack's
`LICENSE.TXT`).

The runtime includes third-party code of its own (among them Mono, zlib-ng, Brotli and libunwind-based code), listed with
their licences in the runtime pack's `THIRD-PARTY-NOTICES.TXT`, identical to
https://github.com/dotnet/runtime/blob/v10.0.12/THIRD-PARTY-NOTICES.TXT.

### Emscripten

The .NET WebAssembly build tools (Emscripten 3.1.56) generate `_framework/dotnet.native.*.js` and link Emscripten's system
libraries into `_framework/dotnet.native.*.wasm`.

Emscripten is available under the MIT License and the University of Illinois/NCSA Open Source License. Copyright (c)
2010-2014 Emscripten authors, see AUTHORS file. Licence text: https://github.com/emscripten-core/emscripten/blob/3.1.56/LICENSE
(identical to the copy the build tools ship).

Emscripten's system libraries, with their own licences (the build output does not record which of them the link
includes):
- musl libc: MIT License, Copyright © 2005-2020 Rich Felker, et al.;
  https://github.com/emscripten-core/emscripten/blob/3.1.56/system/lib/libc/musl/COPYRIGHT
- LLVM compiler-rt, libc++, libc++abi and libunwind: Apache License v2.0 with LLVM Exceptions;
  https://github.com/emscripten-core/emscripten/blob/3.1.56/system/lib/compiler-rt/LICENSE.TXT (the same licence is in
  `system/lib/libcxx/`, `system/lib/libcxxabi/` and `system/lib/libunwind/`)
- mimalloc: MIT License, Copyright (c) 2018-2021 Microsoft Corporation, Daan Leijen;
  https://github.com/emscripten-core/emscripten/blob/3.1.56/system/lib/mimalloc/LICENSE
- dlmalloc: released to the public domain by Doug Lea (CC0 1.0), as its source file states;
  https://github.com/emscripten-core/emscripten/blob/3.1.56/system/lib/dlmalloc.c

## Fonts (`fonts/` on the site)

All under the SIL Open Font License, Version 1.1. Each family's licence ships beside its faces, on the site and in
`web/public/fonts/`:
- Barlow (18 faces): Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow). Licence text:
  `fonts/OFL-Barlow.txt`.
- Barlow Condensed (18 faces): Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow). Licence text:
  `fonts/OFL-BarlowCondensed.txt`.
- Liberation Sans Regular: Digitized data copyright (c) 2010 Google Corporation, with Reserved Font Arimo, Tinos and
  Cousine; Copyright (c) 2012 Red Hat, Inc., with Reserved Font Name Liberation. Licence text:
  `fonts/OFL-LiberationSans.txt`.
- JetBrains Mono (Regular and Bold, the editor's code face): Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono). Licence text:
  `fonts/OFL-JetBrainsMono.txt`.

## npm packages bundled into the site's scripts (`assets/` on the site)

The packages the site's code depends on at run time, at the versions `web/package-lock.json` locks. Each is under the MIT
License (its `license` field and its `LICENSE` file, the MIT License text above after the copyright line given here):

| Package | Copyright |
|---|---|
| @codemirror/commands 6.11.1 | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| @codemirror/language 6.12.4 | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| @codemirror/lint 6.9.7 | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| @codemirror/state 6.7.6 | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| @codemirror/view 6.43.13 | Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| @lezer/common 1.5.3 | Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| @lezer/highlight 1.2.5 | Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| @lezer/lr 1.4.10 | Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| @marijn/find-cluster-break 1.0.4 | Copyright (C) 2024 by Marijn Haverbeke <marijn@haverbeke.berlin> |
| crelt 1.0.7 | Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin> |
| style-mod 4.1.4 | Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| w3c-keyname 2.2.8 | Copyright (C) 2016 by Marijn Haverbeke <marijn@haverbeke.berlin> and others |
| react 19.3.0 | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom 19.3.0 | Copyright (c) Meta Platforms, Inc. and affiliates. |
| scheduler 0.28.0 | Copyright (c) Meta Platforms, Inc. and affiliates. |

The build tools also place small pieces of their own code in the site's scripts: Vite's module-preload polyfill and
preload helper, and Rolldown's CommonJS module wrapper.
- Vite 8.3.2: MIT License, Copyright (c) 2019-present, VoidZero Inc. and Vite contributors; licence text in the
  package's `LICENSE.md` (https://github.com/vitejs/vite/blob/main/LICENSE).
- Rolldown 1.2.12: MIT License, Copyright (c) 2024-present VoidZero Inc. & Contributors; licence text in the package's
  `LICENSE` (https://github.com/rolldown/rolldown/blob/main/LICENSE).
