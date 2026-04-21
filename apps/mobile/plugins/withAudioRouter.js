/**
 * Expo config plugin: withAudioRouter
 *
 * Adds AudioRouterModule Objective-C files to the iOS Xcode project during
 * `npx expo prebuild`. Source files live in native-modules/ios/ (tracked in
 * git, outside the generated ios/ dir) and are copied + registered each run.
 *
 * This gives us a thin native module for AVAudioSession output-port overriding
 * without disturbing react-native-webrtc's audio session (expo-av's
 * setAudioModeAsync changes category + mode, which disrupts WebRTC on iOS).
 */
const { withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const FILES = [
  { name: "AudioRouterModule.h", isSource: false },
  { name: "AudioRouterModule.m", isSource: true },
];

// Source files stored here, tracked in git, outside the generated ios/ folder
const NATIVE_SRC = path.join(__dirname, "..", "native-modules", "ios");

const withAudioRouter = (config) => {
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

      // Skip if already registered (idempotent across multiple prebuild runs)
      if (project.hasFile(projRelativePath)) continue;

      if (isSource) {
        project.addSourceFile(projRelativePath, {}, appName);
      } else {
        project.addHeaderFile(projRelativePath, {}, appName);
      }
    }

    return mod;
  });
};

module.exports = withAudioRouter;
