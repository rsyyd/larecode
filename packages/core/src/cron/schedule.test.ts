import { describe, expect, it } from 'vitest';
import { LareError } from '../error/error.js';
import { nextRun, parseSchedule } from './schedule.js';

const at = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  new Date(year, month - 1, day, hour, minute, second);

const next = (schedule: string, from: Date) => nextRun(parseSchedule(schedule), from);

describe('parseSchedule', () => {
  it('parses natural phrases', () => {
    expect(parseSchedule('every 30 minutes').minutes).toEqual([0, 30]);
    expect(parseSchedule('every 2 hours')).toEqual(
      expect.objectContaining({ hours: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], minutes: [0] })
    );
    expect(parseSchedule('hourly').minutes).toEqual([0]);
    expect(parseSchedule('every minute').minutes).toHaveLength(60);
    expect(parseSchedule('daily at 09:30')).toEqual(
      expect.objectContaining({ hours: [9], minutes: [30] })
    );
    expect(parseSchedule('weekdays at 9am').daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(parseSchedule('weekends at 9am').daysOfWeek).toEqual([0, 6]);
    expect(parseSchedule('every monday at 18:00')).toEqual(
      expect.objectContaining({ daysOfWeek: [1], hours: [18], minutes: [0] })
    );
  });

  it('parses five-field cron', () => {
    expect(parseSchedule('*/15 9-17 * * 1-5')).toEqual({
      minutes: [0, 15, 30, 45],
      hours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
      daysOfMonth: Array.from({ length: 31 }, (_, index) => index + 1),
      months: Array.from({ length: 12 }, (_, index) => index + 1),
      daysOfWeek: [1, 2, 3, 4, 5],
    });
    expect(parseSchedule('0 4 1 * *').daysOfMonth).toEqual([1]);
  });

  it('rejects nonsense with a typed error', () => {
    for (const bad of [
      '',
      'gibberish',
      '99 0 * * *',
      'every 0 minutes',
      'daily at 25:00',
      '* * *',
    ]) {
      expect(() => parseSchedule(bad)).toThrowError(LareError);
      try {
        parseSchedule(bad);
      } catch (error) {
        expect((error as LareError).code).toBe('CRON_INVALID_SCHEDULE');
      }
    }
  });
});

describe('nextRun', () => {
  it('advances within the hour for minute steps', () => {
    expect(next('every 30 minutes', at(2026, 10, 19, 10, 7))).toEqual(at(2026, 10, 19, 10, 30));
    expect(next('every 15 minutes', at(2026, 10, 19, 10, 46))).toEqual(at(2026, 10, 19, 11, 0));
    expect(next('every 2 hours', at(2026, 10, 19, 10, 1))).toEqual(at(2026, 10, 19, 12, 0));
  });

  it('handles daily times', () => {
    expect(next('daily at 9am', at(2026, 10, 19, 10, 0))).toEqual(at(2026, 10, 20, 9, 0));
    expect(next('daily at 09:30', at(2026, 10, 19, 8, 0))).toEqual(at(2026, 10, 19, 9, 30));
    expect(next('daily at 09:30', at(2026, 10, 19, 9, 30, 30))).toEqual(at(2026, 10, 20, 9, 30));
  });

  it('skips to weekdays', () => {
    expect(next('weekdays at 9am', at(2026, 10, 17, 12, 0))).toEqual(at(2026, 10, 19, 9, 0));
    expect(next('every monday at 18:00', at(2026, 10, 20, 9, 0))).toEqual(at(2026, 10, 26, 18, 0));
  });

  it('converts meridiem times', () => {
    expect(next('daily at 9pm', at(2026, 10, 19, 0, 0))).toEqual(at(2026, 10, 19, 21, 0));
    expect(next('daily at 12am', at(2026, 10, 19, 12, 30))).toEqual(at(2026, 10, 20, 0, 0));
  });

  it('follows five-field cron', () => {
    expect(next('*/5 * * * *', at(2026, 10, 19, 10, 2))).toEqual(at(2026, 10, 19, 10, 5));
    expect(next('0 4 1 * *', at(2026, 10, 19, 10, 0))).toEqual(at(2026, 11, 1, 4, 0));
  });
});
