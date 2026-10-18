export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type HoursInput = string | readonly string[];

export type WeekKey = Weekday | `${Weekday}-${Weekday}` | (string & {});

export interface BusinessCalendar {
    readonly timeZone: string;
    readonly week: Readonly<Partial<Record<WeekKey, HoursInput>>>;
    readonly holidays?: readonly string[];
    readonly overrides?: Readonly<Record<string, HoursInput>>;
}

export type InstantInput = Date | number | { readonly epochMilliseconds: number };

export type DateInput = string | InstantInput;

export type DurationInput =
    | number
    | {
          readonly hours?: number;
          readonly minutes?: number;
          readonly seconds?: number;
          readonly milliseconds?: number;
          readonly microseconds?: number;
          readonly nanoseconds?: number;
      };

export interface Interval {
    readonly start: Date;
    readonly end: Date;
}

export type OpenStatus =
    | {
          readonly open: true;
          readonly closesAt: Date | null;
      }
    | {
          readonly open: false;
          readonly opensAt: Date | null;
      };

export interface CalendarIssue {
    readonly path: string;
    readonly message: string;
}
