import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { COLORS } from "../constants";
import { windowT, clamp01 } from "../three/easing";

/**
 * The closing card: black -> M1 mark -> "BUILD YOURS." -> monepcs.qa ->
 * "GET A QUOTE". Pure DOM/CSS so the type stays pixel-crisp regardless of
 * the 3D scene behind it. Centred well clear of Instagram's right-hand
 * action rail and the bottom caption band.
 */
export function EndCard({ blackout, t, hideText = false }: { blackout: number; t: number; hideText?: boolean }) {
  if (blackout <= 0.001) return null;
  const logo = clamp01(windowT(t, 0.982, 0.988));
  const headline = clamp01(windowT(t, 0.988, 0.993));
  const cta = clamp01(windowT(t, 0.994, 1.0));

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.black, opacity: blackout }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 22 }}>
        <Img
          src={staticFile("stills/logo.png")}
          style={{ width: 148, opacity: logo, transform: `translateY(${(1 - logo) * 14}px) scale(${0.94 + logo * 0.06})` }}
        />
        {!hideText && (
          <div
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontWeight: 800,
              fontSize: 58,
              letterSpacing: 1,
              color: COLORS.white,
              opacity: headline,
              transform: `translateY(${(1 - headline) * 16}px)`,
            }}
          >
            BUILD YOURS.
          </div>
        )}
        {!hideText && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              opacity: cta,
              transform: `translateY(${(1 - cta) * 12}px)`,
            }}
          >
            <div style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: 26, color: "rgba(245,245,246,0.75)", letterSpacing: 0.5 }}>monepcs.qa</div>
            <div
              style={{
                fontFamily: "Arial, Helvetica, sans-serif",
                fontWeight: 700,
                fontSize: 22,
                color: "#0a0a0b",
                background: COLORS.gold,
                padding: "14px 30px",
                borderRadius: 999,
                letterSpacing: 0.3,
              }}
            >
              GET A QUOTE
            </div>
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
