#!/usr/bin/env python3
"""Build the inline media map for the offline preview (scripts/build-preview.mjs).

The preview is one HTML file with no network behind it, so every exercise image has
to travel inside it as a data: URI. The full media tree is ~138 MB, which is an
order of magnitude past what that file can weigh, so this makes two different trades:

  · stills  — all 1324, re-encoded smaller. They carry the library, which is most of
              what the app looks like, and they are cheap.
  · GIFs    — only the exercises the demo profile actually trains, at full size, so
              the workout flow shows the real animations. Every other exercise maps
              its GIF to its own still: tapping into a random exercise shows a frozen
              frame rather than a broken image.

Writes a classic (non-module) script defining globalThis.__OG_MEDIA__, which
frontend/src/lib/exercises.js consults before falling back to a URL base.

Usage: preview-media.py <media-dir> <out.js> <id>[,<id>...]
"""
import base64
import io
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("preview-media.py needs Pillow: pip install pillow")

# Source stills are 180x180. 140 px still covers a list thumbnail at 2x and holds up
# as a large frozen frame, at ~2 KB apiece — the whole set lands around 3.8 MB once
# base64 has taken its third.
STILL_WIDTH = 140
STILL_QUALITY = 62


def data_uri(mime: str, raw: bytes) -> str:
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def shrink(path: str) -> bytes:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if w > STILL_WIDTH:
        im = im.resize((STILL_WIDTH, max(1, round(h * STILL_WIDTH / w))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=STILL_QUALITY, optimize=True)
    return buf.getvalue()


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit(__doc__.strip().splitlines()[-1])
    media_dir, out_path, ids_arg = sys.argv[1:4]
    animated_ids = {i for i in ids_arg.split(",") if i}

    img_dir = os.path.join(media_dir, "img")
    gif_dir = os.path.join(media_dir, "gif")
    for d in (img_dir, gif_dir):
        if not os.path.isdir(d):
            sys.exit(f"missing {d} — run `docker compose up media` or scripts/fetch-media.sh first")

    # Media filenames are "<exercise id>-<hash>.<ext>", which is exactly what the
    # exercise database stores in its img/gif fields, so the map can be keyed off the
    # directory listing without parsing the 890 KB dataset.
    stills = {f: os.path.join(img_dir, f) for f in os.listdir(img_dir) if f.endswith(".jpg")}
    gifs = {f: os.path.join(gif_dir, f) for f in os.listdir(gif_dir) if f.endswith(".gif")}

    media, still_bytes, gif_bytes = {}, 0, 0
    for name in sorted(stills):
        raw = shrink(stills[name])
        still_bytes += len(raw)
        media[name] = data_uri("image/jpeg", raw)

    missing = []
    for name in sorted(gifs):
        ex_id = name.split("-", 1)[0]
        if ex_id in animated_ids:
            with open(gifs[name], "rb") as fh:
                raw = fh.read()
            gif_bytes += len(raw)
            media[name] = data_uri("image/gif", raw)
        else:
            still = media.get(name[: -len(".gif")] + ".jpg")
            if still:
                media[name] = still
            else:
                missing.append(name)

    payload = "globalThis.__OG_MEDIA__=%s;\n" % json.dumps(media, separators=(",", ":"))
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(payload)

    print(
        f"  media map: {len(stills)} stills ({still_bytes / 1e6:.1f} MB) + "
        f"{len(animated_ids)} animations ({gif_bytes / 1e6:.1f} MB) "
        f"-> {len(payload) / 1e6:.1f} MB inline"
    )
    if missing:
        print(f"  warning: {len(missing)} GIFs had no still to fall back to", file=sys.stderr)


if __name__ == "__main__":
    main()
