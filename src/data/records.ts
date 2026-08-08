export const BUILT_IN_RECORD_KINDS = ['sleep', 'feed', 'activity', 'diaper', 'supplement', 'bath'] as const;

export type BuiltInRecordKind = typeof BUILT_IN_RECORD_KINDS[number];
export type RecordKind = BuiltInRecordKind | 'custom';
export type TimeMode = 'instant' | 'range';

export type TimelineItem = {
  id: string;
  dateKey: string;
  kind: RecordKind;
  time: string;
  endTime?: string;
  title: string;
  detail: string;
  note?: string;
  ongoing?: boolean;
  timeMode?: TimeMode;
};

export type RecordDraft = {
  id: string;
  dateKey: string;
  kind: RecordKind;
  time: string;
  endTime?: string;
  rangeHasEnd: boolean;
  customTimeMode?: TimeMode;
  customName?: string;
  choice?: string;
  amount?: string;
  note?: string;
};

const TIME_MODES: Record<RecordKind, TimeMode> = {
  sleep: 'range',
  feed: 'instant',
  activity: 'range',
  diaper: 'instant',
  supplement: 'instant',
  bath: 'range',
  custom: 'instant',
};

const DEFAULT_CHOICES: Partial<Record<RecordKind, string>> = {
  feed: '母乳瓶喂',
  activity: '户外散步',
  diaper: '小便',
  supplement: '维生素 D',
};

export const RECORD_CHOICES: Partial<Record<RecordKind, readonly string[]>> = {
  feed: ['母乳瓶喂', '母乳亲喂', '配方奶'],
  activity: ['户外散步', '趴卧练习', '亲子阅读'],
  diaper: ['小便', '大便', '大小便'],
  supplement: ['铁剂', '维生素 D', '维生素 AD'],
};

export function defaultChoiceFor(kind: RecordKind | null | undefined) {
  return kind ? DEFAULT_CHOICES[kind] ?? '' : '';
}

export function timeModeFor(kind: RecordKind, customMode: TimeMode = 'instant'): TimeMode {
  return kind === 'custom' ? customMode : TIME_MODES[kind];
}

export function migrateQuickShortcutIds(ids: string[]) {
  return [...new Set(ids.map((id) => id === 'custom:default-bath' ? 'record:bath' : id))];
}

export function minuteOfDay(time: string) {
  const [hour = '0', minute = '0'] = time.split(':');
  return Number(hour) * 60 + Number(minute);
}

export function durationBetween(start: string, end: string) {
  let minutes = minuteOfDay(end) - minuteOfDay(start);
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

export function durationText(start: string, end: string) {
  const total = durationBetween(start, end);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分`;
}

export function isRangeItem(item: TimelineItem) {
  return item.timeMode === 'range' || TIME_MODES[item.kind] === 'range';
}

export function buildTimelineItem(draft: RecordDraft): TimelineItem {
  const recordTimeMode = timeModeFor(draft.kind, draft.customTimeMode);
  const isRange = recordTimeMode === 'range';
  const hasRangeEnd = isRange && draft.rangeHasEnd && !!draft.endTime;
  const isOngoing = isRange && !hasRangeEnd;
  const choice = draft.choice?.trim() || defaultChoiceFor(draft.kind);
  const rangeDetail = hasRangeEnd
    ? durationText(draft.time, draft.endTime!)
    : '进行中 · 正在计时';

  const definitions: Record<RecordKind, { title: string; detail: string }> = {
    sleep: { title: '睡眠', detail: hasRangeEnd ? rangeDetail : '睡眠中 · 正在计时' },
    feed: { title: choice, detail: choice === '母乳亲喂' ? '已记录' : `${draft.amount || 0} ml` },
    activity: { title: choice || '亲子活动', detail: rangeDetail },
    diaper: { title: '换尿布', detail: choice },
    supplement: { title: choice, detail: '1 次 · 已完成' },
    bath: { title: '洗澡', detail: rangeDetail },
    custom: { title: draft.customName?.trim() || '自定义记录', detail: isRange ? rangeDetail : '已记录' },
  };
  const definition = definitions[draft.kind];

  return {
    id: draft.id,
    dateKey: draft.dateKey,
    kind: draft.kind,
    timeMode: recordTimeMode,
    time: draft.time,
    endTime: hasRangeEnd ? draft.endTime : undefined,
    title: definition.title,
    detail: definition.detail,
    note: draft.note?.trim() || undefined,
    ongoing: isOngoing,
  };
}

function rangeEndMinute(item: TimelineItem, currentTime: string) {
  const start = minuteOfDay(item.time);
  let end = minuteOfDay(item.endTime ?? (item.ongoing ? currentTime : item.time));
  if (end < start) end += 24 * 60;
  return end;
}

export function rangesOverlap(first: TimelineItem, second: TimelineItem, currentTime: string) {
  if (!isRangeItem(first) || !isRangeItem(second)) return false;
  const firstStart = minuteOfDay(first.time);
  const firstEnd = rangeEndMinute(first, currentTime);
  const secondStart = minuteOfDay(second.time);
  const secondEnd = rangeEndMinute(second, currentTime);
  return [-24 * 60, 0, 24 * 60].some((shift) => firstStart < secondEnd + shift && firstEnd > secondStart + shift);
}

export function findRangeConflict(candidate: TimelineItem, items: TimelineItem[], currentTime: string) {
  if (!isRangeItem(candidate)) return undefined;
  return items.find((item) => item.id !== candidate.id && isRangeItem(item) && rangesOverlap(candidate, item, currentTime));
}

export function pointFallsInsideRange(pointTime: string, range: TimelineItem, currentTime: string) {
  if (!isRangeItem(range)) return false;
  const point = minuteOfDay(pointTime);
  const start = minuteOfDay(range.time);
  const end = rangeEndMinute(range, currentTime);
  return [-24 * 60, 0, 24 * 60].some((shift) => point >= start + shift && point <= end + shift);
}
