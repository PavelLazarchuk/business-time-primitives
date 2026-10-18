import type { BusinessCalendar } from './types';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const at = (text: string): number => {
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) throw new Error(`bad timestamp in test: ${text}`);
    return ms;
};

export const iso = (value: Date | number | null): string | null =>
    value === null ? null : new Date(value).toISOString();

export const nyOffice: BusinessCalendar = {
    timeZone: 'America/New_York',
    week: { 'mon-fri': '09:00-17:00' },
    holidays: ['2026-11-26', '--12-25'],
    overrides: { '2026-12-24': '09:00-13:00' },
};

export const utcWeekdays: BusinessCalendar = {
    timeZone: 'UTC',
    week: { 'mon-fri': '09:00-17:00' },
};

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

export function referenceOffset(timeZone: string, instant: number): number {
    let formatter = offsetFormatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
        offsetFormatters.set(timeZone, formatter);
    }
    const name =
        formatter.formatToParts(instant).find(part => part.type === 'timeZoneName')?.value ?? '';
    const match = /GMT(?:([+-])(\d{1,2})(?::?(\d{2}))?(?::?(\d{2}))?)?$/.exec(name);
    if (!match) throw new Error(`unexpected offset name ${name}`);
    if (!match[1]) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    const [hours, minutes, seconds] = [match[2], match[3], match[4]].map(part => Number(part ?? 0));
    return (
        sign * (((hours as number) * 60 + (minutes as number)) * 60 + (seconds as number)) * 1000
    );
}

export const referenceWall = (timeZone: string, instant: number) =>
    instant + referenceOffset(timeZone, instant);

export function random(seed: number) {
    let state = seed >>> 0;
    const next = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
    const int = (max: number) => Math.floor(next() * max);
    const pick = <T>(items: readonly T[]): T => items[int(items.length)] as T;
    return { next, int, pick };
}
