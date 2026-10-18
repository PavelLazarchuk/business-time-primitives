import { compile, formatShift, shiftsOn } from './calendar';
import { DAY_MS } from './internal/civil';
import { checkSpan, toDay, toInstant } from './internal/input';
import { openForward } from './internal/segments';
import type { BusinessCalendar, DateInput, InstantInput, Interval, OpenStatus } from './types';

const CLOSING_HORIZON = 366 * DAY_MS;

export function isOpen(calendar: BusinessCalendar, at: InstantInput): boolean {
    const instant = toInstant(at, 'at');
    for (const segment of openForward(compile(calendar), instant, instant + 1)) {
        return segment[0] === instant;
    }
    return false;
}

export function openStatus(calendar: BusinessCalendar, at: InstantInput): OpenStatus {
    const instant = toInstant(at, 'at');
    const segments = openForward(compile(calendar), instant);
    const first = segments.next();
    if (first.done) return { open: false, opensAt: null };

    const [start, firstEnd] = first.value;
    if (start > instant) {
        segments.return();
        return { open: false, opensAt: new Date(start) };
    }
    let end = firstEnd;
    for (const [segmentStart, segmentEnd] of segments) {
        if (segmentStart !== end) break;
        end = segmentEnd;
        if (end - instant > CLOSING_HORIZON) return { open: true, closesAt: null };
    }
    return { open: true, closesAt: new Date(end) };
}

export function openIntervals(
    calendar: BusinessCalendar,
    from: InstantInput,
    to: InstantInput
): Interval[] {
    const compiled = compile(calendar);
    const start = toInstant(from, 'from');
    const end = toInstant(to, 'to');
    checkSpan(start, end, 'openIntervals');
    const merged: [number, number][] = [];
    const segments = openForward(compiled, start, end);
    for (const [start, end] of segments) {
        const last = merged[merged.length - 1];
        if (last && last[1] === start) last[1] = end;
        else merged.push([start, end]);
    }
    return merged.map(([start, end]) => ({ start: new Date(start), end: new Date(end) }));
}

export function hoursOn(calendar: BusinessCalendar, date: DateInput): string[] {
    const compiled = compile(calendar);
    return shiftsOn(compiled, toDay(compiled, date, 'date')).map(formatShift);
}
