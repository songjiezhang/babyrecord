export type SuggestionRecordKind = 'sleep' | 'feed' | 'activity' | 'diaper' | 'supplement' | 'custom';

export type SuggestionRecord = {
  dateKey: string;
  kind: SuggestionRecordKind;
  time: string;
  title: string;
};

export type SuggestedTodo = {
  id: string;
  kind: SuggestionRecordKind;
  time: string;
  title: string;
  reason: string;
  done: boolean;
};

const RECURRING_KINDS: Array<{ kind: SuggestionRecordKind; title: string; label: string }> = [
  { kind: 'feed', title: '下一次喂奶', label: '喂奶' },
  { kind: 'sleep', title: '准备睡眠', label: '睡眠' },
  { kind: 'activity', title: '活动时间', label: '活动' },
];

function minuteOfDay(value: string) {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

function timeFromMinute(value: number) {
  const minute = Math.max(0, Math.min(24 * 60 - 1, Math.round(value)));
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function recordsForDay(records: SuggestionRecord[], dateKey: string, kind: SuggestionRecordKind) {
  return records
    .filter((record) => record.dateKey === dateKey && record.kind === kind)
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Generates derived suggestions only; no suggestion is persisted as health data. */
export function generateTodaySuggestions(records: SuggestionRecord[], todayKey: string): SuggestedTodo[] {
  const historyDayKeys = [...new Set(records
    .filter((record) => record.dateKey < todayKey)
    .map((record) => record.dateKey))]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 7);

  if (!historyDayKeys.length) return [];

  const suggestions: SuggestedTodo[] = [];
  for (const definition of RECURRING_KINDS) {
    const todayCount = recordsForDay(records, todayKey, definition.kind).length;
    const candidateTimes = historyDayKeys
      .map((dateKey) => recordsForDay(records, dateKey, definition.kind)[todayCount]?.time)
      .filter((time): time is string => !!time)
      .map(minuteOfDay);
    if (!candidateTimes.length) continue;
    suggestions.push({
      id: `suggested:${todayKey}:${definition.kind}:${todayCount + 1}`,
      kind: definition.kind,
      time: timeFromMinute(median(candidateTimes)),
      title: definition.title,
      reason: `根据最近 ${candidateTimes.length} 个有效记录日的第 ${todayCount + 1} 次${definition.label}时间`,
      done: false,
    });
  }

  const todaySupplementTitles = new Set(recordsForDay(records, todayKey, 'supplement').map((record) => record.title));
  const supplementTitles = [...new Set(historyDayKeys.flatMap((dateKey) => recordsForDay(records, dateKey, 'supplement').map((record) => record.title)))];
  supplementTitles.forEach((title) => {
    if (todaySupplementTitles.has(title)) return;
    const candidateTimes = historyDayKeys
      .map((dateKey) => recordsForDay(records, dateKey, 'supplement').find((record) => record.title === title)?.time)
      .filter((time): time is string => !!time)
      .map(minuteOfDay);
    if (!candidateTimes.length) return;
    suggestions.push({
      id: `suggested:${todayKey}:supplement:${title}`,
      kind: 'supplement',
      time: timeFromMinute(median(candidateTimes)),
      title,
      reason: `根据最近 ${candidateTimes.length} 个有效记录日的完成时间`,
      done: false,
    });
  });

  return suggestions.sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6);
}
