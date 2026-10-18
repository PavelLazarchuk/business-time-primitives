import { shiftsOn, type CompiledCalendar } from '../calendar';
import { DAY_MS, HOUR_MS } from './civil';
import { MAX_INSTANT } from './input';
import { dayOf, instantOf } from './zone';

export type Segment = [start: number, end: number];

export const MAX_IDLE_DAYS = 3660;

const MAX_AHEAD = 14 * HOUR_MS;
const SPLIT_AFTER = 2 * DAY_MS;
const BACKWARD_WINDOWS = [7, 30, 90, 366].map(days => days * DAY_MS);
export const FIRST_SAFE_DAY = -MAX_INSTANT / DAY_MS + 3;
export const LAST_SAFE_DAY = MAX_INSTANT / DAY_MS - 3;

export const countsAsIdle = (calendar: CompiledCalendar, day: number) =>
    day < calendar.datedFrom || day > calendar.datedTo;

function insert(pending: Segment[], start: number, end: number): void {
    let index = 0;
    while (index < pending.length && (pending[index] as Segment)[1] < start) index += 1;
    let removed = 0;
    let merged: Segment = [start, end];
    for (let next = pending[index]; next && next[0] <= merged[1]; next = pending[index + removed]) {
        merged = [Math.min(merged[0], next[0]), Math.max(merged[1], next[1])];
        removed += 1;
    }
    pending.splice(index, removed, merged);
}

export function* openForward(
    calendar: CompiledCalendar,
    from: number,
    to = Infinity
): Generator<Segment, void, undefined> {
    if (!(from < to)) return;
    const clip = ([start, end]: Segment): Segment | null => {
        const clippedStart = Math.max(start, from);
        const clippedEnd = Math.min(end, to);
        return clippedStart < clippedEnd ? [clippedStart, clippedEnd] : null;
    };

    let day = Math.max(dayOf(calendar, from) - 3, calendar.firstDay, FIRST_SAFE_DAY);
    const lastDay = Math.min(calendar.lastDay, LAST_SAFE_DAY);
    let idle = 0;
    const pending: Segment[] = [];

    while (day <= lastDay && idle <= MAX_IDLE_DAYS) {
        const shifts = shiftsOn(calendar, day);
        if (shifts.length === 0) {
            if (countsAsIdle(calendar, day)) idle += 1;
        } else {
            idle = 0;
            const midnight = day * DAY_MS;
            for (const [shiftStart, shiftEnd] of shifts) {
                const start = instantOf(calendar, midnight + shiftStart);
                const end = instantOf(calendar, midnight + shiftEnd);
                if (start < end) insert(pending, start, end);
            }
        }
        day += 1;

        const horizon = day * DAY_MS - MAX_AHEAD;
        while (pending.length > 0) {
            const head = pending[0] as Segment;
            if (head[1] < horizon) {
                pending.shift();
                const segment = clip(head);
                if (segment) yield segment;
                continue;
            }
            if (head[0] < horizon - SPLIT_AFTER) {
                const segment = clip([head[0], horizon]);
                head[0] = horizon;
                if (segment) yield segment;
            }
            break;
        }
        if (horizon >= to) break;
    }

    for (const rest of pending) {
        const segment = clip(rest);
        if (segment) yield segment;
    }
}

export function* openBackward(
    calendar: CompiledCalendar,
    from: number
): Generator<Segment, void, undefined> {
    const floor = Math.max(calendar.firstDay * DAY_MS - MAX_AHEAD, FIRST_SAFE_DAY * DAY_MS);
    const ceiling = (calendar.lastDay + 3) * DAY_MS;
    let high = Math.min(from, ceiling);
    let idle = 0;
    let window = 0;

    while (high > floor && idle <= MAX_IDLE_DAYS * DAY_MS) {
        const low = Math.max(high - (BACKWARD_WINDOWS[window] as number), floor);
        const segments = [...openForward(calendar, low, high)];
        for (let index = segments.length - 1; index >= 0; index -= 1) {
            yield segments[index] as Segment;
        }
        const outsideDated =
            Math.floor(high / DAY_MS) + 1 < calendar.datedFrom ||
            Math.floor(low / DAY_MS) - 1 > calendar.datedTo;
        if (segments.length > 0) idle = 0;
        else if (outsideDated) idle += high - low;
        high = low;
        window = Math.min(window + 1, BACKWARD_WINDOWS.length - 1);
    }
}

export function firstOpenAt(calendar: CompiledCalendar, from: number): number | null {
    for (const [start] of openForward(calendar, from)) return start;
    return null;
}
