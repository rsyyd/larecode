import { LareError } from '../error/error.js';

export interface CronSpec {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

export const CRON_LOOKAHEAD_DAYS = 366;

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

function invalid(input: string, reason: string): never {
  throw new LareError('CRON_INVALID_SCHEDULE', `invalid schedule "${input}": ${reason}`);
}

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function parseField(
  input: string,
  source: string,
  min: number,
  max: number,
  names?: Record<string, number>
): number[] {
  const values = new Set<number>();
  for (const part of input.split(',')) {
    const [base, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (stepText !== undefined && (!Number.isInteger(step) || step < 1)) {
      invalid(source, `bad step "${part}"`);
    }
    let start: number;
    let end: number;
    if (base === '*') {
      start = min;
      end = max;
    } else if (base.includes('-')) {
      const [from, to] = base.split('-');
      start = named(from, names) ?? Number(from);
      end = named(to, names) ?? Number(to);
    } else {
      start = named(base, names) ?? Number(base);
      end = start;
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      invalid(source, `"${part}" outside ${min}-${max}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

function named(input: string, names?: Record<string, number>): number | undefined {
  return names?.[input.trim().toLowerCase()];
}

function parseTime(input: string, source: string): { hour: number; minute: number } {
  const match = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/.exec(input.trim());
  if (!match) invalid(source, `cannot read time "${input.trim()}"`);
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3];
  if (meridiem) {
    if (hour < 1 || hour > 12) invalid(source, `"${input.trim()}" is not a 12-hour clock time`);
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  }
  if (hour > 23) invalid(source, `hour ${hour} outside 0-23`);
  return { hour, minute };
}

export function parseSchedule(input: string): CronSpec {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) invalid(input, 'empty schedule');

  const everyMinutes = /^(?:every )?(\d+) ?(?:min|minute|minutes|m)$/.exec(text);
  if (everyMinutes) {
    const step = Number(everyMinutes[1]);
    if (step < 1 || step > 60) invalid(input, 'minute step must be 1-60');
    return spec({ minutes: range(0, 59).filter((minute) => minute % step === 0) });
  }

  const everyHours = /^(?:every )?(\d+) ?(?:hour|hours|h)$/.exec(text);
  if (everyHours) {
    const step = Number(everyHours[1]);
    if (step < 1 || step > 24) invalid(input, 'hour step must be 1-24');
    return spec({ hours: range(0, 23).filter((hour) => hour % step === 0), minutes: [0] });
  }

  if (text === 'every minute' || text === 'minutely') return spec({});

  const scheduled = /^(?:(?:every|on) )?([a-z]+) at (.+)$/.exec(text);
  const weekday = scheduled ? WEEKDAYS[scheduled[1]] : undefined;

  if (text === 'hourly' || text === 'every hour') return spec({ minutes: [0] });

  if (
    scheduled &&
    (scheduled[1] === 'day' || scheduled[1] === 'daily' || scheduled[1] === 'everyday')
  ) {
    const time = parseTime(scheduled[2], input);
    return spec({ hours: [time.hour], minutes: [time.minute] });
  }

  if (scheduled && (scheduled[1] === 'weekday' || scheduled[1] === 'weekdays')) {
    const time = parseTime(scheduled[2], input);
    return spec({ hours: [time.hour], minutes: [time.minute], daysOfWeek: [1, 2, 3, 4, 5] });
  }

  if (scheduled && (scheduled[1] === 'weekend' || scheduled[1] === 'weekends')) {
    const time = parseTime(scheduled[2], input);
    return spec({ hours: [time.hour], minutes: [time.minute], daysOfWeek: [0, 6] });
  }

  if (scheduled && weekday !== undefined) {
    const time = parseTime(scheduled[2], input);
    return spec({ hours: [time.hour], minutes: [time.minute], daysOfWeek: [weekday] });
  }

  const atOnly = /^(?:at|daily at|every day at) (.+)$/.exec(text);
  if (atOnly || /^\d{1,2}(?::[0-5]\d)?\s*(?:am|pm)?$/.test(text)) {
    const time = parseTime(atOnly ? atOnly[1] : text, input);
    return spec({ hours: [time.hour], minutes: [time.minute] });
  }

  const fields = text.split(' ');
  if (fields.length !== 5) {
    invalid(
      input,
      'expected five cron fields or a phrase like "every 30 minutes", "daily at 09:00", "weekdays at 9am"'
    );
  }
  return spec({
    minutes: parseField(fields[0], input, 0, 59),
    hours: parseField(fields[1], input, 0, 23),
    daysOfMonth: parseField(fields[2], input, 1, 31),
    months: parseField(fields[3], input, 1, 12),
    daysOfWeek: parseField(fields[4], input, 0, 6, WEEKDAYS).map((day) => (day === 7 ? 0 : day)),
  });
}

function spec(partial: Partial<CronSpec>): CronSpec {
  return {
    minutes: partial.minutes ?? range(0, 59),
    hours: partial.hours ?? range(0, 23),
    daysOfMonth: partial.daysOfMonth ?? range(1, 31),
    months: partial.months ?? range(1, 12),
    daysOfWeek: partial.daysOfWeek ?? range(0, 6),
  };
}

export function nextRun(parsed: CronSpec, from: Date): Date {
  const minutes = new Set(parsed.minutes);
  const hours = new Set(parsed.hours);
  const daysOfMonth = new Set(parsed.daysOfMonth);
  const months = new Set(parsed.months);
  const daysOfWeek = new Set(parsed.daysOfWeek);
  const domRestricted = parsed.daysOfMonth.length < 31;
  const dowRestricted = parsed.daysOfWeek.length < 7;

  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = CRON_LOOKAHEAD_DAYS * 24 * 60;
  for (let step = 0; step < limit; step += 1) {
    const matchesDay =
      domRestricted && dowRestricted
        ? daysOfMonth.has(cursor.getDate()) || daysOfWeek.has(cursor.getDay())
        : daysOfMonth.has(cursor.getDate()) && daysOfWeek.has(cursor.getDay());
    if (
      matchesDay &&
      months.has(cursor.getMonth() + 1) &&
      hours.has(cursor.getHours()) &&
      minutes.has(cursor.getMinutes())
    ) {
      return cursor;
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  throw new LareError('CRON_INVALID_SCHEDULE', 'schedule never matches within a year');
}
