import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { ease, lerp, range } from "../lib/ease";
import { Cam, SiteFrame, clampCam, toScreen } from "../lib/SiteFrame";
import { BRAND, camAt, glide } from "./shared";
import { FONT } from "./fonts";
import { CTA0, CTA_CAM } from "./Builds";
import CTA_LOG from "../../public/cap/cta/log.json";
import T from "../../timeline.json";

/**
 * Shot 10: the REAL closing section of the homepage ("Ready to build yours?")
 * plays its own entrance around the build that just settled into it. Then
 * everything simplifies to the end card: the real logo, BUILD YOURS.,
 * monepcs.qa — and the site's real "Build Your PC" button, lifted out of the
 * page into the card.
 */

type R = { x: number; y: number; w: number; h: number };
const LOG = CTA_LOG as unknown as { meta: { btn: R } }[];
const LAST = LOG.length - 1;
export const END0 = T.final.cues.cta.end0;
export const DURATION = T.final.cues.cta.duration;
const BTN_FRAME = 100;
const BTN = LOG[BTN_FRAME].meta.btn;

const ctaCam = (t: number): Cam => {
  const k = ease.inOutCubic(range(t, CTA0, END0 + 0.3));
  return clampCam({ cx: CTA_CAM.cx, cy: lerp(CTA_CAM.cy, 340, k), s: lerp(CTA_CAM.s, 1.06, k) });
};
const ctaIndex = (t: number) => Math.max(0, Math.min(LAST, Math.round((t - CTA0) * 60)));

export const CtaPage: React.FC<{ t: number }> = ({ t }) => {
  if (t < CTA0 - 0.02) return null;
  const end = ease.inOutCubic(range(t, END0, END0 + 0.24));
  const fadeIn = range(t, CTA0, CTA0 + 0.22);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ opacity: fadeIn, transformOrigin: "540px 900px", transform: `scale(${1 - 0.05 * end})` }}>
        <SiteFrame dir="cta" index={ctaIndex(t)} cam={ctaCam(t)} brightness={1 - end} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const EndCard: React.FC<{ t: number }> = ({ t }) => {
  if (t < END0 - 0.02) return null;
  const logo = ease.settle(range(t, END0 + 0.12, END0 + 0.56));
  const l1 = ease.settle(range(t, END0 + 0.2, END0 + 0.52));
  const l2 = ease.settle(range(t, END0 + 0.28, END0 + 0.6));
  const sweep = range(t, END0 + 0.42, END0 + 0.86);

  // the real button: from its place in the page to the card
  const btnK = glide(range(t, END0, END0 + 0.42));
  const cam0 = ctaCam(END0);
  const from = toScreen(BTN.x + BTN.w / 2, BTN.y + BTN.h / 2, cam0);
  const to = { x: 540, y: 1400 };
  const s = lerp(cam0.s, 0.8, btnK);
  const bx = lerp(from.x, to.x, btnK);
  const by = lerp(from.y, to.y, btnK);
  const bcam = camAt(BTN.x + BTN.w / 2, BTN.y + BTN.h / 2, bx, by, s);
  const a = toScreen(BTN.x, BTN.y, bcam), b = toScreen(BTN.x + BTN.w, BTN.y + BTN.h, bcam);

  const LOGO_W = 560;
  const logoH = (LOGO_W * 5625) / 4500;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* real logo */}
      <div style={{ position: "absolute", left: 540 - LOGO_W / 2, top: 250 + (1 - logo) * 30, width: LOGO_W, height: logoH, opacity: logo, transform: `scale(${0.95 + 0.05 * logo})` }}>
        <Img src={staticFile("brand/logo.png")} style={{ width: "100%", height: "100%" }} />
        {/* one red→gold light sweep, masked by the logo itself */}
        {sweep > 0 && sweep < 1 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              WebkitMaskImage: `url(${staticFile("brand/logo.png")})`,
              WebkitMaskSize: "100% 100%",
              background: `linear-gradient(105deg, rgba(255,255,255,0) ${-30 + 150 * sweep}%, rgba(255,214,120,0.95) ${-18 + 150 * sweep}%, rgba(255,120,80,0.6) ${-12 + 150 * sweep}%, rgba(255,255,255,0) ${0 + 150 * sweep}%)`,
              mixBlendMode: "screen",
            }}
          />
        )}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1000, textAlign: "center", fontFamily: FONT.display, fontWeight: 700, fontSize: 138, letterSpacing: -3, color: BRAND.white }}>
        <div style={{ overflow: "hidden", paddingBottom: 8 }}>
          <div style={{ transform: `translateY(${(1 - l1) * 110}%)` }}>
            BUILD <span style={{ color: BRAND.yellow }}>YOURS.</span>
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1178, textAlign: "center", fontFamily: FONT.ui, fontWeight: 600, fontSize: 52, letterSpacing: 2, color: BRAND.white, opacity: l2, transform: `translateY(${(1 - l2) * 24}px)` }}>
        monepcs.qa
      </div>
      {/* the site's real Build Your PC button */}
      <AbsoluteFill style={{ clipPath: `inset(${a.y}px ${1080 - b.x}px ${1920 - b.y}px ${a.x}px round ${(b.y - a.y) / 2}px)` }}>
        <SiteFrame dir="cta" index={BTN_FRAME} cam={bcam} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ctaSamples = (t: number) => (t >= END0 && t < END0 + 0.42 ? 4 : 1);
