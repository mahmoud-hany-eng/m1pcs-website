import React from "react";
import { Composition } from "remotion";
import { Proof } from "./proof/Proof";
import { ProofV5 } from "./v5/ProofV5";
import { Final, DURATION } from "./final/Final";
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
    <Composition
      id="ProofV5"
      component={ProofV5}
      durationInFrames={Math.round(T.v5.duration * T.fps) + 1}
      fps={T.fps}
      width={T.width}
      height={T.height}
    />
    <Composition
      id="Final"
      component={Final}
      durationInFrames={Math.round(DURATION * T.fps)}
      fps={T.fps}
      width={T.width}
      height={T.height}
    />
  </>
);
