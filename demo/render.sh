#!/bin/sh
# Regenerate docs/assets/demo.mp4 from a fresh terminal recording.
#
# Prerequisites: Node 22+, tmux, ffmpeg, Chromium, and agg
# (https://github.com/asciinema/agg/releases - put the binary on PATH).
# Telemetry and update checks are off; the composition loads only local assets.
set -eu
cd "$(dirname "$0")/.."

AGG_THEME="0a0a0a,eeeeee,0a0a0a,e06c75,7fd88f,f5a742,5c9cf5,6272a4,56b6c2,808080,e06c75,7fd88f,f5a742,5c9cf5,6272a4,56b6c2,eeeeee,ffffff"

# 1. record a real TUI session into docs/assets/demo.cast
bun run demo

# 2. cast -> GIF -> terminal clip
agg --font-size 24 --line-height 1.35 --fps-cap 30 --last-frame-duration 2 \
  --theme "$AGG_THEME" docs/assets/demo.cast demo-terminal.gif
ffmpeg -y -loglevel error -i demo-terminal.gif \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -movflags +faststart -pix_fmt yuv420p -c:v libx264 -crf 18 demo/assets/terminal.mp4
rm -f demo-terminal.gif

# 3. compose and render the final video
HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 DO_NOT_TRACK=1 \
HYPERFRAMES_BROWSER_PATH="${HYPERFRAMES_BROWSER_PATH:-$(command -v chromium || command -v chromium-browser || command -v google-chrome)}" \
  npx --yes hyperframes@0.8.191 render demo \
  --output docs/assets/demo.mp4 --fps 30 --quality high \
  --workers 1 --low-memory-mode --video-frame-format png

# 4. poster frame from the title card
ffmpeg -y -loglevel error -ss 1 -i docs/assets/demo.mp4 -frames:v 1 -q:v 3 docs/assets/demo-poster.jpg
