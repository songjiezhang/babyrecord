import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_DATA_SCHEMA_VERSION, migrateEnvelope } from '../src/data/schema.ts';

test('schema v4 promotes the default bath project to a built-in record', () => {
  const result = migrateEnvelope({
    schemaVersion: 4,
    exportedAt: '2026-08-08T00:00:00.000Z',
    payload: {
      items: [{ id: '1', dateKey: '2026-08-08', kind: 'custom', timeMode: 'range', time: '10:00', title: '洗澡' }],
      todos: [],
      babyProfile: { name: '宝宝', birthDate: '' },
      customProjects: [
        { id: 'default-bath', name: '洗澡', timeMode: 'range' },
        { id: 'temperature', name: '体温', timeMode: 'instant' },
      ],
    },
  });
  assert.equal(result.schemaVersion, CURRENT_DATA_SCHEMA_VERSION);
  assert.equal(result.payload.items[0].kind, 'bath');
  assert.equal(result.payload.items[0].timeMode, 'range');
  assert.deepEqual(result.payload.customProjects.map((item) => item.id), ['temperature']);
});

test('schema migration does not rename unrelated custom records', () => {
  const result = migrateEnvelope({
    schemaVersion: 4,
    exportedAt: '2026-08-08T00:00:00.000Z',
    payload: {
      items: [{ id: '1', dateKey: '2026-08-08', kind: 'custom', timeMode: 'instant', time: '10:00', title: '体温' }],
      customProjects: [],
    },
  });
  assert.equal(result.payload.items[0].kind, 'custom');
  assert.equal(result.payload.items[0].title, '体温');
});

test('full migration removes prototype data and ends on the current schema', () => {
  const result = migrateEnvelope({
    schemaVersion: 1,
    exportedAt: '2026-08-08T00:00:00.000Z',
    payload: {
      items: [{ id: '1', kind: 'feed', time: '09:00', title: '演示喂奶' }],
      todos: [{ id: 't1', title: '演示待办' }],
      customProjects: [{ id: 'c1', name: '演示项目' }],
      babyProfile: { name: '小满', birthDate: '2025-11-27' },
    },
  });
  assert.equal(result.schemaVersion, CURRENT_DATA_SCHEMA_VERSION);
  assert.deepEqual(result.payload.items, []);
  assert.deepEqual(result.payload.todos, []);
  assert.deepEqual(result.payload.customProjects, []);
  assert.deepEqual(result.payload.babyProfile, { name: '宝宝', birthDate: '' });
});

test('data from a newer application version is rejected', () => {
  assert.throws(
    () => migrateEnvelope({ schemaVersion: CURRENT_DATA_SCHEMA_VERSION + 1, exportedAt: '2026-08-08T00:00:00.000Z', payload: {} }),
    /更高版本/,
  );
});
