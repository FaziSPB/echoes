const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// three ≥ r180 ships a deprecated CommonJS shim (build/three.cjs) that calls Node's `process.emitWarning`,
// which does not exist on Hermes ("undefined is not a function" at import time). @react-three/fiber/native
// uses `require('three')`, so send every `three` import to the ES module build instead.
const threeModule = require.resolve('three').replace(/three\.cjs$/, 'three.module.js');

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') return { type: 'sourceFile', filePath: threeModule };
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
