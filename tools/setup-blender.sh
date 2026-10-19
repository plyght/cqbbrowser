#!/bin/bash
# Installs Blender 4.2 LTS (headless use: `blender -b --python script.py`) into ~/tools and links it on PATH.
# Cloud containers are ephemeral, so run this at the start of a session that needs the Blender asset pipelines.
set -e
V=4.2.3
D="$HOME/tools/blender-$V-linux-x64"
if [ ! -x "$D/blender" ]; then
  mkdir -p "$HOME/tools" && cd "$HOME/tools"
  curl -sS -L -o blender.tar.xz "https://download.blender.org/release/Blender4.2/blender-$V-linux-x64.tar.xz"
  tar -xf blender.tar.xz && rm blender.tar.xz
fi
ln -sf "$D/blender" /usr/local/bin/blender 2>/dev/null || ln -sf "$D/blender" "$HOME/.local/bin/blender"
blender --version | head -1
