import type { DateInput, DurationInput, InstantInput } from '../types';
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS, parseDay } from './civil';
import { dayOf, type Zone } from './zone';

export const MAX_INSTANT = 8.64e15;

export const MAX_SPAN = 100 * 366 * DAY_MS;

const isDate = (value: unknown): value is Date =>
    Object.prototype.toString.call(value) === '[object Date]';

export function toInstant(value: InstantInput, name: string): number {
    let ms: unknown;
    if (isDate(value)) ms = Date.prototype.getTime.call(value);
    else if (typeof value === 'number') ms = value;
    else if (typeof value === 'object' && value !== null && 'epochMilliseconds' in value) {
        ms = value.epochMilliseconds;
    } else {
        throw new TypeError(
            `${name}: expected a Date, epoch milliseconds or a Temporal instant, got ${value === null ? 'null' : typeof value}`
        );
    }
    if (typeof ms !== 'number' || !Number.isFinite(ms)) {
        throw new RangeError(`${name}: not a valid point in time`);
    }
    if (Math.abs(ms) > MAX_INSTANT) {
        throw new RangeError(`${name}: ${ms} is outside the range a Date can hold (±8.64e15 ms)`);
    }
    return ms;
}

const TIME_UNITS: readonly (readonly [string, number])[] = [
    ['hours', HOUR_MS],
    ['minutes', MINUTE_MS],
    ['seconds', SECOND_MS],
    ['milliseconds', 1],
    ['microseconds', 1e-3],
    ['nanoseconds', 1e-6],
];
const CALENDAR_UNITS = ['years', 'months', 'weeks', 'days'];
const KNOWN_UNITS = new Set([...TIME_UNITS.map(([unit]) => unit), ...CALENDAR_UNITS]);

export function toDuration(value: DurationInput, name: string): number {
    let total = 0;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new RangeError(`${name}: not a finite number`);
        total = value;
    } else if (typeof value === 'object' && value !== null) {
        const parts = value as Readonly<Record<string, unknown>>;
        for (const key of Object.keys(parts)) {
            if (!KNOWN_UNITS.has(key)) {
                throw new TypeError(
                    `${name}: unknown unit ${JSON.stringify(key)} — expected hours, minutes, seconds or milliseconds`
                );
            }
        }
        for (const unit of CALENDAR_UNITS) {
            const amount = parts[unit];
            if (amount !== undefined && amount !== 0) {
                throw new TypeError(
                    `${name}: '${unit}' of business time are ambiguous — use hours, or addBusinessDays() for whole business days`
                );
            }
        }
        for (const [unit, size] of TIME_UNITS) {
            const amount = parts[unit];
            if (amount === undefined) continue;
            if (typeof amount !== 'number' || !Number.isFinite(amount)) {
                throw new RangeError(`${name}.${unit}: not a finite number`);
            }
            total += amount * size;
        }
    } else {
        throw new TypeError(
            `${name}: expected milliseconds or { hours, minutes, seconds, milliseconds }, got ${value === null ? 'null' : typeof value}`
        );
    }
    if (Math.abs(total) > MAX_SPAN) {
        throw new RangeError(`${name}: more than 100 years of business time`);
    }
    return total;
}

export function checkSpan(start: number, end: number, name: string): void {
    if (Math.abs(end - start) > MAX_SPAN) {
        throw new RangeError(`${name}: spans more than 100 years`);
    }
}

export function toDay(zone: Zone, value: DateInput, name: string): number {
    if (typeof value !== 'string') return dayOf(zone, toInstant(value, name));
    const day = parseDay(value);
    if (day === null) {
        throw new RangeError(`${name}: ${JSON.stringify(value)} is not a 'YYYY-MM-DD' date`);
    }
    return day;
}
