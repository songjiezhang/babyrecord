import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createBabyRecordServer } from '../server/index.mjs';

const root = normalize(process.argv[2] ?? 'dist-ui-check');
const port = Number(process.env.PORT ?? 4173);
const apiServer = createBabyRecordServer({
  accessPin: process.env.ACCESS_PIN ?? '2468',
  adminPin: process.env.ADMIN_PIN ?? '1357',
  appVersion: process.env.APP_VERSION ?? 'ui-test',
});
const apiHandler = apiServer.listeners('request')[0];
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer((request, response) => {
  if (request.url?.startsWith('/api/')) {
    request.url = request.url.slice('/api'.length);
    apiHandler(request, response);
    return;
  }

  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const requestedPath = normalize(join(root, relativePath));
  const rootPrefix = `${root}/`;
  const safePath = requestedPath === root || requestedPath.startsWith(rootPrefix) ? requestedPath : join(root, 'index.html');
  let filePath = safePath;
  try {
    if (!statSync(filePath).isFile()) filePath = join(root, 'index.html');
  } catch {
    filePath = join(root, 'index.html');
  }
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`babyrecord UI test server listening on http://127.0.0.1:${port}`);
});
