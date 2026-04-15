const iosAppName = process.env.DETOX_IOS_APP_NAME ?? "CueCommXMobile";

module.exports = {
  apps: {
    "android.debug": {
      binaryPath: "android/app/build/outputs/apk/debug/app-debug.apk",
      build:
        "npx expo prebuild --platform android --no-install && cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug",
      type: "android.apk",
    },
    "ios.debug": {
      binaryPath: `ios/build/Build/Products/Debug-iphonesimulator/${iosAppName}.app`,
      build: `npx expo prebuild --platform ios --no-install && xcodebuild -workspace ios/${iosAppName}.xcworkspace -scheme ${iosAppName} -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build`,
      type: "ios.app",
    },
  },
  configurations: {
    "android.emu.debug": {
      app: "android.debug",
      device: "android.emulator",
    },
    "ios.sim.debug": {
      app: "ios.debug",
      device: "ios.simulator",
    },
  },
  devices: {
    "android.emulator": {
      device: {
        avdName: process.env.DETOX_ANDROID_AVD ?? "Pixel_8_API_34",
      },
      type: "android.emulator",
    },
    "ios.simulator": {
      device: {
        type: process.env.DETOX_IOS_SIMULATOR ?? "iPhone 15",
      },
      type: "ios.simulator",
    },
  },
  testRunner: {
    args: {
      $0: "jest",
      config: "e2e/jest.config.cjs",
    },
    jest: {
      setupTimeout: 120_000,
    },
  },
};
