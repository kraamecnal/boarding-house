import {
  manilaDateFromTimestamp,
  todayInManila,
} from '../../../src/utils/manilaDate.ts'

Deno.test('Manila dates change at Manila midnight, not UTC midnight', () => {
  if (todayInManila(new Date('2026-11-23T15:59:59.000Z')) !== '2026-11-23') {
    throw new Error('The date changed before Manila midnight.')
  }
  if (todayInManila(new Date('2026-11-23T16:00:00.000Z')) !== '2026-11-24') {
    throw new Error('The date did not change at Manila midnight.')
  }
  if (manilaDateFromTimestamp('2026-11-24T15:59:59.000Z') !== '2026-11-24') {
    throw new Error('A timestamp before Manila midnight used the wrong day.')
  }
  if (manilaDateFromTimestamp('2026-11-24T16:00:00.000Z') !== '2026-11-25') {
    throw new Error('A timestamp at Manila midnight used the wrong day.')
  }
})
