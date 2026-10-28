DATABASE SCHEMA
## Table `owner_profile`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `full_name` | `text` |  Nullable |
| `phone_number` | `text` |  Nullable |
| `email_address` | `text` |  Nullable |
| `last_updated_at` | `timestamptz` |  Nullable |

## Table `boarding_house`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `boarding_house_id` | `uuid` | Primary |
| `owner_id` | `uuid` |  |
| `name` | `text` |  Nullable |
| `address` | `text` |  Nullable |
| `last_updated_at` | `timestamptz` |  |

## Table `rooms`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `room_id` | `uuid` | Primary |
| `boarding_house_id` | `uuid` |  |
| `monthly_rate` | `numeric` |  |
| `room_name` | `varchar` |  |
| `is_occupied` | `bool` |  |
| `last_updated_at` | `timestamptz` |  |

## Table `tenants`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `tenant_id` | `uuid` | Primary |
| `owner_id` | `uuid` |  |
| `name` | `varchar` |  |
| `contact_number` | `varchar` |  Nullable |
| `email_address` | `varchar` |  Nullable |
| `id_photo_url` | `text` |  Nullable Unique |
| `last_updated_at` | `timestamptz` |  Nullable |

## Table `tenant_archive`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `archive_id` | `uuid` | Primary |
| `owner_id` | `uuid` |  |
| `tenant_id` | `uuid` |  Nullable |
| `tenant_name` | `text` |  |
| `contact_number` | `varchar` |  Nullable |
| `email_address` | `varchar` |  Nullable |
| `move_in_date` | `date` |  |
| `move_out_date` | `date` |  |
| `room_name` | `varchar` |  Nullable |
| `boarding_house_name` | `text` |  Nullable |
| `boarding_house_address` | `text` |  Nullable |
| `id_photo_path` | `text` |  Nullable |
| `agreement_photo_path` | `text` |  Nullable |
| `notes` | `text` |  Nullable |
| `archived_at` | `timestamptz` |  |
| `tenancy_id` | `uuid` |  Nullable Unique |

## Table `tenancy`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `tenancy_id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `room_id` | `uuid` |  |
| `move_in_date` | `date` |  Nullable |
| `move_out_date` | `date` |  Nullable |
| `monthly_rate` | `numeric` |  Nullable |
| `billing_cycle_start` | `text` |  Nullable |
| `status` | `varchar` |  Nullable |
| `agreement_photo_url` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `last_updated_at` | `timestamptz` |  Nullable |
| `owner_id` | `uuid` |  |

## Table `meter_readings`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `reading_id` | `uuid` | Primary |
| `room_id` | `uuid` |  |
| `reading_value` | `numeric` |  |
| `reading_at` | `date` |  |
| `created_at` | `timestamptz` |  |

## Table `monthly_bill`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `bill_id` | `uuid` | Primary |
| `tenancy_id` | `uuid` |  |
| `period_start` | `date` |  |
| `period_end` | `date` |  |
| `due_date` | `date` |  |
| `billed_at` | `timestamptz` |  Nullable |
| `total_amount` | `numeric` |  |
| `paid_at` | `timestamptz` |  Nullable |
| `is_paid` | `bool` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `bill_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `bill_item_id` | `uuid` | Primary |
| `bill_id` | `uuid` |  |
| `item_type` | `bill_item_type` |  |
| `description` | `text` |  Nullable |
| `quantity` | `numeric` |  |
| `unit_price` | `numeric` |  |
| `start_reading_id` | `uuid` |  Nullable |
| `end_reading_id` | `uuid` |  Nullable |
| `amount` | `numeric` |  Nullable |

## Table `bill_reminders`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `reminder_id` | `uuid` | Primary |
| `bill_id` | `uuid` |  |
| `reminder_type` | `reminder_type` |  |
| `sent_at` | `timestamptz` |  |

## Table `room_default_charges`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `room_id` | `uuid` | Primary |
| `item_type` | `bill_item_type` | Primary |
| `unit_price` | `numeric` |  |

## Table `owner_default_charges`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `owner_id` | `uuid` | Primary |
| `item_type` | `bill_item_type` | Primary |
| `unit_price` | `numeric` |  |

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



DATABASE FUNCTION AND TRIGGERS
set_electricity_quantity function -> returns trigger
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

generate_monthly_bill funtion -> returns uuid
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

recalc_bill_total function -> returns trigger
declare b uuid := coalesce(new.bill_id, old.bill_id);
begin
  update monthly_bill
     set total_amount = coalesce((select sum(amount) from bill_items where bill_id = b), 0),
         updated_at   = now()
   where bill_id = b;
  return null;
end 