const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// monorepo:监视 packages/core 的源码改动
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// @homibook/core 指向 packages/core 源码
config.resolver.alias = {
  '@homibook/core': path.resolve(workspaceRoot, 'packages/core/src/index.ts'),
};

// markdown-it@10 硬编码 require('punycode')(Node 内置模块),
// 用 npm 上零依赖的纯 JS punycode 包做 polyfill,避免 Hermes/Android 打包失败
config.resolver.extraNodeModules = {
  punycode: require.resolve('punycode/'),
};

module.exports = withNativeWind(config, { input: './src/global.css' });
