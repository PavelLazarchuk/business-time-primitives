export const SECOND_MS = 1_000;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function dayFromCivil(year: number, month: number, day: number): number {
    const y = month <= 2 ? year - 1 : year;
    const era = Math.floor(y / 400);
    const yearOfEra = y - era * 400;
    const shiftedMonth = (month + 9) % 12;
    const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
    const dayOfEra =
        yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
    return era * 146_097 + dayOfEra - 719_468;
}

export function civilFromDay(dayNumber: number): [year: number, month: number, day: number] {
    const z = dayNumber + 719_468;
    const era = Math.floor(z / 146_097);
    const dayOfEra = z - era * 146_097;
    const yearOfEra = Math.floor(
        (dayOfEra -
            Math.floor(dayOfEra / 1460) +
            Math.floor(dayOfEra / 36_524) -
            Math.floor(dayOfEra / 146_096)) /
            365
    );
    const dayOfYear =
        dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
    const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
    const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
    const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
    return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

export function weekdayOf(dayNumber: number): number {
    return (((dayNumber + 3) % 7) + 7) % 7;
}

export function monthDayOf(dayNumber: number): number {
    const [, month, day] = civilFromDay(dayNumber);
    return month * 100 + day;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

const formatYear = (year: number) =>
    year >= 0 && year <= 9999 ? pad(year, 4) : `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}`;

export function formatDay(dayNumber: number): string {
    const [year, month, day] = civilFromDay(dayNumber);
    return `${formatYear(year)}-${pad(month)}-${pad(day)}`;
}

const DATE_KEY = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})$/;
const MONTH_DAY_KEY = /^--(\d{2})-(\d{2})$/;

export function parseDay(text: string): number | null {
    const match = DATE_KEY.exec(text);
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (match[1] === '-000000') return null;
    if (month < 1 || month > 12 || day < 1) return null;
    const dayNumber = dayFromCivil(year, month, day);
    return civilFromDay(dayNumber)[2] === day ? dayNumber : null;
}

export function parseMonthDay(text: string): number | null {
    const match = MONTH_DAY_KEY.exec(text);
    if (!match) return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1) return null;
    return civilFromDay(dayFromCivil(2000, month, day))[2] === day ? month * 100 + day : null;
}

export const MONTH_DAYS_OF_LEAP_YEAR: readonly number[] = Array.from({ length: 366 }, (_, index) =>
    monthDayOf(dayFromCivil(2000, 1, 1) + index)
);

export function formatTimeOfDay(ms: number): string {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    const seconds = Math.floor((ms % MINUTE_MS) / SECOND_MS);
    return seconds === 0
        ? `${pad(hours)}:${pad(minutes)}`
        : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
