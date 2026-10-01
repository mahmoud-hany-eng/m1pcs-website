import React, { useEffect, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

/**
 * The website's own fonts (latin subsets copied from the main build by
 * scripts/sync-assets.sh): Inter for UI, Space Grotesk for display — so any
 * composited copy reads in the same typography as the real site.
 */
export const FONT = {
  ui: "M1Inter, Inter, sans-serif",
  display: "M1Grotesk, 'Space Grotesk', sans-serif",
};

const faces: [string, string, string][] = [
  ["M1Inter", "fonts/inter-latin.woff2", "100 900"],
  ["M1Grotesk", "fonts/spacegrotesk-latin.woff2", "300 700"],
];

export const Fonts: React.FC = () => {
  const [handle] = useState(() => delayRender("site fonts"));
  useEffect(() => {
    Promise.all(
      faces.map(([family, file, weight]) => {
        const f = new FontFace(family, `url(${staticFile(file)}) format("woff2")`, { weight });
        return f.load().then((loaded) => (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded));
      })
    )
      .then(() => continueRender(handle))
      .catch((e) => {
        console.error(e);
        continueRender(handle);
      });
  }, [handle]);
  return null;
};
