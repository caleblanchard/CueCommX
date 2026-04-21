/**
 * Expo config plugin: withAudioRouter
 *
 * Adds AudioRouterModule Objective-C files to the iOS Xcode project during
 * `npx expo prebuild`. The source files live in native-modules/ios/ (tracked
 * in git) and are copied into ios/<AppName>/ then added to the Xcode project.
 *
 * This gives us a thin native module for AVAudioSession output-port overriding
 * without disturbing react-native-webrtc's audio session (expo-av's
 * setAudioModeAsync changes category + mode, which disrupts WebRTC on iOS).
 */
import { withXcodeProject, type ConfigPlugin } from "@expo/config-plugins";
import * as fs from "fs";
import * as path from "path";

const FILES: ReadonlyArray<{ name: string; isSource: boolean }> = [
  { name: "AudioRouterModule.h", isSource: false },
  { name: "AudioRouterModule.m", isSource: true },
];

// Source files are stored here (tracked in git, outside the generated ios/ dir)
const NATIVE_SRC = path.join(__dirname, "..", "native-modules", "ios");

const withAudioRouter: ConfigPlugin = (config) => {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const iosDir = mod.modRequest.platformProjectRoot; // .../apps/mobile/ios
    const appName = mod.modRequest.projectName ?? "CueCommXMobile";
    const destDir = path.join(iosDir, appName);

    for (const { name, isSource } of FILES) {
      const src = path.join(NATIVE_SRC, name);
      const dest = path.join(destDir, name);

      if (!fs.existsSync(src)) {
        console.warn(`[withAudioRouter] Source file not found: ${src}`);
        continue;
      }
      fs.copyFileSync(src, dest);

      const projRelativePath = path.join(appName, name);

      // Skip if already in the project (idempotent re-prebuild)
      const existing = project.hasFile(projRelativePath);
      if (existing) continue;

      if (isSource) {
        project.addSourceFile(projRelativePath, {}, appName);
      } else {
        project.addHeaderFile(projRelativePath, {}, appName);
      }
    }

    return mod;
  });
};

export default withAudioRouter;
