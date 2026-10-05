"""Resumable render: finds the frames of a sequence that are missing or unreadable (a restart can leave a
half-written PNG) and renders only those, in contiguous ranges, with scripts/render-v13.sh range.

  python3 scripts/render-resume.py FinalV8 out/v13_frames 0-3564 [concurrency]
"""
import os
import subprocess
import sys

from PIL import Image

comp, d, rng = sys.argv[1], sys.argv[2], sys.argv[3]
conc = sys.argv[4] if len(sys.argv) > 4 else "4"
a, b = map(int, rng.split("-"))
os.makedirs(d, exist_ok=True)


def ok(i):
    p = os.path.join(d, f"element-{i:04d}.png")
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        return False
    try:
        with Image.open(p) as im:
            im.load()
        return im.size == (1080, 1920)
    except Exception:
        return False


missing = [i for i in range(a, b + 1) if not ok(i)]
runs, s = [], None
for i in missing:
    if s is None:
        s = p = i
    elif i == p + 1:
        p = i
    else:
        runs.append((s, p))
        s = p = i
if s is not None:
    runs.append((s, p))
print(f"{comp}: {len(missing)} frames to render in {len(runs)} ranges", flush=True)
for s, e in runs:
    subprocess.run(["bash", "scripts/render-v13.sh", "range", comp, d, f"{s}-{e}", conc], check=True)
print("complete" if all(ok(i) for i in range(a, b + 1)) else "INCOMPLETE")
