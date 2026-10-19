#!/bin/bash
# Build the game and stage it for the Claude artifact host: webm-only audio (the host has no .m4a),
# no sourcemaps/bench, models renamed .glb → .glb.wasm (the host serves no .glb), and a skeleton-free index.html.
set -e
cd /home/user/cqbbrowser
bun run build >/dev/null
A="${1:?usage: tools/package-artifact.sh <out-dir>}"
find "$A" -mindepth 1 ! -name index.html -delete 2>/dev/null || true
cd dist
find . -type f ! -name "*.map" ! -name "*.m4a" ! -name "bench*" ! -name index.html | while read f; do mkdir -p "$A/$(dirname "$f")"; cp "$f" "$A/$f"; done
cd "$A"
# The artifact host doesn't serve .glb: ship models as .glb.wasm (binary type the host serves) (GLTFLoader sniffs the binary magic) and
# rewrite the references in the built JS.
find assets -name "*.glb" | while read g; do mv "$g" "$g.wasm"; done
for j in assets/*.js; do sed -i 's/\.glb\([\x27"`]\)/.glb.wasm\1/g' "$j"; done
JS=$(ls assets/main-*.js); CSS=$(ls assets/main-*.css)
cat > index.html <<HTML
<title>SHORTBARREL</title>
<meta name="theme-color" content="#2b2c20" />
<link rel="icon" type="image/svg+xml" href="./brand/favicon.svg" />
<link rel="stylesheet" href="./$CSS" />
<style>
  :root { color-scheme: dark; padding: 0 !important; }
  html, body { height: 100%; margin: 0; background: #000; overflow: hidden; }
</style>
<canvas id="game"></canvas>
<div id="ui"></div>
<script type="module" src="./$JS"></script>
HTML
ls assets/*.js assets/*.css
