CREATE OR REPLACE FUNCTION public.generate_monthly_bill(
  p_tenancy_id uuid,
  p_period_start date,
  p_period_end date,
  p_due_date date
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bill_id uuid;
  v_room uuid;
  v_rent numeric;
BEGIN
  SELECT room_id, monthly_rate
  INTO v_room, v_rent
  FROM public.tenancy
  WHERE tenancy_id = p_tenancy_id
    AND status = 'active';

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'No active tenancy found';
  END IF;

  INSERT INTO public.monthly_bill (tenancy_id, period_start, period_end, due_date)
  VALUES (p_tenancy_id, p_period_start, p_period_end, p_due_date)
  RETURNING bill_id INTO v_bill_id;

  INSERT INTO public.bill_items (bill_id, item_type, quantity, unit_price)
  VALUES (v_bill_id, 'rent', 1, v_rent);

  INSERT INTO public.bill_items (bill_id, item_type, quantity, unit_price)
  SELECT v_bill_id, charge.item_type, 1, charge.unit_price
  FROM (
    SELECT charge_type.item_type,
           coalesce(tenancy_charge.unit_price, owner_charge.unit_price) AS unit_price
    FROM (VALUES
      ('water'::public.bill_item_type),
      ('trash'::public.bill_item_type),
      ('wifi'::public.bill_item_type)
    ) AS charge_type(item_type)
    JOIN public.tenancy t ON t.tenancy_id = p_tenancy_id
    LEFT JOIN public.tenancy_default_charges tenancy_charge
      ON tenancy_charge.tenancy_id = t.tenancy_id
      AND tenancy_charge.item_type = charge_type.item_type
    LEFT JOIN public.owner_default_charges owner_charge
      ON owner_charge.owner_id = t.owner_id
      AND owner_charge.item_type = charge_type.item_type
  ) AS charge
  WHERE charge.unit_price IS NOT NULL;

  RETURN v_bill_id;
END;
$function$;