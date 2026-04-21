const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Monorepo support: watch the entire repo so shared packages resolve
config.watchFolders = [monorepoRoot];

// Ensure Metro resolves node_modules from both the workspace and the root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force single copies of React to prevent "Invalid hook call" errors.
// Mobile must use react@19.1.0 to match react-native-renderer bundled in RN 0.81.5.
// Point to the workspace-local copy, NOT the monorepo root which runs 19.2.5.
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(monorepoRoot, "node_modules/react-native"),
};

module.exports = withNativeWind(config, { input: "./global.css" });
