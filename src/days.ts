import { compile, parseTime, shiftsOn, type CompiledCalendar } from './calendar';
import { DAY_MS, formatDay } from './internal/civil';
import { MAX_SPAN, toDay, toInstant } from './internal/input';
import { FIRST_SAFE_DAY, LAST_SAFE_DAY, MAX_IDLE_DAYS, countsAsIdle } from './internal/segments';
import { dayOf, wallOf } from './internal/zone';
import type { BusinessCalendar, DateInput, InstantInput } from './types';

const isBusiness = (calendar: CompiledCalendar, day: number) => shiftsOn(calendar, day).length > 0;

function stepBusinessDays(
    calendar: CompiledCalendar,
    day: number,
    amount: number,
    action: string
): number {
    const step = amount < 0 ? -1 : 1;
    let current = day;
    let left = Math.abs(amount);
    let idle = 0;
    const fail = (): never => {
        throw new RangeError(
            `${action}: the calendar runs out of business days ${step > 0 ? 'after' : 'before'} ${formatDay(day)}`
        );
    };
    while (left > 0) {
        if (step > 0 && current < calendar.firstDay - 1) current = calendar.firstDay - 1;
        if (step < 0 && current > calendar.lastDay + 1) current = calendar.lastDay + 1;
        current += step;
        const beyond = step > 0 ? current > calendar.lastDay : current < calendar.firstDay;
        if (beyond || current <= FIRST_SAFE_DAY || current >= LAST_SAFE_DAY) fail();
        if (isBusiness(calendar, current)) {
            left -= 1;
            idle = 0;
        } else if (countsAsIdle(calendar, current) && ++idle > MAX_IDLE_DAYS) {
            fail();
        }
    }
    return current;
}

const MAX_SPAN_DAYS = MAX_SPAN / DAY_MS;

export function isBusinessDay(calendar: BusinessCalendar, date: DateInput): boolean {
    const compiled = compile(calendar);
    return isBusiness(compiled, toDay(compiled, date, 'date'));
}

export function addBusinessDays(
    calendar: BusinessCalendar,
    date: DateInput,
    amount: number
): string {
    if (!Number.isInteger(amount)) {
        throw new RangeError(`addBusinessDays: amount must be an integer, got ${amount}`);
    }
    if (Math.abs(amount) > MAX_SPAN_DAYS) {
        throw new RangeError(`addBusinessDays: more than ${MAX_SPAN_DAYS} business days`);
    }
    const compiled = compile(calendar);
    return formatDay(
        stepBusinessDays(compiled, toDay(compiled, date, 'date'), amount, 'addBusinessDays')
    );
}

export function businessDaysBetween(
    calendar: BusinessCalendar,
    start: DateInput,
    end: DateInput
): number {
    const compiled = compile(calendar);
    const a = toDay(compiled, start, 'start');
    const b = toDay(compiled, end, 'end');
    if (Math.abs(b - a) > MAX_SPAN_DAYS) {
        throw new RangeError('businessDaysBetween: spans more than 100 years');
    }
    let count = 0;
    if (a <= b) {
        for (let day = a + 1; day <= b; day += 1) if (isBusiness(compiled, day)) count += 1;
        return count;
    }
    for (let day = b; day < a; day += 1) if (isBusiness(compiled, day)) count += 1;
    return -count;
}

export interface BusinessDateOptions {
    readonly cutoff?: string;
}

export function businessDateOf(
    calendar: BusinessCalendar,
    at: InstantInput,
    options: BusinessDateOptions = {}
): string {
    const compiled = compile(calendar);
    let cutoff = DAY_MS;
    if (options.cutoff !== undefined) {
        const parsed = typeof options.cutoff === 'string' ? parseTime(options.cutoff) : null;
        if (parsed === null) {
            throw new RangeError(
                `businessDateOf: cutoff ${JSON.stringify(options.cutoff)} is not a time — expected 'HH:mm'`
            );
        }
        cutoff = parsed;
    }
    const wall = wallOf(compiled, toInstant(at, 'at'));
    const day = Math.floor(wall / DAY_MS);
    if (isBusiness(compiled, day) && wall - day * DAY_MS < cutoff) return formatDay(day);
    return formatDay(stepBusinessDays(compiled, day, 1, 'businessDateOf'));
}

export function localDate(calendar: BusinessCalendar, at: InstantInput): string {
    const compiled = compile(calendar);
    return formatDay(dayOf(compiled, toInstant(at, 'at')));
}
