#!/bin/sh
# Regenerate docs/assets/demo.mp4 from a fresh terminal recording.
#
# Prerequisites: Node 22+, tmux, asciinema, ffmpeg, gifsicle, Chromium, and
# agg (https://github.com/asciinema/agg/releases - put the binary on PATH).
# Telemetry and update checks are off; the composition loads only local assets.
set -eu
cd "$(dirname "$0")/.."

AGG_THEME="0a0a0a,eeeeee,0a0a0a,e06c75,7fd88f,f5a742,5c9cf5,6272a4,56b6c2,808080,e06c75,7fd88f,f5a742,5c9cf5,6272a4,56b6c2,eeeeee,ffffff"

# 1. record a real TUI session into docs/assets/demo.cast
bun run demo

# 2. cast -> GIF; the idle limit collapses dead waits (slow tool runs, the
#    post-tool context pass) to one second each
agg --font-size 24 --line-height 1.35 --fps-cap 30 --idle-time-limit 1 \
  --last-frame-duration 2 --theme "$AGG_THEME" \
  docs/assets/demo.cast demo-terminal.gif

# 3. GIF -> H.264 clip. ffmpeg's GIF decoder drops agg's delta frames, so
#    coalesce to self-contained PNGs and drive ffmpeg from a timed concat list
gifsicle --colors 255 demo-terminal.gif -o demo-terminal-255.gif
gifsicle -U -O0 demo-terminal-255.gif -o demo-terminal-u.gif
rm -rf demo-frames
mkdir demo-frames
convert -coalesce demo-terminal-u.gif demo-frames/f_%03d.png
identify -format '%T\n' demo-terminal-u.gif > demo-frames/delays.txt
node - <<'EOF'
const fs = require('fs');
const delays = fs.readFileSync('demo-frames/delays.txt', 'utf8').trim().split('\n').map(Number);
let list = 'ffconcat version 1.0\n';
delays.forEach((cs, i) => {
  list += `file f_${String(i).padStart(3, '0')}.png\nduration ${cs / 100}\n`;
});
list += `file f_${String(delays.length - 1).padStart(3, '0')}.png\n`;
fs.writeFileSync('demo-frames/concat.txt', list);
console.log(`concat list: ${delays.length} frames, ${(delays.reduce((a, b) => a + b, 0) / 100).toFixed(2)}s`);
EOF
ffmpeg -y -loglevel error -f concat -safe 0 -i demo-frames/concat.txt \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30" \
  -movflags +faststart -pix_fmt yuv420p -c:v libx264 -crf 18 \
  demo/assets/terminal.mp4
rm -rf demo-terminal.gif demo-terminal-255.gif demo-terminal-u.gif demo-frames

# 4. compose and render the final video
HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 DO_NOT_TRACK=1 \
HYPERFRAMES_BROWSER_PATH="${HYPERFRAMES_BROWSER_PATH:-$(command -v chromium || command -v chromium-browser || command -v google-chrome)}" \
  npx --yes hyperframes@0.8.191 render demo \
  --output docs/assets/demo.mp4 --fps 30 --quality high \
  --workers 1 --low-memory-mode --video-frame-format png

# 5. poster frame from the title card
ffmpeg -y -loglevel error -ss 1 -i docs/assets/demo.mp4 -frames:v 1 -q:v 3 docs/assets/demo-poster.jpg
