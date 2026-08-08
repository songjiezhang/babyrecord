import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTodaySuggestions } from '../src/data/todoSuggestions.ts';

test('suggestions use all available history when fewer than seven days exist', () => {
  const records = [
    { dateKey: '2026-08-05', kind: 'feed', time: '08:00', title: '母乳瓶喂' },
    { dateKey: '2026-08-06', kind: 'feed', time: '08:20', title: '母乳瓶喂' },
    { dateKey: '2026-08-07', kind: 'feed', time: '08:10', title: '母乳瓶喂' },
  ];
  const suggestions = generateTodaySuggestions(records, '2026-08-08');
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].time, '08:10');
  assert.match(suggestions[0].reason, /最近 3 个有效记录日/);
});

test('today records advance the suggestion to the next occurrence', () => {
  const records = [
    { dateKey: '2026-08-07', kind: 'feed', time: '08:00', title: '母乳瓶喂' },
    { dateKey: '2026-08-07', kind: 'feed', time: '11:30', title: '母乳瓶喂' },
    { dateKey: '2026-08-08', kind: 'feed', time: '08:05', title: '母乳瓶喂' },
  ];
  const suggestions = generateTodaySuggestions(records, '2026-08-08');
  assert.equal(suggestions[0].time, '11:30');
  assert.match(suggestions[0].reason, /第 2 次喂奶/);
});

test('no history means no demo todo data', () => {
  assert.deepEqual(generateTodaySuggestions([], '2026-08-08'), []);
});
