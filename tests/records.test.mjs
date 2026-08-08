import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_RECORD_KINDS,
  RECORD_CHOICES,
  buildTimelineItem,
  durationBetween,
  findRangeConflict,
  migrateQuickShortcutIds,
  pointFallsInsideRange,
  timeModeFor,
} from '../src/data/records.ts';

const baseDraft = {
  id: 'record-1',
  dateKey: '2026-08-08',
  time: '10:00',
  endTime: '10:30',
  rangeHasEnd: true,
};

test('all six default record types are available and bath is built in', () => {
  assert.deepEqual(BUILT_IN_RECORD_KINDS, ['sleep', 'feed', 'activity', 'diaper', 'supplement', 'bath']);
  assert.equal(timeModeFor('bath'), 'range');
});

test('feeding choices keep the requested order', () => {
  assert.deepEqual(RECORD_CHOICES.feed, ['母乳瓶喂', '母乳亲喂', '配方奶']);
  assert.equal(RECORD_CHOICES.activity?.[0], '户外散步');
});

test('each default entry creates the correct record type and title', () => {
  const cases = [
    ['sleep', '睡眠'],
    ['feed', '母乳瓶喂'],
    ['activity', '户外散步'],
    ['diaper', '换尿布'],
    ['supplement', '维生素 D'],
    ['bath', '洗澡'],
  ];
  for (const [kind, title] of cases) {
    const item = buildTimelineItem({ ...baseDraft, kind });
    assert.equal(item.kind, kind);
    assert.equal(item.title, title);
  }
});

test('bath can start timing and can also save a completed range', () => {
  const ongoing = buildTimelineItem({ ...baseDraft, kind: 'bath', rangeHasEnd: false });
  assert.deepEqual(
    { kind: ongoing.kind, title: ongoing.title, timeMode: ongoing.timeMode, ongoing: ongoing.ongoing, endTime: ongoing.endTime },
    { kind: 'bath', title: '洗澡', timeMode: 'range', ongoing: true, endTime: undefined },
  );

  const completed = buildTimelineItem({ ...baseDraft, kind: 'bath' });
  assert.equal(completed.title, '洗澡');
  assert.equal(completed.detail, '30 分钟');
  assert.equal(completed.ongoing, false);
  assert.equal(completed.endTime, '10:30');

  const missingEnd = buildTimelineItem({ ...baseDraft, kind: 'bath', rangeHasEnd: true, endTime: undefined });
  assert.equal(missingEnd.ongoing, true);
  assert.equal(missingEnd.endTime, undefined);
});

test('custom records never fall back to a feeding choice', () => {
  const named = buildTimelineItem({ ...baseDraft, kind: 'custom', customName: '体温', customTimeMode: 'instant' });
  const unnamed = buildTimelineItem({ ...baseDraft, kind: 'custom', customName: '', customTimeMode: 'instant', choice: '母乳瓶喂' });
  assert.equal(named.title, '体温');
  assert.equal(unnamed.title, '自定义记录');
  assert.notEqual(unnamed.title, '母乳瓶喂');
});

test('record keeps the selected date instead of silently using today', () => {
  const item = buildTimelineItem({ ...baseDraft, dateKey: '2026-08-03', kind: 'bath' });
  assert.equal(item.dateKey, '2026-08-03');
});

test('range conflict and instant overlap work across midnight', () => {
  const overnight = buildTimelineItem({
    ...baseDraft,
    id: 'overnight',
    kind: 'sleep',
    time: '23:30',
    endTime: '01:00',
  });
  const bath = buildTimelineItem({
    ...baseDraft,
    id: 'bath',
    kind: 'bath',
    time: '00:20',
    endTime: '00:40',
  });
  assert.equal(durationBetween('23:30', '01:00'), 90);
  assert.equal(findRangeConflict(bath, [overnight], '00:30')?.id, 'overnight');
  assert.equal(pointFallsInsideRange('00:30', overnight, '00:30'), true);
  assert.equal(pointFallsInsideRange('02:00', overnight, '02:00'), false);
});

test('legacy bath shortcut becomes the built-in shortcut without duplicates', () => {
  assert.deepEqual(
    migrateQuickShortcutIds(['record:sleep', 'custom:default-bath', 'record:bath']),
    ['record:sleep', 'record:bath'],
  );
});
