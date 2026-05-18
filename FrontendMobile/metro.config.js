const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// 1. Watch the sibling web directory folder safely
const workspaceRoot = path.resolve(__dirname);
const sharedWebRoot = path.resolve(__dirname, '../FrontendWeb/src');

config.watchFolders = [workspaceRoot, sharedWebRoot];

// 2. Configure resolver.extraNodeModules to define the global namespace alias pointing directly to that folder
config.resolver.extraNodeModules = {
  '@shared-web': sharedWebRoot,
};

// Ensure node_modules inside workspaceRoot is preferred for dependency resolution
config.resolver.nodeModulesPaths = [
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
