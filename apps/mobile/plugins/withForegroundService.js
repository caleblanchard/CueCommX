/**
 * Expo config plugin: withForegroundService
 *
 * Injects CueCommXIntercomService into AndroidManifest.xml so Android allows
 * it to run as a foreground service with microphone access.
 */
const { withAndroidManifest } = require("@expo/config-plugins");

const SERVICE_CLASS = "com.cuecommx.foregroundservice.CueCommXIntercomService";

module.exports = function withForegroundService(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) return mod;

    const services = application.service ?? [];
    const alreadyDeclared = services.some(
      (s) => s.$?.["android:name"] === SERVICE_CLASS
    );

    if (!alreadyDeclared) {
      application.service = [
        ...services,
        {
          $: {
            "android:name": SERVICE_CLASS,
            "android:foregroundServiceType": "microphone",
            "android:exported": "false",
          },
        },
      ];
    }

    return mod;
  });
};
