import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

function readSecret(name) {
  const file = process.env[`${name}_FILE`]?.trim();
  const value = file ? readFileSync(file, 'utf8').trim() : process.env[name]?.trim();
  if (!value) throw new Error(`${name} or ${name}_FILE must be configured`);
  return value;
}

const adminPin = readSecret('ADMIN_PIN');
const syncPassword = readSecret('SYNC_PASSWORD');
const attempts = new Map();

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error('request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function requestAddress(request) {
  const forwarded = request.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim()
    || request.socket.remoteAddress
    || 'unknown';
}

function isRateLimited(address) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const existing = attempts.get(address);
  const entry = !existing || now - existing.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : existing;
  entry.count += 1;
  attempts.set(address, entry);
  return entry.count > 8;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (request.method === 'GET' && url.pathname === '/health') {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === 'POST' && url.pathname === '/auth/admin-pin') {
    const address = requestAddress(request);
    if (isRateLimited(address)) return sendJson(response, 429, { ok: false });
    try {
      const body = await readJson(request);
      const ok = safeEqual(body.pin ?? '', adminPin);
      if (ok) attempts.delete(address);
      return sendJson(response, ok ? 200 : 401, { ok });
    } catch {
      return sendJson(response, 400, { ok: false });
    }
  }

  if (request.method === 'POST' && url.pathname === '/sync') {
    if (!safeEqual(request.headers['x-sync-password'] ?? '', syncPassword)) {
      return sendJson(response, 401, { ok: false, error: 'unauthorized' });
    }
    return sendJson(response, 200, {
      ok: true,
      apiVersion: 1,
      cursor: '0',
      changes: [],
      status: 'prototype',
    });
  }

  return sendJson(response, 404, { ok: false, error: 'not_found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`babyrecord api listening on ${port}`);
});
