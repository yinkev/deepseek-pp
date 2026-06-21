# Grok-Style Working Loop Visual

This folder contains a shareable dark D2 animation of the current Oracle workflow.

## Files

- `working-loop.d2` - source diagram with step boards.
- `working-loop.svg` - animated SVG rendered by user-local D2.
- `working-loop.gif` - animated GIF rendered by user-local D2, when supported locally.

## View

Open `working-loop.svg` in a browser for the clearest animated version.

## Regenerate

Run from the repo root:

```sh
/Users/kyin/.local/bin/d2 --theme=201 --animate-interval 1300 --pad 40 --scale 0.5 .ai-visuals/export/working-loop.d2 .ai-visuals/export/working-loop.svg
/Users/kyin/.local/bin/d2 --theme=201 --animate-interval 1300 --pad 40 --scale 0.5 .ai-visuals/export/working-loop.d2 .ai-visuals/export/working-loop.gif
```

This intentionally uses `/Users/kyin/.local/bin/d2` v0.7.1 and does not depend on `/opt/homebrew/bin/d2`, Homebrew ffmpeg, or Homebrew ImageMagick.
