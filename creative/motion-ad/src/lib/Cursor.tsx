import React from "react";

/**
 * A crisp vector pointer (drawn, not captured, so it stays razor sharp at
 * any camera zoom). Its position always comes from the SAME mouse
 * coordinates the real page received during capture, so hover/press states
 * in the footage line up with it exactly. `press` 0..1 squashes it.
 */
export const Cursor: React.FC<{ x: number; y: number; size: number; press?: number; opacity?: number }> = ({
  x,
  y,
  size,
  press = 0,
  opacity = 1,
}) => {
  const s = (size / 24) * (1 - 0.14 * press);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 24,
        height: 24,
        transform: `translate(-1.2px, -1.2px) scale(${s})`,
        transformOrigin: "1.2px 1.2px",
        opacity,
        filter: `drop-shadow(0 ${2 + 3 * (1 - press)}px ${3 + 4 * (1 - press)}px rgba(0,0,0,0.55))`,
        pointerEvents: "none",
      }}
    >
      <svg width={24} height={24} viewBox="0 0 24 24" style={{ overflow: "visible" }}>
        <path
          d="M1.2 1.2 L1.2 19.6 L5.9 15.3 L9 22.4 L12.3 21 L9.3 14 L15.8 13.7 Z"
          fill="#ffffff"
          stroke="#0a0a0b"
          strokeWidth={1.35}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
