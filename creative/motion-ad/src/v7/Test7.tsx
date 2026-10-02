import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { Environment, Monitor, Phone } from "./Devices";
import { monCam, phoneCam, fullFrameCam } from "./cams";

const shot = staticFile("cap/journey6/f00420.png");
export const Test7: React.FC = () => {
  const f = useCurrentFrame();
  const cam = [monCam(3300, -20, -150), monCam(1700, -6, -20), fullFrameCam(), phoneCam(1000, 70)][f];
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Environment cam={cam} o={1} />
      <Monitor cam={cam} look={{ body: 1, stand: 1, rimRed: 0.6, led: 1 }} screenW={1620} screenH={2880} screenOn={1} screen={<Img src={shot} style={{ width: 1620, height: 2880 }} />} />
      <Phone cam={cam} o={1} wake={1} screenW={1170} screenH={2538} screen={<div style={{ width: 1170, height: 2538, background: "#0b141a", color: "#e9edef", fontSize: 60, fontFamily: "sans-serif", padding: 80 }}>I'd like to proceed with this build. Sharpness test 123</div>} />
    </AbsoluteFill>
  );
};
