import React from "react";
import { Composition } from "remotion";
import { Proof } from "./proof/Proof";
import T from "../timeline.json";

export const Root: React.FC = () => (
  <>
    <Composition
      id="Proof"
      component={Proof}
      durationInFrames={Math.round(T.proof.duration * T.fps)}
      fps={T.fps}
      width={T.width}
      height={T.height}
    />
  </>
);
