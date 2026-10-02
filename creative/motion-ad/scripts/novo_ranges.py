"""Frame ranges where Version B (no voiceover) differs from Version A — its extra kinetic copy
(src/v8/Final8.tsx: worldWords(!vo), M1 TAKES CARE OF THE REST.).
Padded generously; scripts/deliver-v10.sh verifies frames outside these ranges are identical."""
import json
V = json.load(open("timeline.json"))["v8"]
ST, Q, TP, CH, PT, FLY, VO = V["starts"], V["quote"], V["toPhone"], V["chat"], V["parts"], V["fly"], V["vo"]
W = [
    (ST["words"]["starts"] - 1.0, VO["tell"]["end"] + 0.6),  # AT M1, IT STARTS WITH YOU. / GAMES. … STYLE.
    (PT["rest"] - 1.3, PT["closer"][0] + 0.5),  # M1 TAKES CARE OF THE REST.
]
W.sort()
merged = []
for a, b in W:
    if merged and a <= merged[-1][1]:
        merged[-1][1] = max(merged[-1][1], b)
    else:
        merged.append([a, b])
last = round(V["duration"] * 60) - 1
print(" ".join(f"{max(0, int(a * 60))}-{min(last, int(b * 60) + 1)}" for a, b in merged))
