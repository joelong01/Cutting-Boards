/**
 * The app's version, as the About box shows it. It is the `version` in package.json, put into
 * the page when it is built (see vite.config.ts), with a final ".0" left off: 0.9.0 reads "0.9",
 * 0.9.1 reads "0.9.1". It goes up when the app is deployed, by how big the change is: see
 * `scripts/deploy-azure.mjs`.
 */
export const shownVersion = (version: string): string => version.replace(/^(\d+\.\d+)\.0$/, '$1');

declare const __APP_VERSION__: string;

/** This build's version, as shown. */
export const APP_VERSION = shownVersion(typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0');
