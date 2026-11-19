// Start the desktop app. `--dev` serves the page from Vite with hot reload; otherwise the built
// page in dist/ is loaded. Other arguments are passed through to the app.
import { spawn } from 'node:child_process';
import electron from 'electron';

const args = process.argv.slice(2);
const dev = args.includes('--dev');
const env = { ...process.env };
// Editors built on Electron export this, and it makes Electron start as plain Node.
delete env.ELECTRON_RUN_AS_NODE;

let server = null;
if (dev) {
  const { createServer } = await import('vite');
  server = await createServer();
  await server.listen();
  env.CB_DEV_URL = server.resolvedUrls.local[0];
  console.log(`Vite dev server at ${env.CB_DEV_URL}`);
}

// `--icon` runs the icon generator in Electron instead of the app.
const target = args.includes('--icon') ? 'scripts/make-icon.cjs' : '.';
const child = spawn(electron, [target, ...args.filter((a) => a !== '--dev' && a !== '--icon')], { stdio: 'inherit', env });
child.on('exit', async (code) => {
  if (server) await server.close();
  process.exit(code ?? 0);
});
