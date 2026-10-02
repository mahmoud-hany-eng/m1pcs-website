// Motion QA: samples the REAL motion functions used by the composition (not copies)
// at 60 fps (and 240 Hz for derivatives) and writes qa/out/curves.json for qa/plots.py.
import * as fs from "fs";
import { V } from "../src/v8/time";
import { halfPose, compressionPx, settledAt } from "../src/v8/Merge";
import { INTRO_D0 } from "../src/v8/Intro8";
import { END_D0 } from "../src/v8/End8";
import { BUILDS, galCam, place } from "../src/v8/Gallery8";
import { arrive } from "../src/v8/Kinetic";
import { camAt } from "../src/v8/Final8";

const I = V.intro, SG = V.sig, GA = V.gallery, CH = V.chat;
const step = 1 / 240;
const sample = (t0: number, t1: number, f: (t: number) => number[]) => {
  const out: number[][] = [];
  for (let t = t0; t <= t1 + 1e-9; t += step) out.push([t, ...f(t)]);
  return out;
};
const logo = (floatFrom: number, m0: number, contact: number, D0: number) =>
  sample(floatFrom - 0.3, settledAt(contact) + 0.4, (t) => {
    const p = halfPose(t, floatFrom, m0, contact, D0);
    return [-p.dx, p.dx, p.dy, p.rot]; // left half x offset, right half x offset, common y drift, tilt
  });
const curves = {
  meta: { intro: { halvesIn: I.halvesIn, merge: I.merge, contact: I.contact, D0: INTRO_D0, comp: compressionPx(INTRO_D0, I.contact - I.merge[0]) }, sig: { merge: SG.merge, lock: SG.lock, D0: END_D0, comp: compressionPx(END_D0, SG.lock - SG.merge[0]) }, gallery: GA },
  introHalves: logo(I.halvesIn[0], I.merge[0], I.contact, INTRO_D0),
  endHalves: logo(SG.fly[1] + 0.12, SG.merge[0], SG.lock, END_D0),
  gallery: sample(GA.start - 0.2, GA.end + 0.2, (t) => { const c = galCam(t); return [c.z, c.x]; }),
  builds: BUILDS.map((b) => ({ n: b.n, hero: !!b.hero, track: sample(GA.start, GA.end, (t) => { const p = place(b, t); return [p.x, p.y, p.s, p.dz]; }).filter((_, i) => i % 4 === 0) })),
  word: sample(0, 0.56, (t) => [arrive(t / 0.56)]),
  camera: sample(0, V.route.stroke[0] + 0.4, (t) => { const c = camAt(t); return [c.pos.x, c.pos.y, c.pos.z, c.yaw, c.pitch, c.f]; }).filter((_, i) => i % 2 === 0),
};
fs.mkdirSync("qa/out", { recursive: true });
fs.writeFileSync("qa/out/curves.json", JSON.stringify(curves));
console.log("curves written");
