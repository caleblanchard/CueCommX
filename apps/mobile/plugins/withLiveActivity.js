/**
 * Expo config plugin: withLiveActivity
 *
 * Adds the CueCommXLiveActivity Widget Extension target to the iOS Xcode project.
 * Source files live in native-modules/live-activity/ (tracked in git, outside ios/).
 */
const { withXcodeProject, withInfoPlist } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const EXTENSION_NAME = "CueCommXLiveActivity";
const EXTENSION_BUNDLE_ID = "com.cuecommx.mobile.live-activity";
const DEPLOYMENT_TARGET = "16.2";

const SWIFT_FILES = [
  "CueCommXLiveActivityAttributes.swift",
  "CueCommXLiveActivityWidget.swift",
  "CueCommXLiveActivityBundle.swift",
  "ToggleTalkIntent.swift",
];

const NATIVE_SRC = path.join(__dirname, "..", "native-modules", "live-activity");

function withLiveActivityXcode(config) {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const iosDir = mod.modRequest.platformProjectRoot;
    const destDir = path.join(iosDir, EXTENSION_NAME);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy all source and resource files
    const allFiles = [...SWIFT_FILES, "Info.plist"];
    for (const file of allFiles) {
      const src = path.join(NATIVE_SRC, file);
      if (!fs.existsSync(src)) {
        console.warn(`[withLiveActivity] Source not found: ${src}`);
        continue;
      }
      fs.copyFileSync(src, path.join(destDir, file));
    }

    // Idempotency check
    const existingTargets = project.pbxNativeTargetSection();
    const alreadyAdded = Object.values(existingTargets).some(
      (t) => t && t.name === `"${EXTENSION_NAME}"`
    );

    if (!alreadyAdded) {
      const target = project.addTarget(
        EXTENSION_NAME,
        "app_extension",
        EXTENSION_NAME,
        EXTENSION_BUNDLE_ID
      );

      // addTarget("app_extension") automatically:
      //   - Creates a CopyFiles build phase on the MAIN target to embed the extension
      //   - Adds a target dependency from main → extension
      //   - Does NOT add Sources/Frameworks phases to the extension itself
      // We must add those manually.

      const sourcesPhaseResult = project.addBuildPhase(
        [],
        "PBXSourcesBuildPhase",
        "Sources",
        target.uuid
      );
      const extSourcesUuid = sourcesPhaseResult.uuid;

      project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

      // Add Swift source files via direct PBX manipulation.
      // The xcode package's addSourceFile is not suitable here:
      //   - Without a group it routes through addPluginFile, which requires a
      //     "Plugins" PBXGroup that doesn't exist in this project.
      //   - With a group name it tries PBXVariantGroup (wrong type), crashing when
      //     that section is absent.
      // Direct manipulation is verbose but reliable.
      const objects = project.hash.project.objects;

      // Find the PBXGroup UUID that addTarget() created for the extension.
      const pbxGroups = objects["PBXGroup"] || {};
      let extGroupKey = null;
      for (const [key, grp] of Object.entries(pbxGroups)) {
        if (key.endsWith("_comment")) continue;
        if (grp && (grp.name === `"${EXTENSION_NAME}"` || grp.name === EXTENSION_NAME)) {
          extGroupKey = key;
          break;
        }
      }

      // Set the group's path so that file references with sourceTree="<group>"
      // resolve relative to ios/CueCommXLiveActivity/ rather than ios/ root.
      if (extGroupKey && pbxGroups[extGroupKey]) {
        pbxGroups[extGroupKey].path = `"${EXTENSION_NAME}"`;
      }

      for (const file of SWIFT_FILES) {
        // Add PBXFileReference
        const fileRefUuid = project.generateUuid();
        objects["PBXFileReference"] = objects["PBXFileReference"] || {};
        objects["PBXFileReference"][fileRefUuid] = {
          isa: "PBXFileReference",
          lastKnownFileType: "sourcecode.swift",
          name: `"${file}"`,
          path: `"${EXTENSION_NAME}/${file}"`,
          sourceTree: '"<group>"',
        };
        objects["PBXFileReference"][`${fileRefUuid}_comment`] = file;

        // Attach to the extension's PBXGroup
        if (extGroupKey && objects["PBXGroup"][extGroupKey]) {
          objects["PBXGroup"][extGroupKey].children =
            objects["PBXGroup"][extGroupKey].children || [];
          objects["PBXGroup"][extGroupKey].children.push({
            value: fileRefUuid,
            comment: file,
          });
        }

        // Add PBXBuildFile
        const buildFileUuid = project.generateUuid();
        objects["PBXBuildFile"][buildFileUuid] = {
          isa: "PBXBuildFile",
          fileRef: fileRefUuid,
          fileRef_comment: file,
        };
        objects["PBXBuildFile"][`${buildFileUuid}_comment`] = `${file} in Sources`;

        // Register in the extension's Sources build phase
        const sourcesPhase = objects["PBXSourcesBuildPhase"][extSourcesUuid];
        if (sourcesPhase) {
          sourcesPhase.files = sourcesPhase.files || [];
          sourcesPhase.files.push({
            value: buildFileUuid,
            comment: `${file} in Sources`,
          });
        }
      }

      // Update build settings for both Debug and Release configurations
      const configList =
        project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
      if (configList) {
        const configIds = configList.buildConfigurations.map((c) => c.value);
        for (const configId of configIds) {
          const buildConfig = project.pbxXCBuildConfigurationSection()[configId];
          if (buildConfig && buildConfig.buildSettings) {
            Object.assign(buildConfig.buildSettings, {
              SWIFT_VERSION: "5.9",
              TARGETED_DEVICE_FAMILY: '"1"',
              IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
              INFOPLIST_FILE: `"${EXTENSION_NAME}/Info.plist"`,
              PRODUCT_BUNDLE_IDENTIFIER: `"${EXTENSION_BUNDLE_ID}"`,
              DEVELOPMENT_TEAM: '"5CD7VZ5QK5"',
              CODE_SIGN_STYLE: '"Automatic"',
            });
          }
        }
      }

      console.log(`[withLiveActivity] Added target: ${EXTENSION_NAME}`);
    }

    return mod;
  });
}

function withLiveActivityInfoPlist(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults["NSSupportsLiveActivities"] = true;
    mod.modResults["NSSupportsLiveActivitiesFrequentUpdates"] = true;
    return mod;
  });
}

module.exports = (config) => {
  config = withLiveActivityXcode(config);
  config = withLiveActivityInfoPlist(config);
  return config;
};
