ALTER TABLE public.monthly_bill
  DROP CONSTRAINT monthly_bill_check,
  ADD CONSTRAINT monthly_bill_check
    CHECK (period_end >= period_start);