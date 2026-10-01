import { Config } from "@remotion/cli/config";

// Lossless intermediate frames; colour handled explicitly at encode time.
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setConcurrency(4);
Config.setChromiumOpenGlRenderer("angle");
