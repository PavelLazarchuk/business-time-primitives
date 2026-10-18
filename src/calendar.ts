import {
    DAY_MS,
    HOUR_MS,
    MINUTE_MS,
    MONTH_DAYS_OF_LEAP_YEAR,
    SECOND_MS,
    formatTimeOfDay,
    monthDayOf,
    parseDay,
    parseMonthDay,
    weekdayOf,
} from './internal/civil';
import { checkTimeZone, type Zone } from './internal/zone';
import type { BusinessCalendar, CalendarIssue, Weekday } from './types';

export type Shift = readonly [start: number, end: number];

export interface CompiledCalendar extends Zone {
    readonly week: readonly (readonly Shift[])[];
    readonly dated: ReadonlyMap<number, readonly Shift[]>;
    readonly yearly: ReadonlyMap<number, readonly Shift[]>;
    readonly firstDay: number;
    readonly lastDay: number;
    readonly datedFrom: number;
    readonly datedTo: number;
}

export class BusinessCalendarError extends RangeError {
    readonly issues: readonly CalendarIssue[];

    constructor(issues: readonly CalendarIssue[]) {
        super(
            `Invalid business calendar:\n${issues.map(({ path, message }) => `  ${path}: ${message}`).join('\n')}`
        );
        this.name = 'BusinessCalendarError';
        this.issues = issues;
    }
}

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const CALENDAR_KEYS = new Set(['timeZone', 'week', 'holidays', 'overrides']);
const MAX_RANGE_DAYS = 3660;
const NO_SHIFTS: readonly Shift[] = Object.freeze([]);
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const show = (value: unknown): string =>
    typeof value === 'string'
        ? JSON.stringify(value)
        : Array.isArray(value)
          ? 'an array'
          : value === null
            ? 'null'
            : typeof value;

export function parseTime(text: string): number | null {
    const match = TIME.exec(text);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = match[3] === undefined ? 0 : Number(match[3]);
    if (minutes > 59 || seconds > 59) return null;
    if (hours === 24 && minutes === 0 && seconds === 0) return DAY_MS;
    if (hours > 23) return null;
    return hours * HOUR_MS + minutes * MINUTE_MS + seconds * SECOND_MS;
}

function parseHours(input: unknown, path: string, issues: CalendarIssue[]): Shift[] {
    const list: readonly unknown[] | null =
        typeof input === 'string' ? [input] : Array.isArray(input) ? input : null;
    if (list === null) {
        issues.push({
            path,
            message: `expected 'HH:mm-HH:mm', a list of them, or [] for closed — got ${show(input)}`,
        });
        return [];
    }
    const shifts: Shift[] = [];
    list.forEach((item, index) => {
        const itemPath = typeof input === 'string' ? path : `${path}[${index}]`;
        if (typeof item !== 'string') {
            issues.push({ path: itemPath, message: `expected 'HH:mm-HH:mm', got ${show(item)}` });
            return;
        }
        const parts = item.split('-').map(part => part.trim());
        if (parts.length !== 2) {
            issues.push({
                path: itemPath,
                message: `${show(item)} is not a range — expected 'HH:mm-HH:mm'`,
            });
            return;
        }
        const [startText = '', endText = ''] = parts;
        const start = parseTime(startText);
        const end = parseTime(endText);
        if (start === null || start === DAY_MS) {
            issues.push({
                path: itemPath,
                message: `${show(startText)} is not a start time — expected 00:00 to 23:59:59`,
            });
            return;
        }
        if (end === null) {
            issues.push({
                path: itemPath,
                message: `${show(endText)} is not an end time — expected 00:00 to 24:00`,
            });
            return;
        }
        if (end === start) {
            issues.push({
                path: itemPath,
                message: `${show(item)} is empty — use '00:00-24:00' for a whole day`,
            });
            return;
        }
        shifts.push([start, end > start ? end : end + DAY_MS]);
    });
    return shifts.sort((a, b) => a[0] - b[0]);
}

function parseWeekKey(key: string): number[] | null {
    const days: number[] = [];
    for (const token of key.split(',')) {
        const bounds = token.split('-').map(part => WEEKDAYS.indexOf(part.trim() as Weekday));
        if (bounds.length > 2 || bounds.some(index => index < 0)) return null;
        const first = bounds[0] as number;
        const last = bounds[bounds.length - 1] as number;
        for (let index = first; ; index = (index + 1) % 7) {
            days.push(index);
            if (index === last) break;
        }
    }
    return days;
}

type DateKey =
    | { readonly kind: 'dated'; readonly keys: number[]; readonly single: boolean }
    | { readonly kind: 'yearly'; readonly keys: number[]; readonly single: boolean };

function parseDateKey(text: string): DateKey | string {
    const bounds = text.split('/');
    const [from = '', to = from] = bounds;
    if (bounds.length <= 2) {
        const firstDay = parseDay(from);
        const lastDay = parseDay(to);
        if (firstDay !== null && lastDay !== null) {
            if (lastDay < firstDay) return `${show(text)} ends before it starts`;
            if (lastDay - firstDay >= MAX_RANGE_DAYS) {
                return `${show(text)} spans more than ${MAX_RANGE_DAYS} days`;
            }
            const keys: number[] = [];
            for (let day = firstDay; day <= lastDay; day += 1) keys.push(day);
            return { kind: 'dated', keys, single: bounds.length === 1 };
        }
        const firstCode = parseMonthDay(from);
        const lastCode = parseMonthDay(to);
        if (firstCode !== null && lastCode !== null) {
            const keys: number[] = [];
            const start = MONTH_DAYS_OF_LEAP_YEAR.indexOf(firstCode);
            for (let index = start; ; index = (index + 1) % MONTH_DAYS_OF_LEAP_YEAR.length) {
                const code = MONTH_DAYS_OF_LEAP_YEAR[index] as number;
                keys.push(code);
                if (code === lastCode) break;
            }
            return { kind: 'yearly', keys, single: bounds.length === 1 };
        }
    }
    return `${show(text)} is not a date — expected 'YYYY-MM-DD', '--MM-DD' (every year) or a 'start/end' range of the same kind`;
}

interface DateRules {
    readonly singleOverrides: Map<number, readonly Shift[]>;
    readonly rangeOverrides: Map<number, readonly Shift[]>;
    readonly rangeOwners: Map<number, string>;
    readonly singleHolidays: Set<number>;
    readonly rangeHolidays: Set<number>;
}

const emptyRules = (): DateRules => ({
    singleOverrides: new Map(),
    rangeOverrides: new Map(),
    rangeOwners: new Map(),
    singleHolidays: new Set(),
    rangeHolidays: new Set(),
});

function resolveRules(rules: DateRules): Map<number, readonly Shift[]> {
    const resolved = new Map<number, readonly Shift[]>();
    for (const key of rules.rangeHolidays) resolved.set(key, NO_SHIFTS);
    for (const [key, shifts] of rules.rangeOverrides) resolved.set(key, shifts);
    for (const key of rules.singleHolidays) resolved.set(key, NO_SHIFTS);
    for (const [key, shifts] of rules.singleOverrides) resolved.set(key, shifts);
    return resolved;
}

function analyze(input: unknown): { issues: CalendarIssue[]; compiled: CompiledCalendar } {
    const issues: CalendarIssue[] = [];
    const week: Shift[][] = WEEKDAYS.map(() => []);
    const rules = { dated: emptyRules(), yearly: emptyRules() };
    let timeZone = 'UTC';
    let utc = true;

    if (!isRecord(input)) {
        issues.push({ path: '(calendar)', message: `expected an object, got ${show(input)}` });
    } else {
        for (const key of Object.keys(input)) {
            if (!CALENDAR_KEYS.has(key)) {
                issues.push({
                    path: key,
                    message: `unknown property — expected one of ${[...CALENDAR_KEYS].join(', ')}`,
                });
            }
        }

        if (typeof input.timeZone !== 'string') {
            issues.push({
                path: 'timeZone',
                message: `expected an IANA time zone such as 'Europe/Berlin', got ${show(input.timeZone)}`,
            });
        } else {
            try {
                utc = checkTimeZone(input.timeZone);
                timeZone = input.timeZone;
            } catch {
                issues.push({
                    path: 'timeZone',
                    message: `${show(input.timeZone)} is not a time zone this runtime knows`,
                });
            }
        }

        if (!isRecord(input.week)) {
            issues.push({
                path: 'week',
                message: `expected an object such as { 'mon-fri': '09:00-17:00' }, got ${show(input.week)}`,
            });
        } else {
            const owner: (string | undefined)[] = [];
            for (const [key, hours] of Object.entries(input.week)) {
                const path = `week[${JSON.stringify(key)}]`;
                const days = parseWeekKey(key);
                if (days === null) {
                    issues.push({
                        path,
                        message: `${show(key)} is not a day — expected mon…sun, a range such as 'mon-fri', or a list such as 'sat,sun'`,
                    });
                }
                const shifts = parseHours(hours, path, issues);
                for (const day of days ?? []) {
                    const previous = owner[day];
                    if (previous !== undefined) {
                        issues.push({
                            path,
                            message: `${WEEKDAYS[day]} is already set by ${JSON.stringify(previous)}`,
                        });
                        continue;
                    }
                    owner[day] = key;
                    week[day] = shifts;
                }
            }
        }

        if (input.holidays !== undefined) {
            if (!Array.isArray(input.holidays)) {
                issues.push({
                    path: 'holidays',
                    message: `expected an array of dates, got ${show(input.holidays)}`,
                });
            } else {
                input.holidays.forEach((text: unknown, index) => {
                    const path = `holidays[${index}]`;
                    if (typeof text !== 'string') {
                        issues.push({ path, message: `expected a date string, got ${show(text)}` });
                        return;
                    }
                    const key = parseDateKey(text);
                    if (typeof key === 'string') {
                        issues.push({ path, message: key });
                        return;
                    }
                    const target = rules[key.kind];
                    const set = key.single ? target.singleHolidays : target.rangeHolidays;
                    for (const value of key.keys) set.add(value);
                });
            }
        }

        if (input.overrides !== undefined) {
            if (!isRecord(input.overrides)) {
                issues.push({
                    path: 'overrides',
                    message: `expected an object such as { '2026-12-24': '09:00-13:00' }, got ${show(input.overrides)}`,
                });
            } else {
                for (const [text, hours] of Object.entries(input.overrides)) {
                    const path = `overrides[${JSON.stringify(text)}]`;
                    const key = parseDateKey(text);
                    if (typeof key === 'string') {
                        issues.push({ path, message: key });
                        parseHours(hours, path, issues);
                        continue;
                    }
                    const shifts = parseHours(hours, path, issues);
                    const target = rules[key.kind];
                    if (key.single) {
                        target.singleOverrides.set(key.keys[0] as number, shifts);
                        continue;
                    }
                    const clash = key.keys.find(value => target.rangeOwners.has(value));
                    if (clash !== undefined) {
                        issues.push({
                            path,
                            message: `overlaps with ${JSON.stringify(target.rangeOwners.get(clash))} — split one of the ranges`,
                        });
                        continue;
                    }
                    for (const value of key.keys) {
                        target.rangeOwners.set(value, text);
                        target.rangeOverrides.set(value, shifts);
                    }
                }
            }
        }
    }

    const dated = resolveRules(rules.dated);
    const yearly = resolveRules(rules.yearly);
    const repeats =
        week.some(shifts => shifts.length > 0) ||
        [...yearly.values()].some(shifts => shifts.length > 0);
    let firstOpenDay = Infinity;
    let lastOpenDay = -Infinity;
    let datedFrom = Infinity;
    let datedTo = -Infinity;
    for (const [day, shifts] of dated) {
        datedFrom = Math.min(datedFrom, day);
        datedTo = Math.max(datedTo, day);
        if (shifts.length === 0) continue;
        firstOpenDay = Math.min(firstOpenDay, day);
        lastOpenDay = Math.max(lastOpenDay, day);
    }

    return {
        issues,
        compiled: {
            timeZone,
            utc,
            week,
            dated,
            yearly,
            firstDay: repeats ? -Infinity : firstOpenDay,
            lastDay: repeats ? Infinity : lastOpenDay,
            datedFrom,
            datedTo,
        },
    };
}

const frozenCalendars = new WeakSet<object>();
const compiledCalendars = new WeakMap<
    object,
    { readonly fingerprint: string | null; readonly compiled: CompiledCalendar }
>();

export function compile(calendar: BusinessCalendar): CompiledCalendar {
    if (isRecord(calendar)) {
        const cached = compiledCalendars.get(calendar);
        if (
            cached &&
            (cached.fingerprint === null || cached.fingerprint === JSON.stringify(calendar))
        ) {
            return cached.compiled;
        }
    }
    const { issues, compiled } = analyze(calendar);
    if (issues.length > 0) throw new BusinessCalendarError(issues);
    compiledCalendars.set(calendar, {
        fingerprint: frozenCalendars.has(calendar) ? null : JSON.stringify(calendar),
        compiled,
    });
    return compiled;
}

export function shiftsOn(calendar: CompiledCalendar, day: number): readonly Shift[] {
    const dated = calendar.dated.get(day);
    if (dated) return dated;
    if (calendar.yearly.size > 0) {
        const yearly = calendar.yearly.get(monthDayOf(day));
        if (yearly) return yearly;
    }
    return calendar.week[weekdayOf(day)] as readonly Shift[];
}

export function formatShift([start, end]: Shift): string {
    return `${formatTimeOfDay(start)}-${end === DAY_MS ? '24:00' : formatTimeOfDay(end % DAY_MS)}`;
}

export function validateCalendar(input: unknown): CalendarIssue[] {
    return analyze(input).issues;
}

function freezeCopy<T>(value: T): T {
    if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy)) as T;
    if (isRecord(value)) {
        return Object.freeze(
            Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeCopy(item)]))
        ) as T;
    }
    return value;
}

export function defineCalendar<const T extends BusinessCalendar>(calendar: T): T {
    const frozen = freezeCopy(calendar);
    if (isRecord(frozen)) frozenCalendars.add(frozen);
    compile(frozen);
    return frozen;
}
