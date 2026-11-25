/**
 * The web server for the Azure App Service `cuttingboard`. The deploy script puts it in the site's
 * root as `server.cjs`, beside the built page, and sets the App Service to start it.
 *
 * It exists for one header. `pm2 serve` sent no Cache-Control at all, so a phone kept showing an
 * old page after a deploy. Here the page itself is `no-cache` (the browser must ask each time,
 * and gets a 304 when nothing changed), while the files under `assets/` have the build's hash in
 * their names, so they never change and can be kept for a year.
 *
 * Node's standard library only, so the deploy needs no `npm install` on the server.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** The file a request path names, or null when it would leave the site folder or is this server. */
function resolve(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT + path.sep) || path.basename(file) === 'server.cjs') return null;
  return file;
}

/** Answer one request: the file with its caching header, a 304 when the browser has it, or 404. */
function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let file = resolve(req.url || '/');
  // The app is one page: anything that is not a real file gets the page, so a bookmark still works.
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (file && path.extname(file)) {
      res.writeHead(404);
      return res.end();
    }
    file = path.join(ROOT, 'index.html');
  }
  const body = fs.readFileSync(file);
  const etag = `"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
  const hashed = path.relative(ROOT, file).split(path.sep)[0] === 'assets';
  const headers = {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, { ...headers, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

http.createServer(handle).listen(PORT, () => console.log(`cutting boards on ${PORT}`));
