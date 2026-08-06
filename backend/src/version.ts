import pkg from '../package.json' with { type: 'json' }

/** 应用版本号（从 package.json 读取，只需在 package.json 中维护） */
export const APP_VERSION: string = pkg.version
