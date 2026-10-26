import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const S = '/home/claude/eden/app/sql/';
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ok  '+m);} else {fail++; console.log('  FAIL '+m);} };

await db.exec(`
 create role anon nologin; create role authenticated nologin;
 create schema auth;
 create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 grant usage on schema public to anon, authenticated;
 alter default privileges in schema public grant all on tables to anon, authenticated;
 alter default privileges in schema public grant all on sequences to anon, authenticated;
 alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
await db.exec(fs.readFileSync(S+'01_schema.sql','utf8'));
await db.exec(fs.readFileSync(S+'02_seed.sql','utf8'));
await db.exec(fs.readFileSync(S+'02_seed.sql','utf8')); // idempotent

const uid = {};
async function mk(key,email,role,name){ const r=await db.query(`insert into auth.users(email,raw_user_meta_data) values ($1,$2) returning id`,[email,JSON.stringify({role,full_name:name})]); uid[key]=r.rows[0].id; }
await mk('stu','chidi@student.run.edu.ng','student','Chidi');
await mk('stu2','amaka@student.run.edu.ng','student','Amaka');
await mk('ven','manna@food.ng','vendor','Manna');
await mk('rid','tunde@x.ng','rider','Tunde');
await mk('adm','boss@run.edu.ng','admin','Boss');           // tries to self-assign admin
await mk('staff','prof@gmail.com','academic','Prof');       // academic w/o school email

async function as(key, sql, params=[]) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid[key]}',false)`);
  try { const r = await db.query(sql, params); return {r}; }
  catch(e){ return {e:e.message}; }
  finally { await db.exec(`reset role`); }
}
const sup = (sql,p=[]) => db.query(sql,p);

console.log('onboarding');
let p = (await sup(`select id,role,approved from public.profiles`)).rows;
const by = k => p.find(x=>x.id===uid[k]);
ok(by('stu').approved && by('stu').role==='student','student auto-approved');
ok(!by('ven').approved,'vendor waits for approval');
ok(by('adm').role==='student','cannot self-assign admin through signup');
ok(!by('staff').approved,'academic with non-school email not approved');
await sup(`update public.profiles set role='admin', approved=true where id=$1`,[uid.adm]);

console.log('profile locks');
let r = await as('stu',`update public.profiles set role='admin', approved=true where id=$1`,[uid.stu]);
ok(r.e,'student cannot change own role/approval');
r = await as('stu',`update public.profiles set full_name='Chidi O.' where id=$1`,[uid.stu]);
ok(!r.e,'student can edit own name');
r = await as('stu',`update public.wallets set balance=999999 where user_id=$1`,[uid.stu]);
ok(r.e || r.r.affectedRows===0,'student cannot edit wallet');

console.log('wallet + ordering');
r = await as('stu',`select public.demo_topup(5000) as b`); ok(r.r?.rows[0].b===5000,'demo top-up works');
r = await as('stu',`select public.demo_topup(50000)`); ok(r.e,'top-up over limit refused');
const manna = (await sup(`select id from public.vendors where slug='manna'`)).rows[0].id;
const items = (await sup(`select id,name,price from public.menu_items where vendor_id=$1 order by price desc`,[manna])).rows;
const dbl = (await sup(`select id from public.menu_items where vendor_id=(select id from public.vendors where slug='double') limit 1`)).rows[0].id;
r = await as('stu',`select public.place_order($1,$2,'blockA','no pepper') as id`,[manna,JSON.stringify([{item_id:items[0].id,qty:2}])]);
const oid = r.r?.rows[0].id; ok(!!oid,'order placed: '+(r.e||'#'+oid));
r = await as('stu',`select balance from public.wallets where user_id=$1`,[uid.stu]);
const expect = 5000 - (items[0].price*2 + 200);
ok(r.r.rows[0].balance===expect,`wallet debited correctly (${r.r.rows[0].balance} = ${expect})`);
r = await as('stu',`select public.place_order($1,$2,'blockA')`,[manna,JSON.stringify([{item_id:dbl,qty:1}])]); ok(r.e,'item from another kitchen refused');
r = await as('stu',`select public.place_order($1,$2,'blockA')`,[manna,JSON.stringify([{item_id:items[0].id,qty:0}])]); ok(r.e,'quantity 0 refused');
r = await as('stu',`select public.place_order($1,$2,'blockA')`,[manna,JSON.stringify([{item_id:items[0].id,qty:20}])]); ok(r.e && /Not enough/.test(r.e),'overspend refused: '+r.e);
await sup(`update public.vendors set is_open=false where id=$1`,[manna]);
r = await as('stu',`select public.place_order($1,$2,'blockA')`,[manna,JSON.stringify([{item_id:items[0].id,qty:1}])]); ok(r.e && /closed/.test(r.e),'closed kitchen refused');
await sup(`update public.vendors set is_open=true where id=$1`,[manna]);
r = await as('stu',`update public.orders set status='delivered', total=1 where id=$1`,[oid]); ok(r.e || r.r.affectedRows===0,'student cannot edit orders directly');

console.log('visibility');
r = await as('stu2',`select * from public.orders`); ok(r.r.rows.length===0,'other student sees no orders');
r = await as('stu2',`select * from public.order_items`); ok(r.r.rows.length===0,'other student sees no order items');
r = await as('stu',`select count(*)::int c from public.order_items`); ok(r.r.rows[0].c===1,'student sees own order items');

console.log('vendor flow');
r = await as('ven',`select public.claim_vendor($1)`,[manna]); ok(r.e,'unapproved vendor cannot claim kitchen');
r = await as('ven',`select public.admin_set_approved($1,true)`,[uid.ven]); ok(r.e,'vendor cannot approve themselves');
r = await as('adm',`select public.admin_set_approved($1,true)`,[uid.ven]); ok(!r.e,'admin approves vendor');
r = await as('ven',`select public.claim_vendor($1)`,[manna]); ok(!r.e,'approved vendor claims kitchen '+(r.e||''));
r = await as('ven',`select count(*)::int c from public.orders`); ok(r.r.rows[0].c===1,'vendor sees the order');
r = await as('ven',`select full_name from public.profiles where id=$1`,[uid.stu]); ok(r.r.rows[0]?.full_name,'vendor can see the customer name on their order');
r = await as('ven',`select public.vendor_set_status($1,'ready')`,[oid]); ok(r.e,'cannot skip steps');
r = await as('stu',`select public.vendor_set_status($1,'accepted')`,[oid]); ok(r.e,'student cannot accept own order');
for (const s of ['accepted','preparing','ready']) { r = await as('ven',`select public.vendor_set_status($1,$2)`,[oid,s]); ok(!r.e,'vendor -> '+s+' '+(r.e||'')); }
r = await as('stu',`select public.cancel_order($1)`,[oid]); ok(r.e,'cannot cancel after kitchen accepted');

console.log('rider flow');
r = await as('rid',`select public.rider_accept($1)`,[oid]); ok(r.e,'unapproved rider cannot take job');
await as('adm',`select public.admin_set_approved($1,true)`,[uid.rid]);
r = await as('rid',`select count(*)::int c from public.orders where status='ready'`); ok(r.r.rows[0].c===1,'approved rider sees ready job');
r = await as('rid',`select public.rider_accept($1)`,[oid]); ok(!r.e,'rider accepts '+(r.e||''));
r = await as('rid',`select public.rider_accept($1)`,[oid]); ok(r.e,'job cannot be taken twice');
r = await as('stu2',`select public.rider_deliver($1)`,[oid]); ok(r.e,'stranger cannot mark delivered');
r = await as('rid',`select public.rider_deliver($1)`,[oid]); ok(!r.e,'rider delivers '+(r.e||''));
r = await as('ven',`select balance from public.wallets where user_id=$1`,[uid.ven]);
ok(r.r.rows[0].balance===Math.floor(items[0].price*2*0.92),'vendor paid 92% ('+r.r.rows[0].balance+')');
r = await as('rid',`select balance from public.wallets where user_id=$1`,[uid.rid]); ok(r.r.rows[0].balance===200,'rider paid delivery fee');

console.log('chat');
r = await as('stu',`insert into public.messages(order_id,sender_id,body) values ($1,$2,'Please bring change')`,[oid,uid.stu]); ok(!r.e,'student sends message');
r = await as('rid',`select body from public.messages where order_id=$1`,[oid]); ok(r.r.rows.length===1,'rider reads it');
r = await as('stu2',`select * from public.messages`); ok(r.r.rows.length===0,'stranger cannot read messages');
r = await as('stu2',`insert into public.messages(order_id,sender_id,body) values ($1,$2,'hi')`,[oid,uid.stu2]); ok(r.e,'stranger cannot post');
r = await as('stu2',`insert into public.messages(order_id,sender_id,body) values ($1,$2,'spoof')`,[oid,uid.stu]); ok(r.e,'cannot post as someone else');

console.log('calls');
const cid='11111111-1111-1111-1111-111111111111';
r = await as('stu',`insert into public.call_signals(from_user,to_user,call_id,kind,payload) values ($1,$2,$3,'offer','{}')`,[uid.stu,uid.rid,cid]); ok(!r.e,'student can signal their rider');
r = await as('stu',`insert into public.call_signals(from_user,to_user,call_id,kind,payload) values ($1,$2,$3,'offer','{}')`,[uid.stu,uid.stu2,cid]); ok(r.e,'cannot signal a stranger');
r = await as('rid',`select count(*)::int c from public.call_signals`); ok(r.r.rows[0].c===1,'rider receives the signal');
r = await as('stu2',`select count(*)::int c from public.call_signals`); ok(r.r.rows[0].c===0,'stranger cannot eavesdrop');

console.log('decline + cancel refunds');
await as('stu',`select public.demo_topup(5000)`);
const before=(await as('stu',`select balance from public.wallets where user_id=$1`,[uid.stu])).r.rows[0].balance;
const o2=(await as('stu',`select public.place_order($1,$2,'library') id`,[manna,JSON.stringify([{item_id:items[1].id,qty:1}])])).r.rows[0].id;
await as('stu',`select public.cancel_order($1)`,[o2]);
ok((await as('stu',`select balance from public.wallets where user_id=$1`,[uid.stu])).r.rows[0].balance===before,'cancel refunds in full');
const o3=(await as('stu',`select public.place_order($1,$2,'library') id`,[manna,JSON.stringify([{item_id:items[1].id,qty:1}])])).r.rows[0].id;
await as('ven',`select public.vendor_set_status($1,'declined')`,[o3]);
ok((await as('stu',`select balance from public.wallets where user_id=$1`,[uid.stu])).r.rows[0].balance===before,'decline refunds in full');
const ledger=(await sup(`select coalesce(sum(amount),0)::int s from public.wallet_tx`)).rows[0].s;
const bal=(await sup(`select coalesce(sum(balance),0)::int s from public.wallets`)).rows[0].s;
ok(ledger===bal,`ledger matches balances (${ledger} = ${bal})`);
r = await as('stu',`select * from public.app_config`); ok(r.e || r.r.rows.length===0,'app_config is closed to clients');

console.log('admin list');
r = await as('stu',`select * from public.admin_list_pending()`); ok(r.e,'student cannot list pending accounts');
r = await as('adm',`select * from public.admin_list_pending()`); ok(!r.e && r.r.rows.some(x=>x.email==='prof@gmail.com'),'admin sees pending accounts with email');
r = await as('stu',`delete from public.call_signals where from_user=$1`,[uid.stu]); ok(!r.e,'user can delete own call signals');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
