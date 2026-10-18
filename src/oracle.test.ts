import { describe, expect, it } from 'vitest';
import { isOpen, openIntervals } from './hours';
import { addBusinessTime, businessTimeBetween, subtractBusinessTime } from './time';
import { DAY, HOUR, MINUTE, at, random, referenceOffset, referenceWall } from './testUtils';
import type { BusinessCalendar } from './types';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const pad = (value: number) => String(value).padStart(2, '0');
const clock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

interface Shift {
    readonly start: number;
    readonly end: number;
}

interface Case {
    readonly calendar: BusinessCalendar;
    readonly shifts: readonly (readonly Shift[])[];
}

function everyDay(timeZone: string, start: number, length: number): Case {
    const end = start + length;
    const endText = end % 1440 === 0 ? '24:00' : clock(end % 1440);
    const shift = { start: start * MINUTE, end: end * MINUTE };
    return {
        calendar: { timeZone, week: { 'mon-sun': `${clock(start)}-${endText}` } },
        shifts: WEEKDAYS.map(() => [shift]),
    };
}

function randomCalendar(seed: number, timeZone: string): Case {
    const rng = random(seed);
    const week: Record<string, string[]> = {};
    const shifts: Shift[][] = [];
    for (const day of WEEKDAYS) {
        const list: Shift[] = [];
        const hours: string[] = [];
        for (let count = rng.int(3); count > 0; count -= 1) {
            const start = rng.pick([
                0,
                30,
                60,
                90,
                120,
                150,
                180,
                540,
                1320,
                1410,
                rng.int(96) * 15,
            ]);
            let end = rng.pick([
                start + 30,
                start + 90,
                start + 480,
                start - 60,
                1440,
                rng.int(96) * 15,
            ]);
            if (end === start || end < 0) end = start + 45;
            hours.push(`${clock(start)}-${end % 1440 === 0 ? '24:00' : clock(end % 1440)}`);
            const endOfDay = end % 1440 === 0 ? 1440 : end % 1440;
            list.push({
                start: start * MINUTE,
                end: (endOfDay > start ? endOfDay : endOfDay + 1440) * MINUTE,
            });
        }
        week[day] = hours;
        shifts.push(list);
    }
    return { calendar: { timeZone, week }, shifts };
}

function hunters(timeZone: string, transition: number): Case[] {
    const before = referenceWall(timeZone, transition - MINUTE) + MINUTE;
    const after = referenceWall(timeZone, transition);
    const low = Math.min(before, after);
    const middle = low + Math.floor(Math.abs(after - before) / 2 / MINUTE) * MINUTE;
    const minuteOfDay = (((middle % DAY) + DAY) % DAY) / MINUTE;
    return [
        everyDay(timeZone, minuteOfDay, 180),
        everyDay(timeZone, (minuteOfDay + 1440 - 180) % 1440, 180),
    ];
}

function wallsOf(timeZone: string, from: number, to: number): Float64Array {
    let runningMax = -Infinity;
    for (let t = from - 2 * DAY; t < from; t += MINUTE) {
        runningMax = Math.max(runningMax, referenceWall(timeZone, t));
    }
    const walls = new Float64Array((to - from) / MINUTE);
    for (let index = 0; index < walls.length; index += 1) {
        runningMax = Math.max(runningMax, referenceWall(timeZone, from + index * MINUTE));
        walls[index] = runningMax;
    }
    return walls;
}

function modelIntervals(shifts: Case['shifts'], walls: Float64Array, from: number) {
    const open: [number, number][] = [];
    walls.forEach((wall, index) => {
        const today = Math.floor(wall / DAY);
        const isOpenNow = [today - 1, today].some(day => {
            const weekday = (((day + 3) % 7) + 7) % 7;
            return (shifts[weekday] as Shift[]).some(
                shift => day * DAY + shift.start <= wall && wall < day * DAY + shift.end
            );
        });
        if (!isOpenNow) return;
        const t = from + index * MINUTE;
        const last = open[open.length - 1];
        if (last && last[1] === t) last[1] = t + MINUTE;
        else open.push([t, t + MINUTE]);
    });
    return open;
}

function transitions(timeZone: string, fromYear: number, toYear: number): number[] {
    const found: number[] = [];
    let previous = Date.UTC(fromYear, 0, 1);
    for (let t = previous + DAY; t <= Date.UTC(toYear, 0, 1); t += DAY) {
        if (referenceOffset(timeZone, previous) !== referenceOffset(timeZone, t)) {
            let low = previous;
            let high = t;
            while (high - low > MINUTE) {
                const middle = low + Math.floor((high - low) / 2 / MINUTE) * MINUTE;
                if (referenceOffset(timeZone, middle) === referenceOffset(timeZone, previous)) {
                    low = middle;
                } else {
                    high = middle;
                }
            }
            found.push(high);
        }
        previous = t;
    }
    return found;
}

const ZONES = [
    'America/New_York',
    'Europe/Berlin',
    'Europe/London',
    'Australia/Lord_Howe',
    'America/Santiago',
    'America/Havana',
    'America/St_Johns',
    'Pacific/Chatham',
    'Africa/Casablanca',
    'Asia/Kolkata',
    'Asia/Kathmandu',
    'UTC',
];

const windows: [string, number, number | null][] = [
    ...ZONES.flatMap(zone => [
        ...transitions(zone, 2026, 2027).map(
            instant =>
                [zone, Math.floor(instant / HOUR) * HOUR - 2 * DAY, instant] as [
                    string,
                    number,
                    number,
                ]
        ),
        [zone, at('2026-07-13T00:00:00Z'), null] as [string, number, null],
    ]),
    ['Pacific/Apia', at('2011-12-28T00:00:00Z'), at('2011-12-30T10:00:00Z')],
];

describe('agreement with a minute-by-minute model', () => {
    it('finds the expected transitions to test around', () => {
        expect(transitions('America/New_York', 2026, 2027)).toEqual([
            at('2026-03-08T07:00:00Z'),
            at('2026-11-01T06:00:00Z'),
        ]);
        expect(transitions('Pacific/Apia', 2011, 2012)).toContain(at('2011-12-30T10:00:00Z'));
        expect(windows.length).toBeGreaterThan(25);
    });

    it.each(windows)('%s from %d', (timeZone, from, transition) => {
        const to = from + 4 * DAY;
        const walls = wallsOf(timeZone, from, to);
        const cases = [
            ...(transition === null ? [] : hunters(timeZone, transition)),
            ...[1, 2, 3].map(seed => randomCalendar(seed * 7919 + from / MINUTE, timeZone)),
        ];
        for (const { calendar, shifts } of cases) {
            const label = JSON.stringify(calendar.week);
            const expected = modelIntervals(shifts, walls, from);
            const actual = openIntervals(calendar, from, to).map(({ start, end }) => [
                start.getTime(),
                end.getTime(),
            ]);
            expect(actual, label).toEqual(expected);

            const total = expected.reduce((sum, [start, end]) => sum + end - start, 0);
            expect(businessTimeBetween(calendar, from, to), label).toBe(total);

            const rng = random(from / MINUTE);
            for (let probe = 0; probe < 20; probe += 1) {
                const t = from + rng.int(4 * 24 * 60) * MINUTE;
                const inModel = expected.some(([start, end]) => start <= t && t < end);
                expect(isOpen(calendar, t), `${label} at ${new Date(t).toISOString()}`).toBe(
                    inModel
                );

                const duration = (1 + rng.int(36 * 60)) * MINUTE;
                const due = addBusinessTime(calendar, t, duration).getTime();
                expect(businessTimeBetween(calendar, t, due)).toBe(duration);
                const start = subtractBusinessTime(calendar, t, duration).getTime();
                expect(businessTimeBetween(calendar, start, t)).toBe(duration);
            }
        }
    });
});
