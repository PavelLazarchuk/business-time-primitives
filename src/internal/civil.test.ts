import { describe, expect, it } from 'vitest';
import {
    MONTH_DAYS_OF_LEAP_YEAR,
    civilFromDay,
    dayFromCivil,
    formatDay,
    formatTimeOfDay,
    monthDayOf,
    parseDay,
    parseMonthDay,
    weekdayOf,
} from './civil';

describe('civil day numbers', () => {
    it('format and parse years outside 0000–9999 in ISO expanded form', () => {
        for (const year of [-271_821, -50, -1, 10_000, 275_760]) {
            const day = dayFromCivil(year, 6, 10);
            const text = formatDay(day);
            const date = new Date(day * 86_400_000).toISOString().slice(0, -14);
            expect(text).toBe(date);
            expect(parseDay(text)).toBe(day);
        }
        expect(formatDay(dayFromCivil(0, 1, 1))).toBe('0000-01-01');
        expect(parseDay('-000000-01-01')).toBeNull();
        expect(parseDay('-0050-06-10')).toBeNull();
    });

    it('agree with Date.UTC for every day across four centuries', () => {
        for (let day = -40_000; day <= 110_000; day += 1) {
            const date = new Date(day * 86_400_000);
            const civil: [number, number, number] = [
                date.getUTCFullYear(),
                date.getUTCMonth() + 1,
                date.getUTCDate(),
            ];
            if (dayFromCivil(...civil) !== day) expect(dayFromCivil(...civil)).toBe(day);
            const back = civilFromDay(day);
            if (back.join() !== civil.join()) expect(back).toEqual(civil);
        }
    });

    it('handle years Date.UTC maps to the 1900s', () => {
        expect(civilFromDay(dayFromCivil(50, 3, 1))).toEqual([50, 3, 1]);
        expect(formatDay(dayFromCivil(5, 1, 2))).toBe('0005-01-02');
    });

    it('know the weekday, Monday first', () => {
        expect(weekdayOf(0)).toBe(3);
        expect(weekdayOf(dayFromCivil(2026, 10, 5))).toBe(0);
        expect(weekdayOf(dayFromCivil(2026, 10, 4))).toBe(6);
        expect(weekdayOf(-1)).toBe(2);
    });

    it('give month-day keys', () => {
        expect(monthDayOf(dayFromCivil(2024, 2, 29))).toBe(229);
        expect(monthDayOf(dayFromCivil(2026, 12, 25))).toBe(1225);
    });
});

describe('date keys', () => {
    it('parse real calendar dates only', () => {
        expect(parseDay('2026-10-05')).toBe(dayFromCivil(2026, 10, 5));
        expect(parseDay('2024-02-29')).toBe(dayFromCivil(2024, 2, 29));
        for (const bad of [
            '2026-02-29',
            '2026-13-01',
            '2026-00-10',
            '2026-01-00',
            '2026-1-1',
            'x',
        ]) {
            expect(parseDay(bad)).toBeNull();
        }
    });

    it('parse yearly month-days, including February 29', () => {
        expect(parseMonthDay('--12-25')).toBe(1225);
        expect(parseMonthDay('--02-29')).toBe(229);
        for (const bad of ['--02-30', '--13-01', '--00-01', '--04-00', '12-25', '--1-1']) {
            expect(parseMonthDay(bad)).toBeNull();
        }
    });

    it('list every month-day of a leap year in order', () => {
        expect(MONTH_DAYS_OF_LEAP_YEAR).toHaveLength(366);
        expect(MONTH_DAYS_OF_LEAP_YEAR[0]).toBe(101);
        expect(MONTH_DAYS_OF_LEAP_YEAR[59]).toBe(229);
        expect(MONTH_DAYS_OF_LEAP_YEAR[365]).toBe(1231);
    });

    it('format times of day, with seconds only when they matter', () => {
        expect(formatTimeOfDay(9 * 3_600_000)).toBe('09:00');
        expect(formatTimeOfDay(9 * 3_600_000 + 30_000)).toBe('09:00:30');
        expect(formatTimeOfDay(0)).toBe('00:00');
    });
});
