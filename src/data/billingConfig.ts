// src/data/billingConfig.ts  (NEW FILE)
//
// Change these values and every bill picks them up, because bills are
// calculated from these numbers each time they are shown.

/** Flat monthly charge for Water + Trash + Wifi, in pesos. */
export const FIXED_COSTS_AMOUNT = 500;

/** Shown in parentheses under "Fixed Costs" on the statement. */
export const FIXED_COSTS_LABEL = 'Water + Trash + Wifi';

/**
 * Day of the month AFTER the billing period on which payment is due.
 * Example: 5 -> a September 2026 bill is due Oct 5, 2026.
 */
export const DUE_DAY_OF_NEXT_MONTH = 5;

/** Footer text printed at the bottom of every statement. */
export const PAYMENT_REMINDER =
  'Please settle on or before the due date to avoid late penalties.';