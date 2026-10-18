import { DAY_MS, SECOND_MS, dayFromCivil } from './civil';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            era: 'short',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        });
        formatters.set(timeZone, formatter);
    }
    return formatter;
}

const UTC_NAMES = new Set(['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT', 'Etc/Universal', 'Etc/Zulu']);

export function checkTimeZone(timeZone: string): boolean {
    const resolved = formatterFor(timeZone).resolvedOptions().timeZone;
    return UTC_NAMES.has(resolved);
}

export interface Zone {
    readonly timeZone: string;
    readonly utc: boolean;
}

export function wallOf(zone: Zone, instant: number): number {
    if (zone.utc) return instant;
    const subSecond = ((instant % SECOND_MS) + SECOND_MS) % SECOND_MS;
    const whole = instant - subSecond;
    let year = 0;
    let month = 1;
    let day = 1;
    let hour = 0;
    let minute = 0;
    let second = 0;
    let beforeChrist = false;
    for (const part of formatterFor(zone.timeZone).formatToParts(whole)) {
        switch (part.type) {
            case 'year':
                year = Number(part.value);
                break;
            case 'month':
                month = Number(part.value);
                break;
            case 'day':
                day = Number(part.value);
                break;
            case 'hour':
                hour = Number(part.value) % 24;
                break;
            case 'minute':
                minute = Number(part.value);
                break;
            case 'second':
                second = Number(part.value);
                break;
            case 'era':
                beforeChrist = part.value === 'BC';
                break;
        }
    }
    if (beforeChrist) year = 1 - year;
    return (
        dayFromCivil(year, month, day) * DAY_MS +
        ((hour * 60 + minute) * 60 + second) * SECOND_MS +
        subSecond
    );
}

const offsetAt = (zone: Zone, instant: number) => wallOf(zone, instant) - instant;

const resolved = new Map<string, Map<number, number>>();
const MEMO_LIMIT = 50_000;

export function instantOf(zone: Zone, wall: number): number {
    if (zone.utc) return wall;
    let memo = resolved.get(zone.timeZone);
    if (!memo) {
        memo = new Map();
        resolved.set(zone.timeZone, memo);
    }
    const hit = memo.get(wall);
    if (hit !== undefined) return hit;
    const instant = resolve(zone, wall);
    if (memo.size >= MEMO_LIMIT) memo.clear();
    memo.set(wall, instant);
    return instant;
}

function resolve(zone: Zone, wall: number): number {
    const before = offsetAt(zone, wall - DAY_MS);
    const after = offsetAt(zone, wall + DAY_MS);
    if (before === after) return wall - before;

    const early = wall - before;
    const late = wall - after;
    const earlyFits = offsetAt(zone, early) === before;
    const lateFits = offsetAt(zone, late) === after;
    if (earlyFits && lateFits) return Math.min(early, late);
    if (earlyFits) return early;
    if (lateFits) return late;

    let low = Math.min(early, late);
    let high = Math.max(early, late);
    while (high - low > SECOND_MS) {
        const middle =
            low + Math.max(SECOND_MS, Math.floor((high - low) / (2 * SECOND_MS)) * SECOND_MS);
        if (wallOf(zone, middle) >= wall) high = middle;
        else low = middle;
    }
    return high;
}

export function dayOf(zone: Zone, instant: number): number {
    return Math.floor(wallOf(zone, instant) / DAY_MS);
}
