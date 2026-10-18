import { describe, expect, it } from 'vitest';
import * as entry from './index';

describe('public entry point', () => {
    it('exports exactly the documented functions', () => {
        expect(Object.keys(entry).sort()).toEqual([
            'BusinessCalendarError',
            'addBusinessDays',
            'addBusinessTime',
            'businessDateOf',
            'businessDaysBetween',
            'businessTimeBetween',
            'defineCalendar',
            'hoursOn',
            'isBusinessDay',
            'isOpen',
            'localDate',
            'openIntervals',
            'openStatus',
            'pauseSla',
            'resumeSla',
            'slaDueAt',
            'slaStatus',
            'startSla',
            'stopSla',
            'subtractBusinessTime',
            'validateCalendar',
        ]);
    });
});
