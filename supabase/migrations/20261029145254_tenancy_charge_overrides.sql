CREATE TABLE public.tenancy_default_charges (
  tenancy_id uuid NOT NULL REFERENCES public.tenancy(tenancy_id) ON DELETE CASCADE,
  item_type public.bill_item_type NOT NULL
    CHECK (item_type IN ('water', 'trash', 'wifi', 'electricity')),
  unit_price numeric NOT NULL CHECK (
    unit_price >= 0
    AND unit_price < 'Infinity'::numeric
    AND unit_price <> 'NaN'::numeric
    AND scale(unit_price) <= 2
  ),
  PRIMARY KEY (tenancy_id, item_type)
);

ALTER TABLE public.tenancy_default_charges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tenancy_default_charges FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenancy_default_charges TO authenticated;
GRANT ALL ON TABLE public.tenancy_default_charges TO service_role;

CREATE POLICY "owners manage own tenancy charges"
  ON public.tenancy_default_charges
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenancy t
      WHERE t.tenancy_id = tenancy_default_charges.tenancy_id
        AND t.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tenancy t
      WHERE t.tenancy_id = tenancy_default_charges.tenancy_id
        AND t.owner_id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.register_tenancy(
  p_room_id uuid,
  p_name text,
  p_contact_number text,
  p_email_address text,
  p_id_photo_url text,
  p_agreement_photo_url text,
  p_move_in_date date,
  p_custom_charges jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := auth.uid();
  v_tenant_id uuid;
  v_tenancy_id uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_period_start date;
  v_period_end date;
  v_charge record;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = ''
     OR p_id_photo_url IS NULL OR p_agreement_photo_url IS NULL
     OR p_move_in_date IS NULL THEN
    RAISE EXCEPTION 'Tenant name, documents, and move-in date are required';
  END IF;

  IF array_length(string_to_array(p_id_photo_url, '/'), 1) <> 5
     OR array_length(string_to_array(p_agreement_photo_url, '/'), 1) <> 5
     OR split_part(p_id_photo_url, '/', 1) <> v_owner_id::text
     OR split_part(p_agreement_photo_url, '/', 1) <> v_owner_id::text
     OR split_part(p_id_photo_url, '/', 2) <> p_room_id::text
     OR split_part(p_agreement_photo_url, '/', 2) <> p_room_id::text
     OR split_part(p_id_photo_url, '/', 4) <> 'id'
     OR split_part(p_agreement_photo_url, '/', 4) <> 'agreement'
     OR split_part(p_id_photo_url, '/', 3) !~ '^[a-z0-9-]{10,80}$'
     OR split_part(p_agreement_photo_url, '/', 3) !~ '^[a-z0-9-]{10,80}$'
     OR split_part(p_id_photo_url, '/', 5) !~* '^[a-z0-9-]+\.(jpe?g|png|webp)$'
     OR split_part(p_agreement_photo_url, '/', 5) !~* '^[a-z0-9-]+\.(jpe?g|png|webp)$' THEN
    RAISE EXCEPTION 'Tenant documents must use unique paths in the signed-in owner room folder';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.rooms r
    JOIN public.boarding_house bh ON bh.boarding_house_id = r.boarding_house_id
    WHERE r.room_id = p_room_id
      AND bh.owner_id = v_owner_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.tenancy existing
        WHERE existing.room_id = r.room_id
          AND existing.status IN ('active', 'scheduled')
      )
  ) THEN
    RAISE EXCEPTION 'Room is unavailable or is not owned by this account';
  END IF;

  IF p_custom_charges IS NULL OR jsonb_typeof(p_custom_charges) <> 'array' THEN
    RAISE EXCEPTION 'Custom charges must be an array';
  END IF;

  INSERT INTO public.tenants (owner_id, name, contact_number, email_address, id_photo_url)
  VALUES (v_owner_id, btrim(p_name), nullif(btrim(p_contact_number), ''),
          nullif(btrim(p_email_address), ''), p_id_photo_url)
  RETURNING tenant_id INTO v_tenant_id;

  INSERT INTO public.tenancy (
    owner_id, tenant_id, room_id, move_in_date, agreement_photo_url
  )
  VALUES (v_owner_id, v_tenant_id, p_room_id, p_move_in_date, p_agreement_photo_url)
  RETURNING tenancy_id INTO v_tenancy_id;

  FOR v_charge IN
    SELECT item_type, unit_price
    FROM jsonb_to_recordset(p_custom_charges)
      AS custom_charge(item_type text, unit_price numeric)
  LOOP
    IF v_charge.item_type IS NULL
       OR v_charge.item_type NOT IN ('water', 'trash', 'wifi', 'electricity')
       OR v_charge.unit_price IS NULL
       OR v_charge.unit_price < 0
       OR v_charge.unit_price >= 'Infinity'::numeric
       OR v_charge.unit_price = 'NaN'::numeric
       OR scale(v_charge.unit_price) > 2 THEN
      RAISE EXCEPTION 'Custom charge type or rate is invalid';
    END IF;

    INSERT INTO public.tenancy_default_charges (tenancy_id, item_type, unit_price)
    VALUES (v_tenancy_id, v_charge.item_type::public.bill_item_type, v_charge.unit_price);
  END LOOP;

  IF p_move_in_date <= v_today THEN
    v_period_start := public.cycle_date(p_move_in_date, v_today);
    IF v_period_start > v_today THEN
      v_period_start := public.cycle_date(p_move_in_date, (v_today - interval '1 month')::date);
    END IF;
    v_period_end :=
      public.cycle_date(p_move_in_date, (v_period_start + interval '1 month')::date) - 1;
    PERFORM public.generate_monthly_bill(
      v_tenancy_id,
      v_period_start,
      v_period_end,
      v_period_start
    );
  END IF;

  RETURN v_tenancy_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_tenancy(
  uuid, text, text, text, text, text, date, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_tenancy(
  uuid, text, text, text, text, text, date, jsonb
) TO authenticated, service_role;

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
           coalesce(tenancy_charge.unit_price, room_charge.unit_price,
                    owner_charge.unit_price) AS unit_price
    FROM (VALUES
      ('water'::public.bill_item_type),
      ('trash'::public.bill_item_type),
      ('wifi'::public.bill_item_type)
    ) AS charge_type(item_type)
    JOIN public.tenancy t ON t.tenancy_id = p_tenancy_id
    LEFT JOIN public.tenancy_default_charges tenancy_charge
      ON tenancy_charge.tenancy_id = t.tenancy_id
      AND tenancy_charge.item_type = charge_type.item_type
    LEFT JOIN public.room_default_charges room_charge
      ON room_charge.room_id = t.room_id
      AND room_charge.item_type = charge_type.item_type
    LEFT JOIN public.owner_default_charges owner_charge
      ON owner_charge.owner_id = t.owner_id
      AND owner_charge.item_type = charge_type.item_type
  ) AS charge
  WHERE charge.unit_price IS NOT NULL;

  RETURN v_bill_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_electricity_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_bill_room uuid;
  v_tenancy_id uuid;
  v_owner_id uuid;
  v_rate numeric;
  v_usage numeric;
BEGIN
  IF new.item_type <> 'electricity' THEN
    new.start_reading_id := NULL;
    new.end_reading_id := NULL;
    RETURN new;
  END IF;

  IF new.start_reading_id IS NULL OR new.end_reading_id IS NULL THEN
    RAISE EXCEPTION 'Electricity items need a start and an end reading';
  END IF;

  SELECT * INTO v_start
  FROM public.meter_readings
  WHERE reading_id = new.start_reading_id;
  SELECT * INTO v_end
  FROM public.meter_readings
  WHERE reading_id = new.end_reading_id;

  IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL THEN
    RAISE EXCEPTION 'Meter reading not found';
  END IF;

  SELECT t.tenancy_id, t.owner_id, t.room_id
  INTO v_tenancy_id, v_owner_id, v_bill_room
  FROM public.monthly_bill b
  JOIN public.tenancy t ON t.tenancy_id = b.tenancy_id
  WHERE b.bill_id = new.bill_id;

  IF v_tenancy_id IS NULL THEN
    RAISE EXCEPTION 'Bill tenancy not found';
  END IF;

  IF v_start.room_id <> v_end.room_id OR v_start.room_id <> v_bill_room THEN
    RAISE EXCEPTION 'Both readings must belong to the bill''s room';
  END IF;

  IF v_end.reading_at <= v_start.reading_at
     OR v_end.reading_value < v_start.reading_value THEN
    RAISE EXCEPTION 'End reading must be later and not lower than the start reading';
  END IF;

  v_usage := v_end.reading_value - v_start.reading_value;

  SELECT coalesce(tenancy_charge.unit_price, room_charge.unit_price, owner_charge.unit_price)
  INTO v_rate
  FROM public.tenancy t
  LEFT JOIN public.tenancy_default_charges tenancy_charge
    ON tenancy_charge.tenancy_id = t.tenancy_id
    AND tenancy_charge.item_type = 'electricity'
  LEFT JOIN public.room_default_charges room_charge
    ON room_charge.room_id = t.room_id
    AND room_charge.item_type = 'electricity'
  LEFT JOIN public.owner_default_charges owner_charge
    ON owner_charge.owner_id = t.owner_id
    AND owner_charge.item_type = 'electricity'
  WHERE t.tenancy_id = v_tenancy_id;

  IF v_rate IS NULL THEN
    new.quantity := 1;
    new.unit_price := v_usage;
  ELSE
    new.quantity := v_usage;
    new.unit_price := v_rate;
  END IF;

  RETURN new;
END;
$function$;