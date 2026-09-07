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

// core 源码为 TS nodenext 风格(相对导入带 .js 扩展指向 .ts 文件):
// metro 不会自动做 .js → .ts 映射,这里显式 fallback,避免打包解析失败
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3) + '.ts', platform);
    } catch {
      // 非 TS 场景回退默认解析(真正的 .js 文件)
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

// markdown-it@10 硬编码 require('punycode')(Node 内置模块),
// 用 npm 上零依赖的纯 JS punycode 包做 polyfill,避免 Hermes/Android 打包失败
config.resolver.extraNodeModules = {
  punycode: require.resolve('punycode/'),
};

module.exports = withNativeWind(config, { input: './src/global.css' });
