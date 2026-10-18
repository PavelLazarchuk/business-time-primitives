import { compile, type CompiledCalendar } from './calendar';
import { toDuration, toInstant } from './internal/input';
import { firstOpenAt } from './internal/segments';
import { businessTimeWithin, tryWalkBusinessTime } from './time';
import type { BusinessCalendar, DurationInput, InstantInput } from './types';

export interface SlaClock {
    readonly target: number;
    readonly startedAt: number;
    readonly elapsed: number;
    readonly runningSince: number | null;
    readonly pausedAt: number | null;
    readonly stoppedAt: number | null;
    readonly breachedAt: number | null;
}

export type SlaState = 'running' | 'paused' | 'stopped';

export interface SlaStatus {
    readonly state: SlaState;
    readonly elapsed: number;
    readonly remaining: number;
    readonly overdueBy: number;
    readonly progress: number;
    readonly dueAt: Date | null;
    readonly breached: boolean;
    readonly breachedAt: Date | null;
}

const stateOf = (clock: SlaClock): SlaState =>
    clock.stoppedAt !== null ? 'stopped' : clock.runningSince !== null ? 'running' : 'paused';

const isInstant = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
const isOptionalInstant = (value: unknown): value is number | null =>
    value === null || isInstant(value);

function checkClock(clock: SlaClock, name: string): SlaClock {
    const problem =
        typeof clock !== 'object' || clock === null
            ? 'expected an SlaClock object'
            : !isInstant(clock.target) || clock.target <= 0
              ? 'target must be a positive number of milliseconds'
              : !isInstant(clock.startedAt)
                ? 'startedAt must be epoch milliseconds'
                : !isInstant(clock.elapsed) || clock.elapsed < 0
                  ? 'elapsed must be a non-negative number of milliseconds'
                  : ![clock.runningSince, clock.pausedAt, clock.stoppedAt, clock.breachedAt].every(
                          isOptionalInstant
                      )
                    ? 'runningSince, pausedAt, stoppedAt and breachedAt must be epoch milliseconds or null'
                    : [clock.runningSince, clock.pausedAt, clock.stoppedAt].filter(
                            value => value !== null
                        ).length !== 1
                      ? 'exactly one of runningSince, pausedAt and stoppedAt must be set'
                      : null;
    if (problem) throw new TypeError(`${name}: ${problem}`);
    return clock;
}

function reachesAt(calendar: CompiledCalendar, clock: SlaClock, fraction: number): number | null {
    const since = clock.runningSince;
    const needed = clock.target * fraction - clock.elapsed;
    if (since === null || needed < 0) return null;
    if (needed === 0) return firstOpenAt(calendar, since);
    return tryWalkBusinessTime(calendar, since, needed);
}

function breachBy(clock: SlaClock, until: number, dueAt: number | null): number | null {
    if (clock.breachedAt !== null) return clock.breachedAt;
    return dueAt !== null && until > dueAt ? dueAt : null;
}

function notBefore(at: number, since: number, action: string): void {
    if (at < since) {
        throw new RangeError(
            `${action}: ${new Date(at).toISOString()} is before the clock's last change at ${new Date(since).toISOString()}`
        );
    }
}

export function startSla(target: DurationInput, at: InstantInput): SlaClock {
    const budget = toDuration(target, 'target');
    if (budget <= 0) throw new RangeError('startSla: target must be positive');
    const startedAt = toInstant(at, 'at');
    return {
        target: budget,
        startedAt,
        elapsed: 0,
        runningSince: startedAt,
        pausedAt: null,
        stoppedAt: null,
        breachedAt: null,
    };
}

function pauseAt(
    calendar: CompiledCalendar,
    clock: SlaClock,
    instant: number,
    action: string
): SlaClock {
    const since = clock.runningSince;
    if (since === null) return clock;
    notBefore(instant, since, action);
    return {
        ...clock,
        elapsed: clock.elapsed + businessTimeWithin(calendar, since, instant),
        runningSince: null,
        pausedAt: instant,
        breachedAt: breachBy(clock, instant, reachesAt(calendar, clock, 1)),
    };
}

export function pauseSla(calendar: BusinessCalendar, clock: SlaClock, at: InstantInput): SlaClock {
    checkClock(clock, 'clock');
    if (clock.runningSince === null) return clock;
    return pauseAt(compile(calendar), clock, toInstant(at, 'at'), 'pauseSla');
}

export function resumeSla(clock: SlaClock, at: InstantInput): SlaClock {
    checkClock(clock, 'clock');
    if (clock.stoppedAt !== null) {
        throw new RangeError('resumeSla: the clock is stopped — start a new one instead');
    }
    if (clock.pausedAt === null) return clock;
    const instant = toInstant(at, 'at');
    notBefore(instant, clock.pausedAt, 'resumeSla');
    return { ...clock, runningSince: instant, pausedAt: null };
}

export function stopSla(calendar: BusinessCalendar, clock: SlaClock, at: InstantInput): SlaClock {
    checkClock(clock, 'clock');
    if (clock.stoppedAt !== null) return clock;
    const instant = toInstant(at, 'at');
    if (clock.pausedAt !== null) notBefore(instant, clock.pausedAt, 'stopSla');
    const paused = pauseAt(compile(calendar), clock, instant, 'stopSla');
    return { ...paused, pausedAt: null, stoppedAt: instant };
}

export function slaStatus(
    calendar: BusinessCalendar,
    clock: SlaClock,
    now: InstantInput
): SlaStatus {
    checkClock(clock, 'clock');
    const compiled = compile(calendar);
    const instant = toInstant(now, 'now');
    const running = clock.runningSince;
    const elapsed =
        clock.elapsed +
        (running === null ? 0 : businessTimeWithin(compiled, running, Math.max(instant, running)));
    const due = running === null ? null : reachesAt(compiled, clock, 1);
    const breachedAt = running === null ? clock.breachedAt : breachBy(clock, instant, due);
    const dueAt = breachedAt ?? due;
    return {
        state: stateOf(clock),
        elapsed,
        remaining: Math.max(0, clock.target - elapsed),
        overdueBy: Math.max(0, elapsed - clock.target),
        progress: elapsed / clock.target,
        dueAt: dueAt === null ? null : new Date(dueAt),
        breached: breachedAt !== null,
        breachedAt: breachedAt === null ? null : new Date(breachedAt),
    };
}

export function slaDueAt(calendar: BusinessCalendar, clock: SlaClock, fraction = 1): Date | null {
    checkClock(clock, 'clock');
    if (!Number.isFinite(fraction) || fraction <= 0) {
        throw new RangeError(`slaDueAt: fraction must be a positive number, got ${fraction}`);
    }
    const at = reachesAt(compile(calendar), clock, fraction);
    return at === null ? null : new Date(at);
}
