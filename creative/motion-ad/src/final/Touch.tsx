import React from "react";
import { ease, range } from "../lib/ease";

/**
 * Mobile touch indicator: a small translucent fingertip that approaches,
 * makes contact (one quick ripple), compresses on press and is gone
 * immediately after release. Screen-space position.
 */
export type TouchTimes = { approach: number; contact: number; press: number; release: number };

export const Touch: React.FC<{ t: number; x: number; y: number; tt: TouchTimes; size?: number }> = ({ t, x, y, tt, size = 84 }) => {
  if (t < tt.approach || t > tt.release + 0.1) return null;
  const a = ease.outCubic(range(t, tt.approach, tt.contact));
  const press = ease.outCubic(range(t, tt.press, tt.press + 0.05)) * (1 - ease.outCubic(range(t, tt.release, tt.release + 0.05)));
  const out = range(t, tt.release, tt.release + 0.09);
  const opacity = a * (1 - out);
  const ripple = range(t, tt.contact, tt.contact + 0.3);
  const r = size / 2;
  return (
    <>
      <div style={{ position: "absolute", left: x + (1 - a) * 30, top: y + (1 - a) * 42, width: 0, height: 0 }}>
        <div
          style={{
            position: "absolute",
            left: -r,
            top: -r,
            width: size,
            height: size,
            borderRadius: r,
            transform: `scale(${(1.4 - 0.4 * a) * (1 - 0.15 * press) * (1 + 0.25 * out)})`,
            background: `rgba(255,255,255,${0.14 + 0.14 * press})`,
            boxShadow: `inset 0 0 0 2.5px rgba(255,255,255,${0.7 + 0.25 * press}), 0 ${10 * (1 - press) + 4}px ${24 - 10 * press}px rgba(0,0,0,0.45)`,
            opacity,
          }}
        />
      </div>
      {ripple > 0 && ripple < 1 && (
        <div
          style={{
            position: "absolute",
            left: x - r - 36 * ease.outCubic(ripple),
            top: y - r - 36 * ease.outCubic(ripple),
            width: size + 72 * ease.outCubic(ripple),
            height: size + 72 * ease.outCubic(ripple),
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.55)",
            opacity: (1 - ripple) * opacity,
          }}
        />
      )}
    </>
  );
};
