import { describe, expect, it } from 'vitest';
import { pauseSla, resumeSla, slaDueAt, slaStatus, startSla, stopSla, type SlaClock } from './sla';
import { HOUR, at, iso, nyOffice, utcWeekdays } from './testUtils';

const summary = (clock: SlaClock, now: string, calendar = nyOffice) => {
    const status = slaStatus(calendar, clock, at(now));
    return {
        state: status.state,
        elapsed: status.elapsed / HOUR,
        remaining: status.remaining / HOUR,
        overdueBy: status.overdueBy / HOUR,
        progress: status.progress,
        dueAt: iso(status.dueAt),
        breached: status.breached,
        breachedAt: iso(status.breachedAt),
    };
};

describe('an SLA clock', () => {
    it('runs in business time only', () => {
        const clock = startSla({ hours: 4 }, at('2026-10-02T18:00:00Z'));
        expect(summary(clock, '2026-10-03T12:00:00Z')).toEqual({
            state: 'running',
            elapsed: 3,
            remaining: 1,
            overdueBy: 0,
            progress: 0.75,
            dueAt: '2026-10-05T14:00:00.000Z',
            breached: false,
            breachedAt: null,
        });
    });

    it('stops counting while paused and keeps the time already used', () => {
        let clock = startSla({ hours: 4 }, at('2026-10-02T18:00:00Z'));
        clock = pauseSla(nyOffice, clock, at('2026-10-02T20:00:00Z'));
        expect(summary(clock, '2026-10-07T12:00:00Z')).toMatchObject({
            state: 'paused',
            elapsed: 2,
            dueAt: null,
            breached: false,
        });
        clock = resumeSla(clock, at('2026-10-05T13:00:00Z'));
        expect(iso(slaDueAt(nyOffice, clock))).toBe('2026-10-05T15:00:00.000Z');
        expect(iso(slaDueAt(nyOffice, clock, 0.75))).toBe('2026-10-05T14:00:00.000Z');
        clock = stopSla(nyOffice, clock, at('2026-10-05T14:30:00Z'));
        expect(summary(clock, '2026-10-09T12:00:00Z')).toMatchObject({
            state: 'stopped',
            elapsed: 3.5,
            remaining: 0.5,
            dueAt: null,
            breached: false,
        });
    });

    it('is breached on a weekend once the due time has passed', () => {
        const clock = startSla({ hours: 1 }, at('2026-10-02T20:00:00Z'));
        expect(summary(clock, '2026-10-03T12:00:00Z')).toMatchObject({
            elapsed: 1,
            overdueBy: 0,
            dueAt: '2026-10-02T21:00:00.000Z',
            breached: true,
            breachedAt: '2026-10-02T21:00:00.000Z',
        });
        expect(summary(clock, '2026-10-02T21:00:00Z').breached).toBe(false);
    });

    it('records a breach when paused or stopped after the due time', () => {
        const late = pauseSla(
            nyOffice,
            startSla({ hours: 1 }, at('2026-10-05T13:00:00Z')),
            at('2026-10-05T15:00:00Z')
        );
        expect(late.breachedAt).toBe(at('2026-10-05T14:00:00Z'));
        const resumed = resumeSla(late, at('2026-10-06T13:00:00Z'));
        expect(summary(resumed, '2026-10-06T14:00:00Z')).toMatchObject({
            elapsed: 3,
            overdueBy: 2,
            dueAt: '2026-10-05T14:00:00.000Z',
            breachedAt: '2026-10-05T14:00:00.000Z',
        });
        expect(slaDueAt(nyOffice, resumed)).toBeNull();
        const stopped = stopSla(
            nyOffice,
            startSla({ hours: 1 }, at('2026-10-05T13:00:00Z')),
            at('2026-10-05T16:00:00Z')
        );
        expect(summary(stopped, '2026-10-05T16:00:00Z')).toMatchObject({
            state: 'stopped',
            breached: true,
            breachedAt: '2026-10-05T14:00:00.000Z',
            dueAt: '2026-10-05T14:00:00.000Z',
        });
    });

    it('does not breach on a closed day after a pause exactly at the due time', () => {
        let clock = startSla({ hours: 1 }, at('2026-10-05T13:00:00Z'));
        clock = pauseSla(nyOffice, clock, at('2026-10-05T14:00:00Z'));
        expect(clock.breachedAt).toBeNull();
        clock = resumeSla(clock, at('2026-10-10T14:00:00Z'));
        expect(summary(clock, '2026-10-10T14:00:01Z')).toMatchObject({
            breached: false,
            dueAt: '2026-10-12T13:00:00.000Z',
        });
        expect(summary(clock, '2026-10-12T13:30:00Z')).toMatchObject({
            breached: true,
            breachedAt: '2026-10-12T13:00:00.000Z',
        });
    });

    it('ignores repeated pauses, resumes and stops', () => {
        const running = startSla({ hours: 1 }, at('2026-10-05T13:00:00Z'));
        expect(resumeSla(running, at('2026-10-05T14:00:00Z'))).toBe(running);
        const paused = pauseSla(nyOffice, running, at('2026-10-05T13:30:00Z'));
        expect(pauseSla(nyOffice, paused, at('2026-10-05T14:00:00Z'))).toBe(paused);
        const stopped = stopSla(nyOffice, paused, at('2026-10-05T14:00:00Z'));
        expect(stopped).toMatchObject({
            stoppedAt: at('2026-10-05T14:00:00Z'),
            pausedAt: null,
            elapsed: HOUR / 2,
        });
        expect(stopSla(nyOffice, stopped, at('2026-10-06T14:00:00Z'))).toBe(stopped);
        expect(pauseSla(nyOffice, stopped, at('2026-10-06T14:00:00Z'))).toBe(stopped);
        expect(() => resumeSla(stopped, at('2026-10-06T14:00:00Z'))).toThrow(
            'resumeSla: the clock is stopped — start a new one instead'
        );
    });

    it('rejects time going backwards, naming the function that was called', () => {
        const running = startSla({ hours: 1 }, at('2026-10-05T13:00:00Z'));
        expect(() => pauseSla(nyOffice, running, at('2026-10-05T12:00:00Z'))).toThrow(
            "pauseSla: 2026-10-05T12:00:00.000Z is before the clock's last change at 2026-10-05T13:00:00.000Z"
        );
        expect(() => stopSla(nyOffice, running, at('2026-10-05T12:00:00Z'))).toThrow('stopSla: ');
        const paused = pauseSla(nyOffice, running, at('2026-10-05T14:00:00Z'));
        expect(() => stopSla(nyOffice, paused, at('2026-10-05T13:30:00Z'))).toThrow('stopSla: ');
        expect(() => resumeSla(paused, at('2026-10-05T13:30:00Z'))).toThrow('resumeSla: ');
    });

    it('reads a status a little in the past without throwing', () => {
        const clock = startSla({ hours: 1 }, at('2026-10-05T13:00:00Z'));
        expect(summary(clock, '2026-10-05T12:59:00Z')).toMatchObject({
            elapsed: 0,
            breached: false,
        });
    });

    it('survives JSON and validates what comes back', () => {
        const clock = pauseSla(
            utcWeekdays,
            startSla({ hours: 2 }, at('2026-10-05T09:00:00Z')),
            at('2026-10-05T10:00:00Z')
        );
        const revived = JSON.parse(JSON.stringify(clock)) as SlaClock;
        expect(revived).toEqual(clock);
        expect(slaStatus(utcWeekdays, revived, at('2026-10-06T00:00:00Z')).elapsed).toBe(HOUR);
        const broken = (patch: Partial<Record<keyof SlaClock, unknown>>) => () =>
            slaStatus(utcWeekdays, { ...clock, ...patch } as SlaClock, 0);
        expect(broken({ target: 0 })).toThrow(
            'clock: target must be a positive number of milliseconds'
        );
        expect(broken({ startedAt: 'x' })).toThrow('clock: startedAt must be epoch milliseconds');
        expect(broken({ elapsed: -1 })).toThrow('clock: elapsed must be a non-negative');
        expect(broken({ breachedAt: 'x' })).toThrow('must be epoch milliseconds or null');
        expect(broken({ runningSince: 1 })).toThrow(
            'exactly one of runningSince, pausedAt and stoppedAt'
        );
        expect(() => slaStatus(utcWeekdays, null as unknown as SlaClock, 0)).toThrow(
            'clock: expected an SlaClock object'
        );
    });

    it('validates targets and fractions', () => {
        expect(() => startSla(0, 0)).toThrow('startSla: target must be positive');
        expect(() => startSla({ days: 1 } as never, 0)).toThrow("'days' of business time");
        const clock = startSla({ hours: 1 }, at('2026-10-05T13:00:00Z'));
        expect(() => slaDueAt(nyOffice, clock, 0)).toThrow(
            'slaDueAt: fraction must be a positive number, got 0'
        );
        expect(() => slaDueAt(nyOffice, clock, Number.NaN)).toThrow('slaDueAt: fraction');
        expect(iso(slaDueAt(nyOffice, clock, 2))).toBe('2026-10-05T15:00:00.000Z');
    });

    it('gives no due time when the calendar never opens again', () => {
        const once = { timeZone: 'UTC', week: {}, overrides: { '2026-10-05': '09:00-10:00' } };
        let clock = startSla({ hours: 1 }, at('2026-10-05T09:00:00Z'));
        clock = pauseSla(once, clock, at('2026-10-05T10:00:00Z'));
        clock = resumeSla(clock, at('2026-10-06T00:00:00Z'));
        expect(slaDueAt(once, clock)).toBeNull();
        expect(slaStatus(once, clock, at('2027-01-01T00:00:00Z')).breached).toBe(false);
    });

    it('can be paused, stopped and read when the target is out of reach', () => {
        const once = { timeZone: 'UTC', week: {}, overrides: { '2026-01-05': '09:00-17:00' } };
        const clock = startSla({ hours: 10 }, at('2026-01-05T09:00:00Z'));
        const status = slaStatus(once, clock, at('2026-01-05T12:00:00Z'));
        expect(status.elapsed).toBe(3 * HOUR);
        expect(status.dueAt).toBeNull();
        expect(status.breached).toBe(false);
        expect(slaDueAt(once, clock)).toBeNull();
        const paused = pauseSla(once, clock, at('2026-01-05T12:00:00Z'));
        expect(paused.elapsed).toBe(3 * HOUR);
        expect(paused.breachedAt).toBeNull();
        const stopped = stopSla(once, clock, at('2026-01-06T00:00:00Z'));
        expect(stopped.elapsed).toBe(8 * HOUR);
        expect(stopped.stoppedAt).toBe(at('2026-01-06T00:00:00Z'));
        expect(stopped.breachedAt).toBeNull();
    });
});
