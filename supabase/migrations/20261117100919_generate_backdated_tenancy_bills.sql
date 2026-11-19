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
    v_period_start := p_move_in_date;
    WHILE v_period_start <= v_today LOOP
      v_period_end :=
        public.cycle_date(p_move_in_date, (v_period_start + interval '1 month')::date) - 1;
      PERFORM public.generate_monthly_bill(
        v_tenancy_id,
        v_period_start,
        v_period_end,
        v_period_end
      );
      v_period_start := v_period_end + 1;
    END LOOP;
  END IF;

  RETURN v_tenancy_id;
END;
$function$;