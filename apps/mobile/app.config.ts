import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "CueCommX Mobile",
  slug: "cuecommx-mobile",
  version: "0.1.0",
  scheme: "cuecommx",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  newArchEnabled: true,
  icon: "./assets/icon.png",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#020617",
  },
  ios: {
    bundleIdentifier: "com.cuecommx.mobile",
    supportsTablet: false,
    infoPlist: {
      UIBackgroundModes: ["audio"],
    },
  },
  android: {
    package: "com.cuecommx.mobile",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#020617",
    },
    permissions: [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RECORD_AUDIO",
      "android.permission.WAKE_LOCK",
    ],
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-dev-client",
    "expo-notifications",
    [
      "@config-plugins/react-native-webrtc",
      {
        microphonePermission:
          "Allow CueCommX to access your microphone for local intercom communication.",
      },
    ],
  ],
};

export default config;
