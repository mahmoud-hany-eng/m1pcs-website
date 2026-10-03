"""Drop Grady (Higgsfield preset) into the finished edit.

The v11 edit is timed to a timing model of the script (vo/lines/model_fenrir — never a deliverable
voice). Generate Grady in Higgsfield, one file per line (14 files, the order and names of
vo/lines.json / vo/script_final.md: q, show, starts, tell, turn, send, confirm, source, rest, real,
next, bsr, cta, visit — or numbered 01…14 in that order; wav or mp3), then:

  python3 vo/grady.py <folder>            # place: no picture change (minutes)
      1. converts the files to 48 kHz mono → vo/lines/grady/<id>.wav
      2. finds each sync word in Grady's read: DTW of each spoken prefix against his line
         (vo/align.py) checked against an ASR scan (vo/onsets.py) → vo/lines/grady/onsets.json
      3. places every line so its sync words land on the picture's cues (least squares, never
         overlapping the previous line), writes public/audio/vo8.wav
      4. remixes (audio/score_v8.py: music ducked under Grady, SFX around him) and swaps the new mix
         into the delivered VO videos (video stream copied, nothing re-rendered):
         out/final/M1_v11_Grady_VO_MASTER_ProRes422HQ.mov / _Instagram.mp4
      5. reports, per line, how far each sync word lands from its picture cue and whether the line
         fits its slot.

  If a line does not fit or a word lands > 0.2 s from its cue, re-time the PICTURE to Grady's real
  read instead (captures + render, ~1 h):   bash scripts/rebuild-for-grady.sh
"""
import glob
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(HERE, "lines", "grady")
SR = 48000
LINES = json.load(open(os.path.join(HERE, "lines.json")))
IDS = [l["id"] for l in LINES]
SYNC = {"q": ["Qatar", "build", "PC"], "show": ["properly"], "starts": ["starts", "you"], "tell": ["play", "performance", "budget", "style"],
        "turn": ["custom"], "send": ["send", "WhatsApp"], "confirm": ["price", "availability", "deposit", "order"],
        "source": ["source", "us", "Qatar"], "rest": ["rest"], "real": ["real", "pcs"], "next": ["next"], "bsr": ["build", "set", "ready"],
        "cta": ["ready", "to", "yours"], "visit": ["mone"]}


def collect(folder):
    os.makedirs(OUT, exist_ok=True)
    files = sorted(glob.glob(os.path.join(folder, "*.wav")) + glob.glob(os.path.join(folder, "*.mp3")) + glob.glob(os.path.join(folder, "*.m4a")))
    by_name = {os.path.splitext(os.path.basename(f))[0].lower(): f for f in files}
    for k, lid in enumerate(IDS, 1):
        src = by_name.get(lid.lower()) or by_name.get(f"{k:02d}") or by_name.get(str(k))
        if not src:
            sys.exit(f"missing Grady line '{lid}' (expected {lid}.wav or {k:02d}.wav in {folder})")
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s24le", os.path.join(OUT, lid + ".wav")], check=True)
    print("collected", len(IDS), "lines →", OUT)


def find_onsets():
    subprocess.run([sys.executable, os.path.join(HERE, "align.py"), "am_fenrir", OUT], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([sys.executable, os.path.join(HERE, "onsets.py"), OUT], check=True, stdout=subprocess.DEVNULL)
    dtw = json.load(open(os.path.join(OUT, "align.json")))
    asr = json.load(open(os.path.join(OUT, "onsets.json")))
    out, flags = {}, []
    for lid in IDS:
        out[lid] = {}
        for w, t in dtw[lid].items():
            a = asr.get(lid, {}).get(w, t)
            # the ASR scan tends to land slightly INSIDE a word; DTW is the primary estimate
            out[lid][w] = t
            if abs(a - t) > 0.25:
                flags.append(f"{lid}:{w} DTW {t:.2f} vs ASR {a:.2f}")
    json.dump(out, open(os.path.join(OUT, "onsets.json"), "w"), indent=1)
    json.dump(asr, open(os.path.join(OUT, "onsets_asr.json"), "w"), indent=1)
    return out, flags


def place(onsets):
    V = json.load(open(os.path.join(ROOT, "timeline.json")))["v8"]
    VO = V["vo"]
    track = np.zeros(int((V["duration"] + 0.5) * SR))
    report, prev_end = [], 0.0
    for lid in sorted(IDS, key=lambda i: VO[i]["start"]):
        x, sr = sf.read(os.path.join(OUT, lid + ".wav"))
        idx = np.where(np.abs(x) > 0.01 * max(1e-6, np.abs(x).max()) / 0.3)[0]
        a, b = idx[0] / SR, idx[-1] / SR
        cues = [(VO[lid]["kw"][w], onsets[lid][w]) for w in SYNC[lid] if w in VO[lid]["kw"] and w in onsets[lid]]
        # file offset so that  file_time + offset ≈ cue_time  for the sync words (least squares)
        off = float(np.mean([c - o for c, o in cues])) if cues else VO[lid]["start"] - a
        off = max(off, prev_end + 0.12 - a)  # never on top of the previous line
        st = max(0, int((off + a - 0.03) * SR))
        seg = x[int(max(0, a - 0.03) * SR) : int((b + 0.08) * SR)]
        track[st : st + len(seg)] += seg[: max(0, len(track) - st)]
        prev_end = off + b
        nxt = [VO[j]["start"] for j in IDS if VO[j]["start"] > VO[lid]["start"]]
        slot_end = min(nxt) - 0.1 if nxt else V["duration"] - 1.0
        errs = {w: round(off + o - c, 3) for (c, o), w in zip(cues, [w for w in SYNC[lid] if w in VO[lid]["kw"] and w in onsets[lid]])}
        report.append((lid, round(off + a, 2), round(off + b, 2), round(slot_end, 2), errs))
    track = track[: int(V["duration"] * SR)]
    sf.write(os.path.join(ROOT, "public", "audio", "vo8.wav"), track, SR, subtype="PCM_24")
    return report


def remux():
    subprocess.run([sys.executable, os.path.join(ROOT, "audio", "score_v8.py")], check=True)
    D = os.path.join(ROOT, "out", "final")
    mix = os.path.join(ROOT, "public", "audio", "final8_vo.wav")
    for kind, ext, acodec in [("MASTER_ProRes422HQ", "mov", ["-c:a", "pcm_s24le"]), ("Instagram", "mp4", ["-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart"])]:
        src = os.path.join(D, f"M1_v11_VO_edit_awaiting_Grady_{kind}.{ext}")
        dst = os.path.join(D, f"M1_v11_Grady_VO_{kind}.{ext}")
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-i", mix, "-map", "0:v", "-map", "1:a", "-c:v", "copy", *acodec, "-ar", "48000", "-shortest", dst], check=True)
        print("wrote", dst)
    shutil.copy(os.path.join(ROOT, "public", "audio", "vo8.wav"), os.path.join(D, "M1_v11_Grady_Voiceover_clean.wav"))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    collect(sys.argv[1])
    onsets, flags = find_onsets()
    rep = place(onsets)
    worst = 0.0
    print("\nline      in      out    slot-end  sync error per word (s, + = late)")
    for lid, i, o, se, errs in rep:
        worst = max([worst] + [abs(v) for v in errs.values()])
        print(f"{lid:8s} {i:6.2f}  {o:6.2f}  {se:6.2f}{'  ← OVERRUNS ITS SLOT' if o > se else ''}  {errs}")
    for f in flags:
        print("  check by ear:", f)
    if "--no-remux" not in sys.argv:
        remux()
    print(f"\nworst sync error {worst:.2f} s —", "OK to deliver." if worst <= 0.2 and all(o <= se for _, _, o, se, _ in rep)
          else "re-time the picture to Grady's read: bash scripts/rebuild-for-grady.sh")
