-- EDEN real app: starter data (kitchens, menus, campus delivery locations)
-- Run after 01_schema.sql. Safe to run twice.

insert into public.locations(id,name,fee,roles) values
  ('blockA','Hostel Block A',200,'{student}'),
  ('blockB','Hostel Block B',200,'{student}'),
  ('library','Library',250,'{student,academic}'),
  ('lecture','Lecture Halls',250,'{academic}'),
  ('offices','Faculty Offices',250,'{academic}'),
  ('admin','Admin Block',250,'{nonacademic}'),
  ('works','Works Department',300,'{nonacademic}'),
  ('health','Health Center',300,'{student,academic,nonacademic}'),
  ('quarters','Staff Quarters',350,'{academic,nonacademic}'),
  ('container','The Container',200,'{student,academic,nonacademic}'),
  ('esther','Queen Esther Hall',200,'{student}'),
  ('moses','Prophet Moses Hall',200,'{student}'),
  ('fac_bms','Faculty of Basic Medical Sciences',250,'{academic}'),
  ('fac_built','Faculty of Built Environment',250,'{academic}'),
  ('fac_computing','Faculty of Computing & Digital Technologies',250,'{academic}'),
  ('fac_eng','Faculty of Engineering',250,'{academic}'),
  ('fac_hum','Faculty of Humanities',250,'{academic}'),
  ('fac_law','Faculty of Law',250,'{academic}'),
  ('fac_mgmt','Faculty of Management Sciences',250,'{academic}'),
  ('fac_nat','Faculty of Natural Sciences',250,'{academic}'),
  ('fac_soc','Faculty of Social Sciences',250,'{academic}')
on conflict (id) do nothing;

insert into public.vendors(slug,name,short,cuisine,eta,hours) values
  ('manna','Manna Palace','MP','Nigerian cuisine','15-20 min','8 am - 10 pm'),
  ('double','Double Portion','DP','Fast food','10-15 min','9 am - 1 am'),
  ('suya','Suya Spot','SS','Grills & BBQ','20-25 min','5 pm - 1 am'),
  ('mamaput','Mama Put Corner','MC','Rice & stews','10-15 min','7 am - 6 pm'),
  ('national','National Kitchen','NK','Campus cafeteria','15-20 min','7 am - 9 pm'),
  ('mimis','Mimi''s','MI','Snacks & pastries','5-10 min','8 am - 8 pm'),
  ('newera','New Era','NE','Nigerian cuisine','15-20 min','7 am - 10 pm')
on conflict (slug) do nothing;

insert into public.menu_items(vendor_id,name,description,price)
select * from (values
  ((select id from public.vendors where slug='manna'),'Jollof rice & chicken','Smoky party jollof, grilled chicken',2000),
  ((select id from public.vendors where slug='manna'),'Fried rice & plantain','With coleslaw and dodo',1800),
  ((select id from public.vendors where slug='manna'),'Pounded yam & egusi','Assorted meat, one wrap',2200),
  ((select id from public.vendors where slug='manna'),'Moi moi','Steamed bean pudding',500),
  ((select id from public.vendors where slug='manna'),'Chapman','500 ml, chilled',700),
  ((select id from public.vendors where slug='double'),'Double burger','Two patties, cheese, fries',2800),
  ((select id from public.vendors where slug='double'),'Chicken & chips','Four pieces, spicy or plain',2500),
  ((select id from public.vendors where slug='double'),'Shawarma','Chicken, extra sausage',2200),
  ((select id from public.vendors where slug='double'),'Zobo','Cold hibiscus drink',400),
  ((select id from public.vendors where slug='suya'),'Beef suya','Grilled, with yaji and onions',1500),
  ((select id from public.vendors where slug='suya'),'Chicken suya','Half chicken, spicy',1800),
  ((select id from public.vendors where slug='suya'),'Gizzard','Grilled and peppered',1200),
  ((select id from public.vendors where slug='suya'),'Suya wrap','Beef, cabbage, tomato',2000),
  ((select id from public.vendors where slug='mamaput'),'Rice & stew','White rice, tomato stew',1000),
  ((select id from public.vendors where slug='mamaput'),'Beans & plantain','Ewa agoyin style',900),
  ((select id from public.vendors where slug='mamaput'),'Spaghetti','With fried egg',800),
  ((select id from public.vendors where slug='mamaput'),'Boiled egg','Each',200),
  ((select id from public.vendors where slug='national'),'Rice & stew combo','White rice, stew, one protein',1300),
  ((select id from public.vendors where slug='national'),'Yam porridge','With vegetables and fish',1200),
  ((select id from public.vendors where slug='national'),'Beans porridge','With plantain',900),
  ((select id from public.vendors where slug='national'),'Soft drink','Chilled, 50cl',500),
  ((select id from public.vendors where slug='mimis'),'Meat pie','Flaky pastry, spiced minced meat',700),
  ((select id from public.vendors where slug='mimis'),'Sausage roll','Each',600),
  ((select id from public.vendors where slug='mimis'),'Doughnut','Each',400),
  ((select id from public.vendors where slug='mimis'),'Zobo','Cold hibiscus drink, 50cl',500),
  ((select id from public.vendors where slug='newera'),'Jollof rice & turkey','Party jollof, grilled turkey',2300),
  ((select id from public.vendors where slug='newera'),'Ofada rice & ayamase','With assorted meat',2500),
  ((select id from public.vendors where slug='newera'),'Moi moi','Steamed bean pudding',500),
  ((select id from public.vendors where slug='newera'),'Chapman','500 ml, chilled',700)
) as t(vendor_id,name,description,price)
where not exists (select 1 from public.menu_items);
