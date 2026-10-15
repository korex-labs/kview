# Deferred frontend dependencies

Keep these boundaries semantic rather than moving eager code into named chunks:

- The shell statically imports the search drawer adapter, but its Namespace and
  Helm implementations use module-scope `React.lazy`. The fixed-resource
  dispatcher already defers concrete drawers. Keep shared helpers and re-exports
  from importing concrete drawers back into the shell.
- `ActivityTabs` renders `DeferredTerminalSessionView` only for opened sessions.
  That boundary defers xterm, the fit addon, and terminal CSS. Opened session
  instances stay mounted under their existing session keys when hidden; switching
  tabs or closing the activity panel changes visibility/focus, not WebSocket
  lifetime or scrollback. A delayed chunk must not focus a now-hidden terminal.
- All syntax consumers use `shared/SyntaxHighlight`. It imports the light engine
  only when rendering a supported language, then loads that specific grammar.
  `highlightSyntax` deep-imports `react-syntax-highlighter/dist/esm/prism-light`,
  individual `dist/esm/languages/prism/<language>` modules, and individual
  `one-dark`, `one-light`, and `prism` theme modules. Do not use the package root,
  language/style barrels, `refractor/all`, or full Prism.

## Supported syntax

Canonical languages: `yaml`, `json`, `toml`, `markup`, `ini`, `bash`, `sql`,
`javascript`, `typescript`, `python`, `ruby`, `go`, `css`, `hcl`, `markdown`,
`php`, `java`, `csv`. Grammar modules may bring their declared dependencies
(for example JavaScript/clike), but not the all-language registry.

Aliases are explicitly recorded in `shared/syntaxLanguages.ts`: `yml` → YAML;
`xml`, `html`, `svg`, `mathml`, `ssml`, `atom`, `rss` → markup; `sh`, `shell` → bash;
`js` → JavaScript; `ts` → TypeScript; `py` → Python; `rb` → Ruby;
`md` → Markdown; `webmanifest` → JSON. Matching trims whitespace and ignores case.

Unknown language fences/custom-command languages, `text`, and `plaintext` render
escaped plain source rather than triggering an arbitrary import or guessing a
language. Loading and chunk-error fallbacks remain readable, including editor
highlight overlays. A failed highlighter load remains plain for that language
until page reload. Read-only YAML keeps its existing custom folding, line numbers,
copy source, and CSS colors without loading Prism. JSON/YAML editors retain app
light/dark palettes; pod logs retain their original Prism palette.

## Focused regression checks

Run inside the repository's pinned, resource-capped container (2 CPUs / 4 GiB):

```sh
npm run test -- src/deferredImports.test.ts src/components/shared/syntaxLanguages.test.ts src/components/shared/highlightSyntax.test.ts
npm run test:full -- src/components/shared/SyntaxHighlight.test.tsx src/components/activity/DeferredTerminalSessionView.test.tsx src/components/activity/TerminalSessionView.test.tsx src/components/search/DataplaneSearchDrawer.test.tsx src/components/resources/customresources/CustomResourceDrawer.test.tsx
npm run typecheck
npm run lint
```

`deferredImports.test.ts` follows static runtime imports and re-exports from the
shell and syntax consumers, so an eager helper/barrel import cannot silently
undo these boundaries. It is a source-level guard, not a bundle-size measurement.
Measure actual initial/transitive assets after the parent's production build;
compare against `.cache/frontend-performance/before.json`. Manually check drawer
navigation, YAML folding/copy/editing, Help fences, and terminal focus/scrollback
across terminal tabs, activity tabs, and panel hide/show. No browser automation or
full mounted suite is required for this tranche.
