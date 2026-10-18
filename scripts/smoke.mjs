import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const load = specifier => import(new URL(specifier, import.meta.url).href);

const [major] = process.versions.node.split('.').map(Number);
assert.ok(major >= 18, `expected Node >= 18, got ${process.versions.node}`);

const esm = await load('../dist/index.js');
const {
    defineCalendar,
    validateCalendar,
    isOpen,
    openStatus,
    addBusinessTime,
    subtractBusinessTime,
    businessTimeBetween,
    addBusinessDays,
    businessDaysBetween,
    businessDateOf,
    hoursOn,
    startSla,
    pauseSla,
    resumeSla,
    slaStatus,
    slaDueAt,
    BusinessCalendarError,
} = esm;

const iso = value => new Date(value).toISOString();
const at = text => Date.parse(text);
const HOUR = 3_600_000;

const hasFullIcu = (() => {
    try {
        const hour = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            hourCycle: 'h23',
        })
            .formatToParts(at('2026-01-15T12:00:00Z'))
            .find(part => part.type === 'hour');
        return Number(hour?.value) === 7;
    } catch {
        return false;
    }
})();

const timeZone = hasFullIcu ? 'America/New_York' : 'UTC';
const office = defineCalendar({
    timeZone,
    week: { 'mon-fri': '09:00-17:00' },
    holidays: ['2026-11-26', '--12-25'],
    overrides: { '2026-12-24': '09:00-13:00' },
});
const local = text => (hasFullIcu ? at(`${text}-04:00`) : at(`${text}Z`));

assert.deepEqual(JSON.parse(JSON.stringify(office)), office, 'a calendar did not survive JSON');
assert.equal(Object.isFrozen(office.week), true, 'defineCalendar did not freeze');
assert.deepEqual(validateCalendar({ timeZone: 'UTC', week: {} }), []);
assert.throws(
    () => defineCalendar({ timeZone: 'UTC', week: { mon: '9-5' } }),
    BusinessCalendarError
);

assert.equal(
    iso(addBusinessTime(office, local('2026-10-02T15:00:00'), { hours: 4 })),
    iso(local('2026-10-05T11:00:00'))
);
assert.equal(
    iso(subtractBusinessTime(office, local('2026-10-05T10:00:00'), { hours: 2 })),
    iso(local('2026-10-02T16:00:00'))
);
assert.equal(
    businessTimeBetween(office, local('2026-10-02T16:00:00'), local('2026-10-05T10:00:00')),
    2 * HOUR
);
assert.equal(isOpen(office, local('2026-10-05T09:00:00')), true);
assert.equal(isOpen(office, local('2026-10-03T12:00:00')), false);
const status = openStatus(office, local('2026-10-03T12:00:00'));
assert.equal(status.open, false);
assert.equal(iso(status.opensAt), iso(local('2026-10-05T09:00:00')));

assert.equal(
    addBusinessDays(office, '2026-11-25', 1),
    '2026-11-27',
    'Thanksgiving was a business day'
);
assert.equal(businessDaysBetween(office, '2026-10-04', '2026-10-01'), -2);
assert.equal(addBusinessDays(office, '2026-10-04', -2), '2026-10-01');
assert.equal(
    businessDateOf(office, local('2026-10-02T15:00:00'), { cutoff: '14:00' }),
    '2026-10-05'
);
assert.deepEqual(hoursOn(office, '2026-12-24'), ['09:00-13:00']);
assert.deepEqual(hoursOn(office, '2026-12-25'), []);

let clock = startSla({ hours: 4 }, local('2026-10-02T14:00:00'));
clock = pauseSla(office, clock, local('2026-10-02T16:00:00'));
clock = JSON.parse(JSON.stringify(clock));
clock = resumeSla(clock, local('2026-10-05T09:00:00'));
assert.equal(iso(slaDueAt(office, clock)), iso(local('2026-10-05T11:00:00')));
assert.equal(slaStatus(office, clock, local('2026-10-05T10:00:00')).remaining, HOUR);

if (hasFullIcu) {
    assert.equal(
        iso(addBusinessTime(office, at('2026-10-30T20:00:00Z'), { hours: 2 })),
        '2026-11-02T15:00:00.000Z'
    );
} else {
    console.log('smoke: small-icu build — zone assertions skipped');
}

const cjs = require('../dist/index.cjs');
assert.equal(typeof cjs.addBusinessTime, 'function');
assert.deepEqual(
    Object.keys(cjs).sort(),
    Object.keys(esm).sort(),
    'CJS and ESM entry points disagree'
);

console.log(`smoke: ok on Node ${process.versions.node}`);
