import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createBabyRecordServer } from '../server/index.mjs';

async function withServer(run) {
  const server = createBabyRecordServer({ accessPin: '2468', adminPin: '1357', appVersion: '1.2.3-beta.1' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function postPin(base, path, pin) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
}

test('health and prerelease version endpoints respond correctly', async () => {
  await withServer(async (base) => {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
    assert.deepEqual(await (await fetch(`${base}/app-version`)).json(), { version: '1.2.3-beta.1', prerelease: true });
  });
});

test('family and administrator PINs are strictly separated', async () => {
  await withServer(async (base) => {
    assert.equal((await postPin(base, '/auth/access-pin', '2468')).status, 200);
    assert.equal((await postPin(base, '/auth/access-pin', '1357')).status, 401);
    assert.equal((await postPin(base, '/auth/admin-pin', '1357')).status, 200);
    assert.equal((await postPin(base, '/auth/admin-pin', '2468')).status, 401);
  });
});

test('sync accepts only the family PIN in X-Sync-Key', async () => {
  await withServer(async (base) => {
    const accepted = await fetch(`${base}/sync`, { method: 'POST', headers: { 'X-Sync-Key': '2468' } });
    const rejectedAdmin = await fetch(`${base}/sync`, { method: 'POST', headers: { 'X-Sync-Key': '1357' } });
    const rejectedLegacy = await fetch(`${base}/sync`, { method: 'POST', headers: { 'X-Sync-Password': '2468' } });
    assert.equal(accepted.status, 200);
    assert.equal(rejectedAdmin.status, 401);
    assert.equal(rejectedLegacy.status, 401);
  });
});

test('unknown routes return JSON 404', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/unknown`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: 'not_found' });
  });
});
