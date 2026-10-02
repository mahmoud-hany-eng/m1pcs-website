import React from "react";
import { Composition } from "remotion";
import { Proof } from "./proof/Proof";
import { ProofV5 } from "./v5/ProofV5";
import { Final, DURATION } from "./final/Final";
import { Final6, DURATION as DURATION6 } from "./v6/Final6";
import { Test7 } from "./v7/Test7";
import { Final7, DURATION as DURATION7 } from "./v7/Final7";
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
    <Composition
      id="FinalV6"
      component={Final6}
      durationInFrames={Math.round(DURATION6 * T.fps)}
      fps={T.fps}
      width={T.width}
      height={T.height}
    />
    <Composition id="FinalV7" component={Final7} durationInFrames={Math.round(DURATION7 * T.fps)} fps={T.fps} width={T.width} height={T.height} />
    <Composition id="Test7" component={Test7} durationInFrames={4} fps={T.fps} width={T.width} height={T.height} />
  </>
);
