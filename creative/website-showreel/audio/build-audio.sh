#!/usr/bin/env bash
# Procedural, commercially-safe score + sound design for the M1 showreel.
# Network access to royalty-free music libraries is blocked from this
# environment, so the whole track is synthesised deterministically with
# ffmpeg's audio filters: a sub-bass pad with a slow pumping tremolo
# (a restrained "premium modern electronic" pulse), soft filtered-noise
# whooshes at each scene transition, two UI click blips during the Build My
# PC interaction, and a two-note brand sting at the very end.
#
# Usage: build-audio.sh <total_seconds> <out.wav>
set -euo pipefail
DUR="${1:-30}"
OUT="${2:-audio/score-30.wav}"
mkdir -p "$(dirname "$OUT")"
T="/tmp/m1-audio-$$"
mkdir -p "$T"

# Scene-boundary fractions (must match src/constants.ts SCENES) scaled to DUR.
python3 - "$DUR" "$T" <<'PY'
import sys
dur = float(sys.argv[1]); t = sys.argv[2]
bounds = [0.0, 0.1, 7/30, 14/30, 0.6, 23/30, 0.9, 1.0]
with open(f"{t}/hits.txt", "w") as f:
    for b in bounds:
        f.write(f"{b*dur:.3f}\n")
with open(f"{t}/clicks.txt", "w") as f:
    f.write(f"{0.29*dur:.3f}\n{0.44*dur:.3f}\n")
PY

# ---- 1. Sub-bass pad with a slow pumping tremolo (the "pulse").
ffmpeg -y -v error -f lavfi -t "$DUR" -i \
  "sine=frequency=55:sample_rate=48000" -af \
  "tremolo=f=$(python3 -c "print(120/60/4)"):d=0.55,volume=0.42,lowpass=f=220" \
  "$T/pad.wav"

# ---- 2. A soft, wide upper layer for width (slightly detuned octave).
ffmpeg -y -v error -f lavfi -t "$DUR" -i "sine=frequency=110.5:sample_rate=48000" -af \
  "volume=0.14,lowpass=f=420" "$T/pad2.wav"

# ---- 3. Whoosh transitions: short filtered pink-noise swells at each scene boundary.
i=0
while read -r ts; do
  ffmpeg -y -v error -f lavfi -t 0.4 -i "anoisesrc=color=pink:duration=0.4" -af \
    "afade=t=in:d=0.06,afade=t=out:d=0.28,bandpass=f=1000:width_type=h:w=900,volume=0.55" \
    "$T/whoosh_$i.wav"
  i=$((i + 1))
done < "$T/hits.txt"

# ---- 4. UI click blips (pill / preference selection in the Build My PC scene).
i=0
while read -r ts; do
  ffmpeg -y -v error -f lavfi -t 0.09 -i "sine=frequency=1250:sample_rate=48000" -af \
    "afade=t=out:st=0.01:d=0.08,volume=0.4" \
    "$T/click_$i.wav"
  i=$((i + 1))
done < "$T/clicks.txt"

# ---- 5. Brand sting: two rising notes right at the very end.
STING_AT=$(python3 -c "print(round($DUR*0.982,3))")
ffmpeg -y -v error -f lavfi -t 0.5 -i "sine=frequency=660:sample_rate=48000" -af \
  "afade=t=out:st=0.12:d=0.32,volume=0.42" "$T/sting1.wav"
ffmpeg -y -v error -f lavfi -t 0.6 -i "sine=frequency=880:sample_rate=48000" -af \
  "afade=t=in:d=0.03,afade=t=out:st=0.25:d=0.32,volume=0.46" "$T/sting2.wav"

# ---- Build the amix filter graph: pad + pad2 always-on, everything else adelay'd in.
INPUTS=("$T/pad.wav" "$T/pad2.wav")
FILTERS=""
LABELS="[0:a][1:a]"
idx=2
n=0
while read -r ts; do
  MS=$(python3 -c "print(int(float(\"$ts\")*1000))")
  INPUTS+=("$T/whoosh_$n.wav")
  FILTERS+="[$idx:a]adelay=${MS}|${MS}[w$n];"
  LABELS+="[w$n]"
  idx=$((idx + 1)); n=$((n + 1))
done < "$T/hits.txt"
n=0
while read -r ts; do
  MS=$(python3 -c "print(int(float(\"$ts\")*1000))")
  INPUTS+=("$T/click_$n.wav")
  FILTERS+="[$idx:a]adelay=${MS}|${MS}[c$n];"
  LABELS+="[c$n]"
  idx=$((idx + 1)); n=$((n + 1))
done < "$T/clicks.txt"
STING_MS=$(python3 -c "print(int($STING_AT*1000))")
INPUTS+=("$T/sting1.wav" "$T/sting2.wav")
FILTERS+="[$idx:a]adelay=${STING_MS}|${STING_MS}[s1];"
LABELS+="[s1]"
idx=$((idx + 1))
STING2_MS=$(python3 -c "print(int(($STING_AT+0.22)*1000))")
FILTERS+="[$idx:a]adelay=${STING2_MS}|${STING2_MS}[s2];"
LABELS+="[s2]"
idx=$((idx + 1))

TOTAL_INPUTS=$idx
FILTERS+="${LABELS}amix=inputs=$((2 + $(wc -l < "$T/hits.txt") + $(wc -l < "$T/clicks.txt") + 2)):normalize=0,alimiter=limit=0.95,volume=2.6[out]"

INPUT_ARGS=()
for f in "${INPUTS[@]}"; do
  INPUT_ARGS+=(-i "$f")
done

ffmpeg -y -v error "${INPUT_ARGS[@]}" -filter_complex "$FILTERS" -map "[out]" -t "$DUR" -ar 48000 -ac 2 "$OUT"

rm -rf "$T"
echo "wrote $OUT"
