import { compile, type CompiledCalendar } from './calendar';
import { checkSpan, toDuration, toInstant } from './internal/input';
import { openBackward, openForward } from './internal/segments';
import type { BusinessCalendar, DurationInput, InstantInput } from './types';

export function tryWalkBusinessTime(
    calendar: CompiledCalendar,
    start: number,
    amount: number
): number | null {
    if (amount === 0) return start;
    let left = Math.abs(amount);
    if (amount > 0) {
        for (const [segmentStart, segmentEnd] of openForward(calendar, start)) {
            if (left <= segmentEnd - segmentStart) return segmentStart + left;
            left -= segmentEnd - segmentStart;
        }
    } else {
        for (const [segmentStart, segmentEnd] of openBackward(calendar, start)) {
            if (left <= segmentEnd - segmentStart) return segmentEnd - left;
            left -= segmentEnd - segmentStart;
        }
    }
    return null;
}

export function walkBusinessTime(
    calendar: CompiledCalendar,
    start: number,
    amount: number,
    action: string
): number {
    const end = tryWalkBusinessTime(calendar, start, amount);
    if (end === null) {
        throw new RangeError(
            `${action}: the calendar has no business time left ${amount > 0 ? 'after' : 'before'} ${new Date(start).toISOString()}`
        );
    }
    return end;
}

export function addBusinessTime(
    calendar: BusinessCalendar,
    from: InstantInput,
    duration: DurationInput
): Date {
    const compiled = compile(calendar);
    const start = toInstant(from, 'from');
    return new Date(
        walkBusinessTime(compiled, start, toDuration(duration, 'duration'), 'addBusinessTime')
    );
}

export function subtractBusinessTime(
    calendar: BusinessCalendar,
    until: InstantInput,
    duration: DurationInput
): Date {
    const compiled = compile(calendar);
    const end = toInstant(until, 'until');
    return new Date(
        walkBusinessTime(compiled, end, -toDuration(duration, 'duration'), 'subtractBusinessTime')
    );
}

export function businessTimeWithin(calendar: CompiledCalendar, a: number, b: number): number {
    let total = 0;
    for (const [segmentStart, segmentEnd] of openForward(calendar, a, b)) {
        total += segmentEnd - segmentStart;
    }
    return total;
}

export function businessTimeBetween(
    calendar: BusinessCalendar,
    start: InstantInput,
    end: InstantInput
): number {
    const compiled = compile(calendar);
    const a = toInstant(start, 'start');
    const b = toInstant(end, 'end');
    checkSpan(a, b, 'businessTimeBetween');
    const total = businessTimeWithin(compiled, Math.min(a, b), Math.max(a, b));
    return a <= b ? total : -total;
}
