-- EDEN real app: database schema (Supabase / Postgres)
-- Run this whole file once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Money is stored as whole naira (integers). Clients can never change balances or order status
-- directly; they call the functions at the bottom, which enforce every rule on the server.


-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  role        text not null default 'student'
              check (role in ('student','academic','nonacademic','vendor','rider','driver','admin')),
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.locations (
  id    text primary key,
  name  text not null,
  fee   int  not null check (fee >= 0),
  roles text[] not null default '{student,academic,nonacademic}'
);

create table if not exists public.vendors (
  id        uuid primary key default gen_random_uuid(),
  owner_id  uuid references public.profiles(id) on delete set null,
  slug      text unique not null,
  name      text not null,
  short     text not null default '',
  cuisine   text not null default '',
  eta       text not null default '15-20 min',
  hours     text not null default '',
  is_open   boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id) on delete cascade,
  name        text not null,
  description text not null default '',
  price       int  not null check (price >= 0),
  available   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists menu_items_vendor_idx on public.menu_items(vendor_id);

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance int not null default 0 check (balance >= 0)
);

create table if not exists public.wallet_tx (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     int  not null,               -- positive = money in, negative = money out
  kind       text not null,               -- topup | order | refund | earning
  label      text not null default '',
  order_id   bigint,
  created_at timestamptz not null default now()
);
create index if not exists wallet_tx_user_idx on public.wallet_tx(user_id, created_at desc);

create table if not exists public.orders (
  id           bigint generated always as identity primary key,
  student_id   uuid not null references public.profiles(id),
  vendor_id    uuid not null references public.vendors(id),
  rider_id     uuid references public.profiles(id),
  status       text not null default 'placed'
               check (status in ('placed','accepted','preparing','ready','pickedup','delivered','declined','cancelled')),
  subtotal     int not null,
  delivery_fee int not null,
  total        int not null,
  location_id  text not null references public.locations(id),
  note         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists orders_student_idx on public.orders(student_id, created_at desc);
create index if not exists orders_vendor_idx  on public.orders(vendor_id, created_at desc);
create index if not exists orders_rider_idx   on public.orders(rider_id);

create table if not exists public.order_items (
  id       bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  item_id  uuid references public.menu_items(id) on delete set null,
  name     text not null,
  price    int  not null,
  qty      int  not null check (qty between 1 and 20)
);
create index if not exists order_items_order_idx on public.order_items(order_id);

create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references public.orders(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id),
  body       text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_order_idx on public.messages(order_id, created_at);

-- short-lived WebRTC call signalling (offer / answer / ice / hangup)
create table if not exists public.call_signals (
  id         bigint generated always as identity primary key,
  from_user  uuid not null references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  call_id    uuid not null,
  kind       text not null check (kind in ('offer','answer','ice','hangup','decline')),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists call_signals_to_idx on public.call_signals(to_user, created_at desc);

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
-- DEMO MODE: lets any signed-in user add pretend money to their wallet so you can test ordering.
-- Before real launch run:  update app_config set value='false' where key='allow_demo_topup';
insert into public.app_config(key, value) values ('allow_demo_topup', 'true')
  on conflict (key) do nothing;

-- ---------------------------------------------------------------- helpers
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and approved
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and approved from public.profiles where id = auth.uid()), false)
$$;

-- true when users a and b are on the same order (student, vendor owner, or rider)
create or replace function public.shares_order(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
    join public.vendors v on v.id = o.vendor_id
    where a in (o.student_id, o.rider_id, v.owner_id)
      and b in (o.student_id, o.rider_id, v.owner_id)
      and a <> b
  )
$$;

create or replace function public.in_order(p_order bigint, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
    join public.vendors v on v.id = o.vendor_id
    where o.id = p_order and p_user in (o.student_id, o.rider_id, v.owner_id)
  )
$$;

-- ---------------------------------------------------------------- new-user trigger
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  want text := lower(coalesce(new.raw_user_meta_data->>'role', 'student'));
  r text;
  ok boolean;
begin
  -- people can pick these roles themselves; admin can only be granted by hand in SQL
  r := case when want in ('student','academic','nonacademic','vendor','rider','driver') then want else 'student' end;
  ok := case
          when r = 'student' then true
          when r in ('academic','nonacademic') then lower(new.email) like '%@run.edu.ng'
          else false              -- vendor / rider / driver wait for admin approval
        end;
  insert into public.profiles(id, full_name, phone, role, approved)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.raw_user_meta_data->>'phone', r, ok);
  insert into public.wallets(user_id) values (new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- row level security
alter table public.profiles     enable row level security;
alter table public.locations    enable row level security;
alter table public.vendors      enable row level security;
alter table public.menu_items   enable row level security;
alter table public.wallets      enable row level security;
alter table public.wallet_tx    enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.messages     enable row level security;
alter table public.call_signals enable row level security;
alter table public.app_config   enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.shares_order(auth.uid(), id));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- only name and phone may be edited by the user; role/approved are locked below
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

drop policy if exists locations_read on public.locations;
create policy locations_read on public.locations for select to authenticated using (true);

drop policy if exists vendors_read on public.vendors;
create policy vendors_read on public.vendors for select to authenticated using (true);
drop policy if exists vendors_owner_update on public.vendors;
create policy vendors_owner_update on public.vendors for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke update on public.vendors from authenticated;
grant update (is_open, eta, hours) on public.vendors to authenticated;

drop policy if exists menu_read on public.menu_items;
create policy menu_read on public.menu_items for select to authenticated using (true);
drop policy if exists menu_owner_write on public.menu_items;
create policy menu_owner_write on public.menu_items for all to authenticated
  using (exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid()))
  with check (exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid()));

drop policy if exists wallets_read on public.wallets;
create policy wallets_read on public.wallets for select to authenticated using (user_id = auth.uid());
drop policy if exists wallet_tx_read on public.wallet_tx;
create policy wallet_tx_read on public.wallet_tx for select to authenticated using (user_id = auth.uid());

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using (
  student_id = auth.uid()
  or rider_id = auth.uid()
  or exists (select 1 from public.vendors v where v.id = vendor_id and v.owner_id = auth.uid())
  or (status = 'ready' and rider_id is null and public.my_role() in ('rider','driver'))
  or public.is_admin()
);

drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id)   -- inherits orders_read
);

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
  using (public.in_order(order_id, auth.uid()));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.in_order(order_id, auth.uid()));

drop policy if exists signals_read on public.call_signals;
create policy signals_read on public.call_signals for select to authenticated
  using (to_user = auth.uid() or from_user = auth.uid());
drop policy if exists signals_insert on public.call_signals;
create policy signals_insert on public.call_signals for insert to authenticated
  with check (from_user = auth.uid() and public.shares_order(auth.uid(), to_user));

drop policy if exists signals_delete on public.call_signals;
create policy signals_delete on public.call_signals for delete to authenticated
  using (to_user = auth.uid() or from_user = auth.uid());

-- app_config: no client access at all (functions read it as security definer)
revoke all on public.app_config from anon, authenticated;

-- ---------------------------------------------------------------- order functions
create or replace function public.credit(p_user uuid, p_amount int, p_kind text, p_label text, p_order bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.wallets set balance = balance + p_amount where user_id = p_user;
  insert into public.wallet_tx(user_id, amount, kind, label, order_id)
  values (p_user, p_amount, p_kind, p_label, p_order);
end $$;
revoke all on function public.credit(uuid,int,text,text,bigint) from public, anon, authenticated;

-- Add pretend money (demo mode only).
create or replace function public.demo_topup(p_amount int) returns int
language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce((select value from public.app_config where key = 'allow_demo_topup'), 'false') <> 'true' then
    raise exception 'Top-ups are not available in demo mode right now';
  end if;
  if p_amount is null or p_amount < 100 or p_amount > 20000 then
    raise exception 'Choose an amount between 100 and 20,000';
  end if;
  perform public.credit(auth.uid(), p_amount, 'topup', 'Wallet top-up (demo)', null);
  select balance into bal from public.wallets where user_id = auth.uid();
  return bal;
end $$;

-- p_items: [{"item_id":"<uuid>","qty":2}, ...]
create or replace function public.place_order(p_vendor uuid, p_items jsonb, p_location text, p_note text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v public.vendors%rowtype;
  loc public.locations%rowtype;
  line jsonb;
  mi public.menu_items%rowtype;
  q int;
  sub int := 0;
  total int;
  bal int;
  oid bigint;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if coalesce(public.my_role(), '') not in ('student','academic','nonacademic') then
    raise exception 'Only students and staff can place orders';
  end if;
  select * into v from public.vendors where id = p_vendor;
  if not found then raise exception 'Kitchen not found'; end if;
  if not v.is_open then raise exception '% is closed right now', v.name; end if;
  select * into loc from public.locations where id = p_location;
  if not found then raise exception 'Choose a delivery location'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Too many different items'; end if;

  -- lock the wallet row so two orders at once cannot overspend
  select balance into bal from public.wallets where user_id = me for update;

  for line in select * from jsonb_array_elements(p_items) loop
    q := coalesce((line->>'qty')::int, 0);
    if q < 1 or q > 20 then raise exception 'Quantity must be between 1 and 20'; end if;
    select * into mi from public.menu_items where id = (line->>'item_id')::uuid and vendor_id = p_vendor;
    if not found then raise exception 'An item is not on this menu'; end if;
    if not mi.available then raise exception '% is sold out', mi.name; end if;
    sub := sub + mi.price * q;
  end loop;

  total := sub + loc.fee;
  if bal < total then
    raise exception 'Not enough in your wallet. You need % more.', total - bal;
  end if;

  insert into public.orders(student_id, vendor_id, subtotal, delivery_fee, total, location_id, note)
  values (me, p_vendor, sub, loc.fee, total, p_location, left(coalesce(p_note, ''), 300))
  returning id into oid;

  for line in select * from jsonb_array_elements(p_items) loop
    select * into mi from public.menu_items where id = (line->>'item_id')::uuid;
    insert into public.order_items(order_id, item_id, name, price, qty)
    values (oid, mi.id, mi.name, mi.price, (line->>'qty')::int);
  end loop;

  perform public.credit(me, -total, 'order', 'Order #' || oid || ' · ' || v.name, oid);
  return oid;
end $$;

create or replace function public.cancel_order(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.student_id <> auth.uid() then raise exception 'Order not found'; end if;
  if o.status <> 'placed' then raise exception 'The kitchen already accepted this order'; end if;
  update public.orders set status = 'cancelled', updated_at = now() where id = p_order;
  perform public.credit(o.student_id, o.total, 'refund', 'Refund · Order #' || p_order || ' (cancelled)', p_order);
end $$;

-- vendor moves an order forward: placed->accepted|declined, accepted->preparing, preparing->ready
create or replace function public.vendor_set_status(p_order bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; v public.vendors%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  select * into v from public.vendors where id = o.vendor_id;
  if v.owner_id is distinct from auth.uid() then raise exception 'Not your order'; end if;
  if not ((o.status = 'placed'    and p_status in ('accepted','declined'))
       or (o.status = 'accepted'  and p_status = 'preparing')
       or (o.status = 'preparing' and p_status = 'ready')) then
    raise exception 'Cannot move an order from % to %', o.status, p_status;
  end if;
  update public.orders set status = p_status, updated_at = now() where id = p_order;
  if p_status = 'declined' then
    perform public.credit(o.student_id, o.total, 'refund', 'Refund · Order #' || p_order || ' (declined)', p_order);
  end if;
end $$;

-- delivery intern takes a ready order
create or replace function public.rider_accept(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  if coalesce(public.my_role(), '') not in ('rider','driver') then raise exception 'Only approved delivery interns can do this'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found or o.status <> 'ready' or o.rider_id is not null then
    raise exception 'This job is no longer available';
  end if;
  update public.orders set rider_id = auth.uid(), status = 'pickedup', updated_at = now() where id = p_order;
end $$;

-- rider marks delivered: vendor is paid 92% of food, rider is paid the delivery fee
create or replace function public.rider_deliver(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; v public.vendors%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.rider_id is distinct from auth.uid() then raise exception 'Not your delivery'; end if;
  if o.status <> 'pickedup' then raise exception 'This order is not out for delivery'; end if;
  update public.orders set status = 'delivered', updated_at = now() where id = p_order;
  select * into v from public.vendors where id = o.vendor_id;
  if v.owner_id is not null then
    perform public.credit(v.owner_id, floor(o.subtotal * 0.92)::int, 'earning', 'Order #' || p_order || ' payout', p_order);
  end if;
  perform public.credit(o.rider_id, o.delivery_fee, 'earning', 'Delivery · Order #' || p_order, p_order);
end $$;

-- ---------------------------------------------------------------- admin / onboarding
create or replace function public.admin_set_approved(p_user uuid, p_approved boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.profiles set approved = p_approved where id = p_user and role <> 'admin';
end $$;

-- admin: accounts waiting for approval, with the email so they can be recognised
create or replace function public.admin_list_pending()
returns table(id uuid, full_name text, phone text, role text, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
    select p.id, p.full_name, p.phone, p.role, u.email::text, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
    where not p.approved and p.role <> 'admin'
    order by p.created_at;
end $$;

-- an approved vendor account claims one of the unowned kitchens
create or replace function public.claim_vendor(p_vendor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'vendor' then raise exception 'Only approved vendor accounts can claim a kitchen'; end if;
  if exists (select 1 from public.vendors where owner_id = auth.uid()) then raise exception 'You already run a kitchen'; end if;
  update public.vendors set owner_id = auth.uid() where id = p_vendor and owner_id is null;
  if not found then raise exception 'That kitchen already has an owner'; end if;
end $$;

-- ---------------------------------------------------------------- function permissions
revoke all on function public.demo_topup(int)                      from public, anon;
revoke all on function public.place_order(uuid,jsonb,text,text)    from public, anon;
revoke all on function public.cancel_order(bigint)                 from public, anon;
revoke all on function public.vendor_set_status(bigint,text)       from public, anon;
revoke all on function public.rider_accept(bigint)                 from public, anon;
revoke all on function public.rider_deliver(bigint)                from public, anon;
revoke all on function public.admin_set_approved(uuid,boolean)     from public, anon;
revoke all on function public.claim_vendor(uuid)                   from public, anon;
revoke all on function public.admin_list_pending()                 from public, anon;
grant execute on function public.admin_list_pending()              to authenticated;
grant execute on function public.demo_topup(int)                   to authenticated;
grant execute on function public.place_order(uuid,jsonb,text,text) to authenticated;
grant execute on function public.cancel_order(bigint)              to authenticated;
grant execute on function public.vendor_set_status(bigint,text)    to authenticated;
grant execute on function public.rider_accept(bigint)              to authenticated;
grant execute on function public.rider_deliver(bigint)             to authenticated;
grant execute on function public.admin_set_approved(uuid,boolean)  to authenticated;
grant execute on function public.claim_vendor(uuid)                to authenticated;

-- ---------------------------------------------------------------- realtime
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.orders;       exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.messages;     exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.call_signals; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.wallets;      exception when duplicate_object then null; end;
  end if;
end $$;
