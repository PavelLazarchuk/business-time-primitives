# business-time-primitives

Business hours and SLA math as pure functions.

"Reply within 4 business hours", "ships in 2 business days", "open now · closes
at 18:00", "time to first response" — all of these need the same thing: a
calendar of working hours, read in the right time zone, correct across daylight
saving time. This package does that and nothing else.

```ts
import { addBusinessTime, defineCalendar } from 'business-time-primitives';

const office = defineCalendar({
    timeZone: 'America/New_York',
    week: { 'mon-fri': '09:00-17:00' },
    holidays: ['--12-25', '2026-11-26'],
});

// A ticket opened Friday 15:00 with a 4-business-hour SLA is due Monday 11:00.
addBusinessTime(office, new Date('2026-10-02T15:00:00-04:00'), { hours: 4 });
// → 2026-10-05T15:00:00.000Z
```

- **Any library, or none** — takes `Date`, epoch milliseconds or Temporal; no moment, Day.js or Luxon.
- **Wall-clock correct** — 9–5 stays 9–5 local time on DST days; a night shift on the night the clocks change is an hour shorter or longer, as it is in real life.
- **Real schedules** — split shifts, overnight shifts, holidays, yearly holidays, date ranges, special hours for single dates.
- **SLA clocks** — pausable, JSON-serializable timers with breach detection and warning times.
- **Pure** — no clock reads, no timers, no I/O. Pass `now` in; results never depend on the host time zone.
- **Small** — zero dependencies, ~6.4 kB gzipped (4 kB for a single function), ESM + CJS, Node 18+, browsers, Deno, Bun, Cloudflare Workers.

```sh
npm install business-time-primitives
```

## Calendars

A calendar is a plain JSON object, so it can live in a database or a config file.

```ts
const support = defineCalendar({
    timeZone: 'Europe/Berlin',
    week: {
        'mon-fri': ['09:00-12:30', '13:30-18:00'], // a lunch break
        sat: '10:00-14:00',
    },
    holidays: [
        '2026-10-03', // one date
        '--12-25', // every year
        '2026-08-03/2026-08-14', // an inclusive range: a two-week shutdown
        '--12-31/--01-01', // a yearly range, which may wrap past New Year
    ],
    overrides: {
        '2026-12-23': '09:00-13:00', // special hours for one date
        '2026-12-28/2026-12-30': '10:00-14:00', // short hours between the holidays
        '2026-11-14': [], // a Saturday that stays closed
    },
});

const bar = defineCalendar({
    timeZone: 'Europe/Berlin',
    week: { 'thu-sat': '20:00-04:00' }, // overnight: belongs to the day it starts on
});
```

- Days: `mon`…`sun`, ranges such as `'mon-fri'` or `'fri-mon'`, lists such as `'sat,sun'`.
- Hours: `'HH:mm-HH:mm'` (seconds allowed), a list of them, or `[]` for closed. `'24:00'` ends at midnight; an end at or before the start is an overnight shift.
- An override sets the hours of **every** date it covers, weekends included — a range of summer hours over July would open on Sundays too. Overlapping override ranges are rejected.
- **Precedence**: the more specific date wins, and at the same specificity an override beats a holiday — a single date, then a date range, then a yearly date, then a yearly range, then `week`. So `holidays: ['2026-12-25']` closes Christmas even inside a December range of short hours.

`defineCalendar` validates once and returns a deeply frozen copy. You can also
pass plain objects to every function; they are validated on first use, and again
if you change them later. `validateCalendar(input)` returns every problem
instead of throwing:

```ts
validateCalendar({ timeZone: 'Europe/Berln', week: { 'mon-fry': '9-17' } });
// [
//   { path: 'timeZone', message: '"Europe/Berln" is not a time zone this runtime knows' },
//   { path: 'week["mon-fry"]', message: '"mon-fry" is not a day — expected mon…sun, …' },
//   { path: 'week["mon-fry"]', message: '"9" is not a start time — expected 00:00 to 23:59:59' },
// ]
```

Holiday data is up to you: pass the dates from wherever you keep them.

## Open now

```ts
isOpen(bar, now); // boolean
openStatus(bar, now); // { open: true, closesAt: Date } or { open: false, opensAt: Date }
openIntervals(bar, from, to); // [{ start, end }, …] — back-to-back shifts merged
hoursOn(support, '2026-12-23'); // ['09:00-13:00'] — after holidays and overrides
```

`closesAt` is `null` for a calendar that stays open for over a year (24/7);
`opensAt` is `null` when it never opens again.

## Business time

```ts
addBusinessTime(calendar, from, { hours: 4 }); // due date
subtractBusinessTime(calendar, until, { hours: 6 }); // latest start that still makes it
businessTimeBetween(calendar, openedAt, repliedAt); // milliseconds, e.g. time to first reply
```

- Starting outside business hours, the clock starts at the next opening.
- A duration that ends exactly at closing time returns the closing time (Friday 17:00), not Monday's opening.
- Durations are milliseconds or `{ hours, minutes, seconds, milliseconds }` — a plain object or a `Temporal.Duration`. There is deliberately no `days`: a "business day" is not 24 hours.

## Business days

A business day is a local date on which at least one shift starts.

```ts
isBusinessDay(calendar, '2026-12-24');
addBusinessDays(calendar, '2026-11-25', 1); // '2026-11-27' — skips Thanksgiving
addBusinessDays(calendar, '2026-10-03', -1); // Saturday − 1 = Friday
businessDaysBetween(calendar, '2026-10-01', '2026-10-31');
businessDateOf(calendar, orderPlacedAt, { cutoff: '14:00' }); // orders after 14:00 ship next business day
localDate(calendar, instant); // 'YYYY-MM-DD' in the calendar's zone
```

`businessDaysBetween` counts exactly the days `addBusinessDays` steps over, so
`addBusinessDays(c, start, businessDaysBetween(c, start, end))` lands on `end`
whenever `end` is a business day — in both directions. When an endpoint is not
a business day the two directions can differ by one (Thursday → Sunday is 1,
Sunday → Thursday is −2).

## SLA clocks

A pausable timer that lives as plain JSON next to the ticket. Every function
returns a new clock; nothing reads the time — you pass it in.

```ts
let clock = startSla({ hours: 4 }, ticket.createdAt);

clock = pauseSla(calendar, clock, waitingOnCustomerAt); // stops counting
clock = resumeSla(clock, customerRepliedAt);
clock = stopSla(calendar, clock, firstReplyAt); // fulfilled, final

const status = slaStatus(calendar, clock, now);
// { state, elapsed, remaining, overdueBy, progress, dueAt, breached, breachedAt }

slaDueAt(calendar, clock); // when it will be due, for a job queue or a Durable Object alarm
slaDueAt(calendar, clock, 0.8); // when 80% is used — a good moment for a warning
```

A ticket due Friday 17:00 counts as breached on Saturday, even though no business
time passed since — so `breached` can be true while `overdueBy` is 0. A clock
paused exactly at its due time is not breached; once resumed it is due at the
next opening.

## Time zones and DST

Hours are wall-clock times in the calendar's IANA zone, converted through `Intl`
(no bundled time zone data). A shift starts the first moment the local clock
reaches its start time:

- In a spring-forward gap, that is the moment the clocks jump: a shift from 02:30 on the night of the change starts at 03:00.
- In a fall-back overlap, it is the first pass: a shift ending at 01:30 ends the first time it is 01:30.

These rules are checked minute by minute against an independent model, around
every 2026 transition in a dozen zones — including Lord Howe's half-hour shift,
Chatham's +12:45, Casablanca's Ramadan changes and the day Samoa skipped in 2011.

## Limits

- Instants must be within the range a `Date` can hold.
- Durations and spans are limited to 100 years — anything longer is almost certainly a bug, and would take long to walk.
- A search gives up after ten years without a single open day outside the dated rules. Closures written as dated holidays are explicit, so the search walks through them however long they are.

## Errors

Invalid calendars throw a `BusinessCalendarError` (a `RangeError`) listing every
issue. Invalid arguments throw a `TypeError` or `RangeError` naming the function
and the argument, such as `addBusinessDays: amount must be an integer, got 1.5`.

## License

MIT
