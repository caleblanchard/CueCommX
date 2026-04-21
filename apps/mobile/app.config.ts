import type { ExpoConfig } from "expo/config";

type CueCommXExpoConfig = ExpoConfig & {
  android?: ExpoConfig["android"] & {
    usesCleartextTraffic?: boolean;
  };
};

const config: CueCommXExpoConfig = {
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
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
        NSAllowsLocalNetworking: true,
      },
      NSCameraUsageDescription:
        "Allow CueCommX to use your camera to scan a server connection QR code.",
      // Required by iOS 14+ so the OS permits mDNS browsing on physical devices.
      // Without this, Bonjour discovery is silently blocked (Simulator is unaffected).
      NSLocalNetworkUsageDescription:
        "CueCommX needs local network access to discover intercom servers on your network.",
      NSBonjourServices: ["_cuecommx._tcp"],
      UIBackgroundModes: ["audio"],
    },
  },
  android: {
    package: "com.cuecommx.mobile",
    usesCleartextTraffic: true,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#020617",
    },
    permissions: [
      "android.permission.CAMERA",
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.CHANGE_WIFI_MULTICAST_STATE",
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
    "./plugins/withAudioRouter",
    "expo-camera",
    "expo-dev-client",
    "expo-notifications",
    [
      "expo-audio",
      {
        microphonePermission:
          "Allow CueCommX to access your microphone for local intercom communication.",
      },
    ],
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
