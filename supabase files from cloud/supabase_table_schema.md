DATABASE SCHEMA
CREATE TABLE public.owner_profile (
  id uuid NOT NULL,
  full_name text DEFAULT 'NULL'::text,
  phone_number text,
  email_address text,
  last_updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT owner_profile_pkey PRIMARY KEY (id),
  CONSTRAINT owner_profile_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.boarding_house (
  boarding_house_id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text DEFAULT ''::text,
  address text,
  last_updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT boarding_house_pkey PRIMARY KEY (boarding_house_id),
  CONSTRAINT boarding_house_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owner_profile(id)
);
CREATE TABLE public.rooms (
  room_id uuid NOT NULL DEFAULT gen_random_uuid(),
  boarding_house_id uuid NOT NULL,
  monthly_rate numeric NOT NULL,
  room_name character varying NOT NULL,
  is_occupied boolean NOT NULL DEFAULT false,
  last_updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rooms_pkey PRIMARY KEY (room_id),
  CONSTRAINT rooms_boarding_house_id_fkey FOREIGN KEY (boarding_house_id) REFERENCES public.boarding_house(boarding_house_id)
);
CREATE TABLE public.tenants (
  tenant_id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name character varying NOT NULL,
  contact_number character varying,
  email_address character varying,
  id_photo_url text UNIQUE,
  last_updated_at timestamp with time zone,
  CONSTRAINT tenants_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT tenants_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owner_profile(id)
);
CREATE TABLE public.tenant_archive (
  archive_id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  tenant_id uuid,
  tenant_name text NOT NULL,
  contact_number character varying,
  email_address character varying,
  move_in_date date NOT NULL,
  move_out_date date NOT NULL,
  room_name character varying,
  boarding_house_name text,
  boarding_house_address text,
  id_photo_path text,
  agreement_photo_path text,
  notes text,
  archived_at timestamp with time zone NOT NULL DEFAULT now(),
  tenancy_id uuid UNIQUE,
  CONSTRAINT tenant_archive_pkey PRIMARY KEY (archive_id),
  CONSTRAINT tenant_archive_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owner_profile(id),
  CONSTRAINT tenant_archive_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id),
  CONSTRAINT tenant_archive_tenancy_id_fkey FOREIGN KEY (tenancy_id) REFERENCES public.tenancy(tenancy_id)
);
CREATE TABLE public.tenancy (
  tenancy_id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  room_id uuid NOT NULL,
  move_in_date date DEFAULT CURRENT_DATE,
  move_out_date date,
  monthly_rate numeric,
  billing_cycle_start text DEFAULT to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text),
  status character varying DEFAULT 'active'::character varying CHECK (status::text = ANY (ARRAY['scheduled'::character varying, 'active'::character varying, 'ended'::character varying]::text[])),
  agreement_photo_url text,
  created_at timestamp with time zone DEFAULT now(),
  last_updated_at timestamp with time zone,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  CONSTRAINT tenancy_pkey PRIMARY KEY (tenancy_id),
  CONSTRAINT fk_room_id FOREIGN KEY (room_id) REFERENCES public.rooms(room_id),
  CONSTRAINT fk_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id),
  CONSTRAINT tenancy_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owner_profile(id)
);
CREATE TABLE public.meter_readings (
  reading_id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  reading_value numeric NOT NULL CHECK (reading_value >= 0::numeric),
  reading_at date NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT meter_readings_pkey PRIMARY KEY (reading_id),
  CONSTRAINT meter_readings_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(room_id)
);
CREATE TABLE public.monthly_bill (
  bill_id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenancy_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  due_date date NOT NULL,
  billed_at timestamp with time zone,
  total_amount numeric NOT NULL DEFAULT 0,
  paid_at timestamp with time zone,
  is_paid boolean DEFAULT (paid_at IS NOT NULL),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT monthly_bill_pkey PRIMARY KEY (bill_id),
  CONSTRAINT monthly_bill_tenancy_id_fkey FOREIGN KEY (tenancy_id) REFERENCES public.tenancy(tenancy_id)
);
CREATE TABLE public.bill_items (
  bill_item_id uuid NOT NULL DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL,
  item_type USER-DEFINED NOT NULL,
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL,
  start_reading_id uuid,
  end_reading_id uuid,
  amount numeric DEFAULT (quantity * unit_price),
  CONSTRAINT bill_items_pkey PRIMARY KEY (bill_item_id),
  CONSTRAINT bill_items_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.monthly_bill(bill_id),
  CONSTRAINT bill_items_start_reading_id_fkey FOREIGN KEY (start_reading_id) REFERENCES public.meter_readings(reading_id),
  CONSTRAINT bill_items_end_reading_id_fkey FOREIGN KEY (end_reading_id) REFERENCES public.meter_readings(reading_id)
);
CREATE TABLE public.bill_reminders (
  reminder_id uuid NOT NULL DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL,
  reminder_type USER-DEFINED NOT NULL,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bill_reminders_pkey PRIMARY KEY (reminder_id),
  CONSTRAINT bill_reminders_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.monthly_bill(bill_id)
);
CREATE TABLE public.room_default_charges (
  room_id uuid NOT NULL,
  item_type USER-DEFINED NOT NULL CHECK (item_type = ANY (ARRAY['rent'::bill_item_type, 'water'::bill_item_type, 'trash'::bill_item_type, 'wifi'::bill_item_type, 'electricity'::bill_item_type])),
  unit_price numeric NOT NULL CHECK (unit_price >= 0::numeric),
  CONSTRAINT room_default_charges_pkey PRIMARY KEY (room_id, item_type),
  CONSTRAINT room_default_charges_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(room_id)
);
CREATE TABLE public.owner_default_charges (
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  item_type USER-DEFINED NOT NULL CHECK (item_type::text = ANY (ARRAY['water'::text, 'trash'::text, 'wifi'::text, 'electricity'::text])),
  unit_price numeric NOT NULL CHECK (unit_price >= 0::numeric),
  CONSTRAINT owner_default_charges_pkey PRIMARY KEY (owner_id, item_type),
  CONSTRAINT owner_default_charges_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owner_profile(id)
);

## Custom Types / Enums

### `bill_item_type`

`rent` | `water` | `trash` | `wifi` | `electricity` | `adjustment`

### `reminder_type`

`two_days_before` | `on_due_date`

## RLS Policies

### `owner_profile`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `user can edit user information` | UPDATE | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = id)` | — |
| `user can view own profile` | SELECT | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = id)` | — |

### `rooms`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated users can insert their own rooms` | INSERT | authenticated | PERMISSIVE | — | `(EXISTS ( SELECT 1    FROM boarding_house   WHERE ((boarding_house.boarding_house_id = rooms.boarding_house_id) AND (boarding_house.owner_id = auth.uid()))))` |
| `authenticated user can view their own rooms` | SELECT | authenticated | PERMISSIVE | `(EXISTS ( SELECT 1    FROM boarding_house   WHERE ((boarding_house.boarding_house_id = rooms.boarding_house_id) AND (boarding_house.owner_id = auth.uid()))))` | — |
| `authenticated users can delete or remove their own rooms` | DELETE | authenticated | PERMISSIVE | `(EXISTS ( SELECT 1    FROM boarding_house   WHERE ((boarding_house.boarding_house_id = rooms.boarding_house_id) AND (boarding_house.owner_id = auth.uid()))))` | — |
| `authenticated users can edit their own rooms` | UPDATE | authenticated | PERMISSIVE | `(EXISTS ( SELECT 1    FROM boarding_house bh   WHERE ((bh.boarding_house_id = rooms.boarding_house_id) AND (bh.owner_id = auth.uid()))))` | — |

### `room_default_charges`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `owners manage own room charges` | ALL | authenticated | PERMISSIVE | `(EXISTS ( SELECT 1    FROM (rooms r      JOIN boarding_house bh ON ((bh.boarding_house_id = r.boarding_house_id)))   WHERE ((r.room_id = room_default_charges.room_id) AND (bh.owner_id = ( SELECT auth.uid() AS uid)))))` | `(EXISTS ( SELECT 1    FROM (rooms r      JOIN boarding_house bh ON ((bh.boarding_house_id = r.boarding_house_id)))   WHERE ((r.room_id = room_default_charges.room_id) AND (bh.owner_id = ( SELECT auth.uid() AS uid)))))` |

### `meter_readings`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `owners manage own meter readings` | ALL | authenticated | PERMISSIVE | `(EXISTS ( SELECT 1    FROM (rooms r      JOIN boarding_house bh ON ((bh.boarding_house_id = r.boarding_house_id)))   WHERE ((r.room_id = meter_readings.room_id) AND (bh.owner_id = ( SELECT auth.uid() AS uid)))))` | `(EXISTS ( SELECT 1    FROM (rooms r      JOIN boarding_house bh ON ((bh.boarding_house_id = r.boarding_house_id)))   WHERE ((r.room_id = meter_readings.room_id) AND (bh.owner_id = ( SELECT auth.uid() AS uid)))))` |

### `monthly_bill`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `owners view own bills` | SELECT | authenticated | PERMISSIVE | `(EXISTS ( SELECT 1    FROM tenancy t   WHERE ((t.tenancy_id = monthly_bill.tenancy_id) AND (t.owner_id = ( SELECT auth.uid() AS uid)))))` | — |
| `owners add bills` | INSERT | authenticated | PERMISSIVE | — | `(EXISTS ( SELECT 1    FROM tenancy t   WHERE ((t.tenancy_id = monthly_bill.tenancy_id) AND (t.owner_id = ( SELECT auth.uid() AS uid)))))` |
| `owners update bills` | UPDATE | authenticated | PERMISSIVE | `(EXISTS ( SELECT 1    FROM tenancy t   WHERE ((t.tenancy_id = monthly_bill.tenancy_id) AND (t.owner_id = ( SELECT auth.uid() AS uid)))))` | `(EXISTS ( SELECT 1    FROM tenancy t   WHERE ((t.tenancy_id = monthly_bill.tenancy_id) AND (t.owner_id = ( SELECT auth.uid() AS uid)))))` |

### `boarding_house`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `authenticated users can edit their own dataa` | UPDATE | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = owner_id)` | — |
| `authenticated users can add their own data` | INSERT | authenticated | PERMISSIVE | — | `(( SELECT auth.uid() AS uid) = owner_id)` |
| `authenticated users can view their own data` | SELECT | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = owner_id)` | — |
| `authenticated users can delete their own data` | DELETE | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = owner_id)` | — |

### `bill_items`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `owners manage their bill items` | ALL | authenticated | PERMISSIVE | `(EXISTS ( SELECT 1    FROM (((monthly_bill mb      JOIN tenancy t ON ((t.tenancy_id = mb.tenancy_id)))      JOIN rooms r ON ((r.room_id = t.room_id)))      JOIN boarding_house b ON ((b.boarding_house_id = r.boarding_house_id)))   WHERE ((mb.bill_id = bill_items.bill_id) AND (b.owner_id = ( SELECT auth.uid() AS uid)))))` | `(EXISTS ( SELECT 1    FROM (((monthly_bill mb      JOIN tenancy t ON ((t.tenancy_id = mb.tenancy_id)))      JOIN rooms r ON ((r.room_id = t.room_id)))      JOIN boarding_house b ON ((b.boarding_house_id = r.boarding_house_id)))   WHERE ((mb.bill_id = bill_items.bill_id) AND (b.owner_id = ( SELECT auth.uid() AS uid)))))` |

### `bill_reminders`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `owners view own bill reminders` | SELECT | authenticated | PERMISSIVE | `(EXISTS ( SELECT 1    FROM (monthly_bill mb      JOIN tenancy t ON ((t.tenancy_id = mb.tenancy_id)))   WHERE ((mb.bill_id = bill_reminders.bill_id) AND (t.owner_id = ( SELECT auth.uid() AS uid)))))` | — |

### `tenant_archive`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `owner can view own archive` | SELECT | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = owner_id)` | — |
| `owner can add to own archive` | INSERT | authenticated | PERMISSIVE | — | `(( SELECT auth.uid() AS uid) = owner_id)` |

### `tenants`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `Enable users to view their own data only` | SELECT | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = owner_id)` | — |
| `Enable delete for users based on user_id` | DELETE | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = owner_id)` | — |
| `Enable insert for users based on user_id` | INSERT | authenticated | PERMISSIVE | — | `(( SELECT auth.uid() AS uid) = owner_id)` |
| `authenticated users can edit their own tenants` | UPDATE | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = owner_id)` | `(( SELECT auth.uid() AS uid) = owner_id)` |

### `tenancy`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `owners view own tenancies` | SELECT | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = owner_id)` | — |
| `owners add tenancies for own rooms and tenants` | INSERT | authenticated | PERMISSIVE | — | `((( SELECT auth.uid() AS uid) = owner_id) AND (EXISTS ( SELECT 1    FROM (rooms r      JOIN boarding_house bh ON ((bh.boarding_house_id = r.boarding_house_id)))   WHERE ((r.room_id = tenancy.room_id) AND (bh.owner_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1    FROM tenants t   WHERE ((t.tenant_id = tenancy.tenant_id) AND (t.owner_id = ( SELECT auth.uid() AS uid))))))` |
| `owners update own tenancies` | UPDATE | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = owner_id)` | `((( SELECT auth.uid() AS uid) = owner_id) AND (EXISTS ( SELECT 1    FROM (rooms r      JOIN boarding_house bh ON ((bh.boarding_house_id = r.boarding_house_id)))   WHERE ((r.room_id = tenancy.room_id) AND (bh.owner_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1    FROM tenants t   WHERE ((t.tenant_id = tenancy.tenant_id) AND (t.owner_id = ( SELECT auth.uid() AS uid))))))` |

### `owner_default_charges`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `owners manage own default charges` | ALL | authenticated | PERMISSIVE | `(( SELECT auth.uid() AS uid) = owner_id)` | `(( SELECT auth.uid() AS uid) = owner_id)` |


DATABASE FUNCTIONS
auto_archive_tenancy function() -> returns trigger
begin
  -- a mistaken move-out date was corrected: undo the archive entry
  if tg_op = 'UPDATE' and old.status = 'ended' and new.status <> 'ended' then
    delete from public.tenant_archive where tenancy_id = new.tenancy_id;
    return null;
  end if;

  if new.status = 'ended' and (tg_op = 'INSERT' or old.status is distinct from 'ended') then
    insert into public.tenant_archive (
      owner_id, tenant_id, tenancy_id, tenant_name, contact_number, email_address,
      move_in_date, move_out_date, room_name, boarding_house_name,
      boarding_house_address, id_photo_path, agreement_photo_path)
    select ty.owner_id, t.tenant_id, ty.tenancy_id, t.name, t.contact_number, t.email_address,
           ty.move_in_date, ty.move_out_date, r.room_name, bh.name, bh.address,
           t.id_photo_url, ty.agreement_photo_url
    from public.tenancy ty
    join public.tenants t on t.tenant_id = ty.tenant_id
    join public.rooms r on r.room_id = ty.room_id
    join public.boarding_house bh on bh.boarding_house_id = r.boarding_house_id
    where ty.tenancy_id = new.tenancy_id
    on conflict (tenancy_id) do nothing;
  end if;

  return null;
end;

block_finalized_bill_edit() function -> returns trigger
declare b uuid := coalesce(new.bill_id, old.bill_id);
begin
  if exists (select 1 from monthly_bill where bill_id = b and billed_at is not null) then
    raise exception 'Bill % is finalized; its items cannot be changed', b;
  end if;
  return coalesce(new, old);
end 

cycle_date function(p_anchor: date, p_month: date) -> returns date
  select least(
    date_trunc('month', p_month)::date + (extract(day from p_anchor)::int - 1),
    (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date
  );

fn_last_updated() function -> returns trigger
begin
  NEW.last_updated_at := now();
  RETURN NEW;
END; 

fn_sync_room_occupany() function -> returns trigger
declare
  rid uuid;
begin
  for rid in
    select distinct x
    from unnest(array[
      case when tg_op in ('UPDATE', 'DELETE') then old.room_id end,
      case when tg_op in ('INSERT', 'UPDATE') then new.room_id end
    ]) as x
    where x is not null
  loop
    update public.rooms r
    set is_occupied = exists (
      select 1
      from public.tenancy t
      where t.room_id = rid
        and t.status = 'active'
    )
    where r.room_id = rid;
  end loop;

  return null;
end;

generate_due_bills() function -> returns trigger
declare
  today       date := (now() at time zone 'Asia/Manila')::date;
  due_in_days int  := 0;      -- days after period start that the bill is due
  r           record;
  ps          date;
  pe          date;
  n           int := 0;
begin
  for r in
    select tenancy_id, move_in_date
    from public.tenancy
    where status = 'active'
  loop
    -- current period = from the latest cycle date on or before today
    if public.cycle_date(r.move_in_date, today) <= today then
      ps := public.cycle_date(r.move_in_date, today);
      pe := public.cycle_date(r.move_in_date, (today + interval '1 month')::date) - 1;
    else
      ps := public.cycle_date(r.move_in_date, (today - interval '1 month')::date);
      pe := public.cycle_date(r.move_in_date, today) - 1;
    end if;

    if ps < r.move_in_date then ps := r.move_in_date; end if;

    -- already billed for this period?
    if exists (select 1 from public.monthly_bill b
               where b.tenancy_id = r.tenancy_id and b.period_start = ps) then
      continue;
    end if;

    begin
      perform public.generate_monthly_bill(r.tenancy_id, ps, pe, ps + due_in_days);
      n := n + 1;
    exception when others then
      -- one bad tenancy must not block everyone else's bill
      raise warning 'Bill generation failed for tenancy %: %', r.tenancy_id, sqlerrm;
    end;
  end loop;

  return n;
end;

generate_monthly_bill(p_tenancy_id: uuid, p_period_start: date, p_period_end: date, p_due_date: date) funtion -> returns uuid
declare
  v_bill_id uuid;
  v_room uuid;
  v_rent numeric;
begin
  select room_id, monthly_rate into v_room, v_rent
  from public.tenancy
  where tenancy_id = p_tenancy_id and status = 'active';

  if v_room is null then
    raise exception 'No active tenancy found';
  end if;

  insert into public.monthly_bill (tenancy_id, period_start, period_end, due_date)
  values (p_tenancy_id, p_period_start, p_period_end, p_due_date)
  returning bill_id into v_bill_id;

  insert into public.bill_items (bill_id, item_type, quantity, unit_price)
  values (v_bill_id, 'rent', 1, v_rent);

  insert into public.bill_items (bill_id, item_type, quantity, unit_price)
  select v_bill_id, o.item_type, 1, o.unit_price
  from public.owner_default_charges o
  join public.tenancy t on t.owner_id = o.owner_id
  where t.tenancy_id = p_tenancy_id
    and o.item_type::text <> 'electricity';

  return v_bill_id;
end;

handle_new_user() function -> returns trigger
begin
  insert into public.owner_profile (id, full_name, phone_number, email_address)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone_number',
    new.email
  );
  return new;
end;

recalc_bill_total() function -> returns trigger
declare b uuid := coalesce(new.bill_id, old.bill_id);
begin
  update monthly_bill
     set total_amount = coalesce((select sum(amount) from bill_items where bill_id = b), 0),
         updated_at   = now()
   where bill_id = b;
  return null;
end 


refresh_tenancy_statuses function -> returns void
declare
  today date := (now() at time zone 'Asia/Manila')::date;
begin
  -- 1) End first, so a room is freed before the next tenant is activated
  update public.tenancy
  set status = 'ended', last_updated_at = now()
  where status = 'active'
    and move_out_date is not null
    and move_out_date <= today;

  -- 2) Then activate tenancies whose move-in day has arrived
  update public.tenancy
  set status = 'active', last_updated_at = now()
  where status = 'scheduled'
    and move_in_date <= today
    and (move_out_date is null or move_out_date > today);

  -- 3) Scheduled tenancies that were already over (missed days) become ended
  update public.tenancy
  set status = 'ended', last_updated_at = now()
  where status = 'scheduled'
    and move_out_date is not null
    and move_out_date <= today;
end;


refresh_tenant_documents(p_tenant_id: uuid, p_action: text, p_archived_id_path: text, p_archived_agreement_path: text) -> no return type
declare
  t public.tenants;
  r public.rooms;
  b public.boarding_house;
begin
  if p_action not in ('archive', 'delete') then
    raise exception 'p_action must be ''archive'' or ''delete''';
  end if;

  select * into t from public.tenants where tenant_id = p_tenant_id;  -- RLS applies
  if not found then
    raise exception 'Tenant not found';
  end if;
  if t.end_date is null then
    raise exception 'Tenant has not moved out yet';
  end if;
  if t.documents_status <> 'active' then
    raise exception 'Documents already %', t.documents_status;
  end if;

  if p_action = 'archive' then
    select * into r from public.rooms where room_id = t.room_id;
    select * into b from public.boarding_house where boarding_house_id = r.boarding_house_id;

    insert into public.tenant_archive (
      owner_id, tenant_id, tenant_name, contact_number, email_address,
      start_date, end_date, room_name, boarding_house_name, boarding_house_address,
      id_photo_path, agreement_photo_path
    ) values (
      b.owner_id, t.tenant_id, t.name, t.contact_number, t.email_address,
      t.start_date, t.end_date, r.room_name, b.name, b.address,
      coalesce(p_archived_id_path, t.id_photo_url),
      coalesce(p_archived_agree_path, t.agreement_photo_url)
    );

    -- Paths now live in the archive; clear them from the live tenant row.
    update public.tenants
       set documents_status = 'archived',
           documents_resolved_at = now(),
           id_photo_url = null,
           agreement_photo_url = null
     where tenant_id = p_tenant_id;
  else
    update public.tenants
       set documents_status = 'deleted',
           documents_resolved_at = now(),
           id_photo_url = null,
           agreement_photo_url = null
     where tenant_id = p_tenant_id;
  end if;

  -- Return the ORIGINAL paths so the app can move or delete the files.
  return query select t.id_photo_url, t.agreement_photo_url;
end;

set_electricity_quantity() function -> returns trigger
declare
  s record;
  e record;
  bill_room uuid;
begin
  if new.item_type <> 'electricity' then
    new.start_reading_id := null;
    new.end_reading_id := null;
    return new;
  end if;

  if new.start_reading_id is null or new.end_reading_id is null then
    raise exception 'Electricity items need a start and an end reading';
  end if;

  select * into s from public.meter_readings where reading_id = new.start_reading_id;
  select * into e from public.meter_readings where reading_id = new.end_reading_id;

  if s.reading_id is null or e.reading_id is null then
    raise exception 'Meter reading not found';
  end if;

  select ty.room_id into bill_room
  from public.monthly_bill b
  join public.tenancy ty on ty.tenancy_id = b.tenancy_id
  where b.bill_id = new.bill_id;

  if s.room_id <> e.room_id or s.room_id <> bill_room then
    raise exception 'Both readings must belong to the bill''s room';
  end if;

  if e.reading_at <= s.reading_at or e.reading_value < s.reading_value then
    raise exception 'End reading must be later and not lower than the start reading';
  end if;

  new.unit_price := e.reading_value - s.reading_value;
  return new;
end;


set_room_rent_amount() function -> returns trigger
begin
  if new.monthly_rate is null then
    select r.monthly_rate into new.monthly_rate
    from public.rooms r
    where r.room_id = new.room_id;
  end if;
  return new;
end;

set_tenancy_status() function -> returns trigger
declare
  today date := (now() at time zone 'Asia/Manila')::date;
begin
  new.status := case
    when new.move_out_date is not null and new.move_out_date <= today then 'ended'
    when new.move_in_date <= today then 'active'
    else 'scheduled'
  end;
  new.last_updated_at := now();
  return new;
end;

DATABASE FUNCTION TRIGGERS
| Name | Table | Function | Events | Orientation |
|------|-------|----------|--------|-------------|
| `auto_archive_on_move_out` | `tenancy` | `auto_archive_tenancy` | AFTER UPDATE, AFTER INSERT | ROW |
| `bill_items_lock` | `bill_items` | `block_finalized_bill_edit` | BEFORE DELETE, BEFORE INSERT, BEFORE UPDATE | ROW |
| `bill_items_total` | `bill_items` | `recalc_bill_total` | AFTER DELETE, AFTER INSERT, AFTER UPDATE | ROW |
| `derive_tenancy_status` | `tenancy` | `set_tenancy_status` | BEFORE INSERT, BEFORE UPDATE | ROW |
| `electricity_quantity` | `bill_items` | `set_electricity_quantity` | BEFORE INSERT, BEFORE UPDATE | ROW |
| `set_default_monthly_rate` | `tenancy` | `set_room_rent_amount` | BEFORE INSERT | ROW |
| `sync_room_occupancy` | `tenancy` | `fn_sync_room_occupancy` | AFTER UPDATE, AFTER DELETE, AFTER INSERT | ROW |
| `trg_last_updated` | `owner_profile` | `fn_last_updated` | BEFORE UPDATE | ROW |
| `trg_last_updated` | `tenants` | `fn_last_updated` | BEFORE UPDATE | ROW |
| `trg_last_updated` | `boarding_house` | `fn_last_updated` | BEFORE UPDATE | ROW |
| `trg_last_updated` | `rooms` | `fn_last_updated` | BEFORE UPDATE | ROW |
| `trg_last_updated` | `tenancy` | `fn_last_updated` | BEFORE UPDATE | ROW |


DATABASE INDEXES
| tablename             | indexname                                 | indexdef                                                                                                                    |
| --------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| bill_items            | bill_items_bill_id_idx                    | CREATE INDEX bill_items_bill_id_idx ON public.bill_items USING btree (bill_id)                                              |
| bill_items            | bill_items_pkey                           | CREATE UNIQUE INDEX bill_items_pkey ON public.bill_items USING btree (bill_item_id)                                         |
| bill_reminders        | bill_reminders_bill_id_idx                | CREATE INDEX bill_reminders_bill_id_idx ON public.bill_reminders USING btree (bill_id)                                      |
| bill_reminders        | bill_reminders_bill_id_reminder_type_key  | CREATE UNIQUE INDEX bill_reminders_bill_id_reminder_type_key ON public.bill_reminders USING btree (bill_id, reminder_type)  |
| bill_reminders        | bill_reminders_bill_id_reminder_type_key1 | CREATE UNIQUE INDEX bill_reminders_bill_id_reminder_type_key1 ON public.bill_reminders USING btree (bill_id, reminder_type) |
| bill_reminders        | bill_reminders_pkey                       | CREATE UNIQUE INDEX bill_reminders_pkey ON public.bill_reminders USING btree (reminder_id)                                  |
| boarding_house        | boarding_house_pkey                       | CREATE UNIQUE INDEX boarding_house_pkey ON public.boarding_house USING btree (boarding_house_id)                            |
| meter_readings        | meter_readings_pkey                       | CREATE UNIQUE INDEX meter_readings_pkey ON public.meter_readings USING btree (reading_id)                                   |
| meter_readings        | meter_readings_room_id_reading_at_idx     | CREATE INDEX meter_readings_room_id_reading_at_idx ON public.meter_readings USING btree (room_id, reading_at DESC)          |
| meter_readings        | meter_readings_room_id_reading_at_key     | CREATE UNIQUE INDEX meter_readings_room_id_reading_at_key ON public.meter_readings USING btree (room_id, reading_at)        |
| meter_readings        | meter_readings_room_id_reading_at_key1    | CREATE UNIQUE INDEX meter_readings_room_id_reading_at_key1 ON public.meter_readings USING btree (room_id, reading_at)       |
| monthly_bill          | monthly_bill_created_at_idx               | CREATE INDEX monthly_bill_created_at_idx ON public.monthly_bill USING btree (created_at)                                    |
| monthly_bill          | monthly_bill_due_date_idx                 | CREATE INDEX monthly_bill_due_date_idx ON public.monthly_bill USING btree (due_date) WHERE (paid_at IS NULL)                |
| monthly_bill          | monthly_bill_pkey                         | CREATE UNIQUE INDEX monthly_bill_pkey ON public.monthly_bill USING btree (bill_id)                                          |
| monthly_bill          | monthly_bill_tenancy_id_period_start_idx  | CREATE INDEX monthly_bill_tenancy_id_period_start_idx ON public.monthly_bill USING btree (tenancy_id, period_start)         |
| monthly_bill          | monthly_bill_tenancy_id_period_start_key  | CREATE UNIQUE INDEX monthly_bill_tenancy_id_period_start_key ON public.monthly_bill USING btree (tenancy_id, period_start)  |
| monthly_bill          | monthly_bill_tenancy_id_period_start_key1 | CREATE UNIQUE INDEX monthly_bill_tenancy_id_period_start_key1 ON public.monthly_bill USING btree (tenancy_id, period_start) |
| owner_default_charges | owner_default_charges_pkey                | CREATE UNIQUE INDEX owner_default_charges_pkey ON public.owner_default_charges USING btree (owner_id, item_type)            |
| owner_profile         | owner_profile_pkey                        | CREATE UNIQUE INDEX owner_profile_pkey ON public.owner_profile USING btree (id)                                             |
| room_default_charges  | room_default_charges_pkey                 | CREATE UNIQUE INDEX room_default_charges_pkey ON public.room_default_charges USING btree (room_id, item_type)               |
| rooms                 | rooms_pkey                                | CREATE UNIQUE INDEX rooms_pkey ON public.rooms USING btree (room_id)                                                        |
| rooms                 | unique_boarding_house_room                | CREATE UNIQUE INDEX unique_boarding_house_room ON public.rooms USING btree (boarding_house_id, room_name)                   |
| tenancy               | one_active_tenancy_per_room               | CREATE UNIQUE INDEX one_active_tenancy_per_room ON public.tenancy USING btree (room_id) WHERE (move_out_date IS NULL)       |
| tenancy               | pk_tenancy_id                             | CREATE UNIQUE INDEX pk_tenancy_id ON public.tenancy USING btree (tenancy_id)                                                |
| tenancy               | tenancy_room_id_idx                       | CREATE INDEX tenancy_room_id_idx ON public.tenancy USING btree (room_id)                                                    |
| tenancy               | tenancy_status_idx                        | CREATE INDEX tenancy_status_idx ON public.tenancy USING btree (status)                                                      |
| tenancy               | tenancy_tenant_id_idx                     | CREATE INDEX tenancy_tenant_id_idx ON public.tenancy USING btree (tenant_id)                                                |
| tenant_archive        | tenant_archive_owner_idx                  | CREATE INDEX tenant_archive_owner_idx ON public.tenant_archive USING btree (owner_id, archived_at DESC)                     |
| tenant_archive        | tenant_archive_pkey                       | CREATE UNIQUE INDEX tenant_archive_pkey ON public.tenant_archive USING btree (archive_id)                                   |
| tenant_archive        | tenant_archive_tenancy_id_key             | CREATE UNIQUE INDEX tenant_archive_tenancy_id_key ON public.tenant_archive USING btree (tenancy_id)                         |
| tenants               | tenant_pkey                               | CREATE UNIQUE INDEX tenant_pkey ON public.tenants USING btree (tenant_id)                                                   |
| tenants               | tenants_last_updated_at_key               | CREATE UNIQUE INDEX tenants_last_updated_at_key ON public.tenants USING btree (id_photo_url)                                |

UNIQUE CONSTRAINTS
| table_name            | conname                                  | pg_get_constraintdef                  |
| --------------------- | ---------------------------------------- | ------------------------------------- |
| owner_profile         | owner_profile_pkey                       | PRIMARY KEY (id)                      |
| boarding_house        | boarding_house_pkey                      | PRIMARY KEY (boarding_house_id)       |
| rooms                 | unique_boarding_house_room               | UNIQUE (boarding_house_id, room_name) |
| rooms                 | rooms_pkey                               | PRIMARY KEY (room_id)                 |
| tenants               | tenants_last_updated_at_key              | UNIQUE (id_photo_url)                 |
| tenants               | tenant_pkey                              | PRIMARY KEY (tenant_id)               |
| tenant_archive        | tenant_archive_pkey                      | PRIMARY KEY (archive_id)              |
| tenant_archive        | tenant_archive_tenancy_id_key            | UNIQUE (tenancy_id)                   |
| tenancy               | pk_tenancy_id                            | PRIMARY KEY (tenancy_id)              |
| meter_readings        | meter_readings_room_id_reading_at_key    | UNIQUE (room_id, reading_at)          |
| meter_readings        | meter_readings_pkey                      | PRIMARY KEY (reading_id)              |
| monthly_bill          | monthly_bill_tenancy_id_period_start_key | UNIQUE (tenancy_id, period_start)     |
| monthly_bill          | monthly_bill_pkey                        | PRIMARY KEY (bill_id)                 |
| bill_items            | bill_items_pkey                          | PRIMARY KEY (bill_item_id)            |
| bill_reminders        | bill_reminders_bill_id_reminder_type_key | UNIQUE (bill_id, reminder_type)       |
| bill_reminders        | bill_reminders_pkey                      | PRIMARY KEY (reminder_id)             |
| room_default_charges  | room_default_charges_pkey                | PRIMARY KEY (room_id, item_type)      |
| owner_default_charges | owner_default_charges_pkey               | PRIMARY KEY (owner_id, item_type)     |


## Tables and RLS policies

Based on the table inventory and policy listing already retrieved for `public`, `auth`, `storage`, `realtime`, and `cron`. **“No policy listed” means the policy listing returned none for that table; it does not by itself prove the table is inaccessible.** RLS enabled/disabled status is from the table inventory. Force-RLS status was not provided.

### `public` — all listed tables have RLS enabled

- `owner_profile`
  - `user can view own profile` — SELECT, authenticated; row ID must equal `auth.uid()`.
  - `user can edit user information` — UPDATE, authenticated; row ID must equal `auth.uid()`.
- `boarding_house`
  - `authenticated users can view their own data` — SELECT, authenticated; `owner_id` must equal `auth.uid()`.
  - `authenticated users can add their own data` — INSERT, authenticated; check requires `owner_id = auth.uid()`.
  - `authenticated users can edit their own dataa` — UPDATE, authenticated; `owner_id` must equal `auth.uid()`.
  - `authenticated users can delete their own data` — DELETE, authenticated; `owner_id` must equal `auth.uid()`.
- `rooms`
  - `authenticated user can view their own rooms` — SELECT, authenticated; room must belong to a boarding house owned by `auth.uid()`.
  - `authenticated users can insert their own rooms` — INSERT, authenticated; check requires a boarding house owned by `auth.uid()`.
  - `authenticated users can edit their own rooms` — UPDATE, authenticated; room must belong to a boarding house owned by `auth.uid()`.
  - `authenticated users can delete or remove their own rooms` — DELETE, authenticated; room must belong to a boarding house owned by `auth.uid()`.
- `tenants`
  - `Enable users to view their own data only` — SELECT, authenticated; `owner_id = auth.uid()`.
  - `Enable insert for users based on user_id` — INSERT, authenticated; check requires `owner_id = auth.uid()`.
  - `authenticated users can edit their own tenants` — UPDATE, authenticated; row and new value must have `owner_id = auth.uid()`.
  - `Enable delete for users based on user_id` — DELETE, authenticated; `owner_id = auth.uid()`.
- `tenant_archive`
  - `owner can view own archive` — SELECT, authenticated; `owner_id = auth.uid()`.
  - `owner can add to own archive` — INSERT, authenticated; check requires `owner_id = auth.uid()`.
- `tenancy`
  - `owners view own tenancies` — SELECT, authenticated; `owner_id = auth.uid()`.
  - `owners add tenancies for own rooms and tenants` — INSERT, authenticated; check requires the authenticated owner and rooms/tenants associated with that owner.
  - `owners update own tenancies` — UPDATE, authenticated; existing row must be owned by the user, with checks on the new owner, room, and tenant.
- `meter_readings`
  - `owners manage own meter readings` — ALL, authenticated; access is scoped through the room’s boarding-house owner.
- `monthly_bill`
  - `owners view own bills` — SELECT, authenticated; bill tenancy must have `owner_id = auth.uid()`.
  - `owners add bills` — INSERT, authenticated; check requires the bill tenancy to belong to the user.
  - `owners update bills` — UPDATE, authenticated; existing and new bill tenancy must belong to the user.
- `bill_items`
  - `owners manage their bill items` — ALL, authenticated; access is scoped through the bill, tenancy, room, and boarding-house owner.
- `bill_reminders`
  - `owners view own bill reminders` — SELECT, authenticated; reminder bill’s tenancy must have `owner_id = auth.uid()`.
- `room_default_charges`
  - `owners manage own room charges` — ALL, authenticated; access is scoped through the room’s boarding-house owner.
- `owner_default_charges`
  - `owners manage own default charges` — ALL, authenticated; `owner_id = auth.uid()`.

### `storage` — listed tables have RLS enabled

- `objects`
  - `owners access own files` — ALL, authenticated; restricted to bucket `Tenant_documents` and objects whose first folder component equals `auth.uid()`.
- `migrations`, `buckets`, `s3_multipart_uploads`, `s3_multipart_uploads_parts`, `buckets_analytics`, `buckets_vectors`, `vector_indexes` — no policy was returned in the listing.

### `cron`

Both listed tables have RLS enabled:

- `job`
  - `cron_job_policy` — ALL, public; `username = CURRENT_USER`.
- `job_run_details`
  - `cron_job_run_details_policy` — ALL, public; `username = CURRENT_USER`.

### `realtime`

- `messages` — RLS enabled; no policy was returned.
- `schema_migrations` and `subscription` — RLS disabled; no policy was returned.

### `auth`

RLS is enabled on: `users`, `refresh_tokens`, `instances`, `audit_log_entries`, `schema_migrations`, `identities`, `sessions`, `mfa_factors`, `mfa_challenges`, `mfa_amr_claims`, `sso_providers`, `sso_domains`, `saml_providers`, `saml_relay_states`, `flow_state`, and `one_time_tokens`.

RLS is disabled on: `oauth_clients`, `oauth_authorizations`, `oauth_consents`, `oauth_client_states`, `custom_oauth_providers`, `webauthn_credentials`, `webauthn_challenges`, `scim_users`, `scim_tokens`, `mfa_recovery_code_sets`, and `mfa_recovery_codes`.

No policies were returned for the listed `auth` tables.