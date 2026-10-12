import packageText from '../package.json?raw'
export const BUILDER_VERSION: string = (JSON.parse(packageText) as { version: string }).version
