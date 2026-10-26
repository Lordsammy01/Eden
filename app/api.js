/* EDEN data layer. The screens only talk to `api`. Two implementations behind it:
   - real: Supabase (database, login, live updates)
   - mock: in-memory test mode (?mock=1) so the screens can be tried without a database */
(function () {
  const cfg = window.EDEN_CONFIG || {};
  const MOCK = new URLSearchParams(location.search).has('mock');
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  const STATUS_ORDER = ['placed', 'accepted', 'preparing', 'ready', 'pickedup', 'delivered'];

  /* ------------------------------------------------------------------ real */
  function makeReal() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Something went wrong'); return data; };
    let uid = null, channel = null;

    async function profilesFor(ids) {
      ids = [...new Set(ids.filter(Boolean))];
      if (!ids.length) return {};
      const rows = must(await sb.from('profiles').select('id,full_name,phone,role').in('id', ids));
      return Object.fromEntries(rows.map(r => [r.id, r]));
    }

    return {
      mode: 'live',
      async init() {
        const { data } = await sb.auth.getSession();
        uid = data.session ? data.session.user.id : null;
        return uid;
      },
      onAuthChange(cb) { sb.auth.onAuthStateChange((_e, session) => { uid = session ? session.user.id : null; cb(uid); }); },
      async signUp({ email, password, full_name, phone, role }) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name, phone, role } } });
        if (error) throw new Error(error.message);
        uid = data.session ? data.user.id : null;
        return { needsConfirm: !data.session };
      },
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        uid = data.user.id;
      },
      async signOut() { await this.unsubscribe(); await sb.auth.signOut(); uid = null; },
      userId() { return uid; },
      async me() {
        const profile = must(await sb.from('profiles').select('*').eq('id', uid).single());
        const w = must(await sb.from('wallets').select('balance').eq('user_id', uid).single());
        const { data } = await sb.auth.getUser();
        return { ...profile, email: data && data.user ? data.user.email : '', balance: w.balance };
      },
      async updateProfile(patch) { must(await sb.from('profiles').update(patch).eq('id', uid)); },
      async locations() { return must(await sb.from('locations').select('*').order('name')); },
      async vendors() { return must(await sb.from('vendors').select('*').order('name')); },
      async menu(vendorId) { return must(await sb.from('menu_items').select('*').eq('vendor_id', vendorId).order('created_at')); },
      async wallet() {
        const w = must(await sb.from('wallets').select('balance').eq('user_id', uid).single());
        const tx = must(await sb.from('wallet_tx').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(50));
        return { balance: w.balance, tx };
      },
      async demoTopup(amount) { return must(await sb.rpc('demo_topup', { p_amount: amount })); },
      async placeOrder(vendorId, items, locationId, note) {
        return must(await sb.rpc('place_order', { p_vendor: vendorId, p_items: items, p_location: locationId, p_note: note || '' }));
      },
      async orders() {
        const rows = must(await sb.from('orders')
          .select('*, vendors(id,name,short,owner_id), order_items(id,name,price,qty)')
          .order('created_at', { ascending: false }).limit(100));
        const people = await profilesFor(rows.flatMap(o => [o.student_id, o.rider_id, o.vendors && o.vendors.owner_id]));
        return rows.map(o => ({
          ...o, vendor: o.vendors, items: o.order_items || [],
          student: people[o.student_id] || null,
          rider: o.rider_id ? people[o.rider_id] || null : null,
          vendorOwner: o.vendors && o.vendors.owner_id ? people[o.vendors.owner_id] || null : null
        }));
      },
      async cancelOrder(id) { must(await sb.rpc('cancel_order', { p_order: id })); },
      async vendorSetStatus(id, status) { must(await sb.rpc('vendor_set_status', { p_order: id, p_status: status })); },
      async riderAccept(id) { must(await sb.rpc('rider_accept', { p_order: id })); },
      async riderDeliver(id) { must(await sb.rpc('rider_deliver', { p_order: id })); },
      async messages(orderId) { return must(await sb.from('messages').select('*').eq('order_id', orderId).order('created_at')); },
      async sendMessage(orderId, body) { must(await sb.from('messages').insert({ order_id: orderId, sender_id: uid, body })); },
      // vendor tools
      async myVendor() { const r = must(await sb.from('vendors').select('*').eq('owner_id', uid).limit(1)); return r[0] || null; },
      async claimVendor(id) { must(await sb.rpc('claim_vendor', { p_vendor: id })); },
      async setVendorOpen(id, open) { must(await sb.from('vendors').update({ is_open: open }).eq('id', id)); },
      async setItemAvailable(id, available) { must(await sb.from('menu_items').update({ available }).eq('id', id)); },
      async addItem(vendorId, name, description, price) { must(await sb.from('menu_items').insert({ vendor_id: vendorId, name, description, price })); },
      async deleteItem(id) { must(await sb.from('menu_items').delete().eq('id', id)); },
      // admin
      async pending() { return must(await sb.rpc('admin_list_pending')); },
      async setApproved(id, ok) { must(await sb.rpc('admin_set_approved', { p_user: id, p_approved: ok })); },
      // calls
      async sendSignal({ to, callId, kind, payload }) {
        must(await sb.from('call_signals').insert({ from_user: uid, to_user: to, call_id: callId, kind, payload: payload || {} }));
      },
      async clearSignals(callId) { await sb.from('call_signals').delete().eq('call_id', callId); },
      // live updates: cb(kind, row) where kind = orders | message | wallet | signal
      async subscribe(cb) {
        await this.unsubscribe();
        channel = sb.channel('eden-' + uid)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, p => cb('orders', p.new || p.old))
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => cb('message', p.new))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets', filter: 'user_id=eq.' + uid }, p => cb('wallet', p.new))
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: 'to_user=eq.' + uid }, p => cb('signal', p.new))
          .subscribe();
      },
      async unsubscribe() { if (channel) { await sb.removeChannel(channel); channel = null; } }
    };
  }

  /* ------------------------------------------------------------------ mock */
  function makeMock() {
    const T = () => new Date().toISOString();
    let seq = 100, tseq = 0;
    const id = () => 'u' + (++seq);
    const db = {
      users: {}, // id -> {id,email,password,full_name,phone,role,approved,balance}
      locations: [
        { id: 'blockA', name: 'Hostel Block A', fee: 200 }, { id: 'library', name: 'Library', fee: 250 },
        { id: 'health', name: 'Health Center', fee: 300 }, { id: 'container', name: 'The Container', fee: 200 }
      ],
      vendors: [
        { id: 'v1', owner_id: null, slug: 'manna', name: 'Manna Palace', short: 'MP', cuisine: 'Nigerian cuisine', eta: '15-20 min', hours: '8 am - 10 pm', is_open: true },
        { id: 'v2', owner_id: null, slug: 'suya', name: 'Suya Spot', short: 'SS', cuisine: 'Grills & BBQ', eta: '20-25 min', hours: '5 pm - 1 am', is_open: true }
      ],
      menu: [
        { id: 'i1', vendor_id: 'v1', name: 'Jollof rice & chicken', description: 'Smoky party jollof, grilled chicken', price: 2000, available: true },
        { id: 'i2', vendor_id: 'v1', name: 'Moi moi', description: 'Steamed bean pudding', price: 500, available: true },
        { id: 'i3', vendor_id: 'v1', name: 'Chapman', description: '500 ml, chilled', price: 700, available: false },
        { id: 'i4', vendor_id: 'v2', name: 'Beef suya', description: 'Grilled, with yaji and onions', price: 1500, available: true }
      ],
      tx: [], orders: [], items: [], messages: [], signals: []
    };
    let cur = null, cb = null;
    const fail = m => { throw new Error(m); };
    const user = () => db.users[cur] || fail('Not signed in');
    const credit = (uidd, amt, kind, label, order) => { db.users[uidd].balance += amt; db.tx.unshift({ id: ++tseq, user_id: uidd, amount: amt, kind, label, order_id: order || null, created_at: T() }); if (cb && uidd === cur) cb('wallet', { balance: db.users[uidd].balance }); };
    const emit = (k, row) => { if (cb) setTimeout(() => cb(k, row), 0); };
    const person = u => u ? { id: u.id, full_name: u.full_name, phone: u.phone, role: u.role } : null;
    const ownerOf = o => db.vendors.find(v => v.id === o.vendor_id).owner_id;
    const inOrder = (o, u) => [o.student_id, o.rider_id, ownerOf(o)].includes(u);
    const view = o => {
      const v = db.vendors.find(x => x.id === o.vendor_id);
      return { ...o, vendor: { id: v.id, name: v.name, short: v.short, owner_id: v.owner_id },
        items: db.items.filter(i => i.order_id === o.id).map(i => ({ ...i })),
        student: person(db.users[o.student_id]), rider: o.rider_id ? person(db.users[o.rider_id]) : null,
        vendorOwner: v.owner_id ? person(db.users[v.owner_id]) : null };
    };
    const myRole = () => { const u = user(); return u.approved ? u.role : ''; };

    return {
      mode: 'mock',
      db,
      async init() { return cur; },
      onAuthChange() {},
      async signUp({ email, password, full_name, phone, role }) {
        if (Object.values(db.users).some(u => u.email === email)) fail('User already registered');
        const r = ['student', 'academic', 'nonacademic', 'vendor', 'rider', 'driver'].includes(role) ? role : 'student';
        const approved = r === 'student' ? true : (r === 'academic' || r === 'nonacademic') ? /@run\.edu\.ng$/i.test(email) : false;
        const u = { id: id(), email, password, full_name, phone, role: r, approved, balance: 0 };
        db.users[u.id] = u; cur = u.id; return { needsConfirm: false };
      },
      async signIn(email, password) {
        const u = Object.values(db.users).find(x => x.email === email && x.password === password);
        if (!u) fail('Invalid login credentials'); cur = u.id;
      },
      async signOut() { cur = null; cb = null; },
      userId() { return cur; },
      async me() { const u = user(); return { id: u.id, email: u.email, full_name: u.full_name, phone: u.phone, role: u.role, approved: u.approved, balance: u.balance }; },
      async updateProfile(p) { Object.assign(user(), p); },
      async locations() { return db.locations; },
      async vendors() { return db.vendors.map(v => ({ ...v })); },
      async menu(vid) { return db.menu.filter(i => i.vendor_id === vid).map(i => ({ ...i })); },
      async wallet() { const u = user(); return { balance: u.balance, tx: db.tx.filter(t => t.user_id === cur) }; },
      async demoTopup(a) { if (a < 100 || a > 20000) fail('Choose an amount between 100 and 20,000'); credit(cur, a, 'topup', 'Wallet top-up (demo)'); return user().balance; },
      async placeOrder(vid, items, loc, note) {
        const u = user(); if (!['student', 'academic', 'nonacademic'].includes(myRole())) fail('Only students and staff can place orders');
        const v = db.vendors.find(x => x.id === vid); if (!v.is_open) fail(v.name + ' is closed right now');
        const l = db.locations.find(x => x.id === loc); if (!l) fail('Choose a delivery location');
        if (!items.length) fail('Your cart is empty');
        let sub = 0;
        for (const it of items) { const m = db.menu.find(x => x.id === it.item_id && x.vendor_id === vid); if (!m) fail('An item is not on this menu'); if (!m.available) fail(m.name + ' is sold out'); if (it.qty < 1 || it.qty > 20) fail('Quantity must be between 1 and 20'); sub += m.price * it.qty; }
        const total = sub + l.fee; if (u.balance < total) fail('Not enough in your wallet. You need ' + (total - u.balance) + ' more.');
        const o = { id: ++seq, student_id: cur, vendor_id: vid, rider_id: null, status: 'placed', subtotal: sub, delivery_fee: l.fee, total, location_id: loc, note: note || '', created_at: T(), updated_at: T() };
        db.orders.unshift(o);
        for (const it of items) { const m = db.menu.find(x => x.id === it.item_id); db.items.push({ id: ++seq, order_id: o.id, item_id: m.id, name: m.name, price: m.price, qty: it.qty }); }
        credit(cur, -total, 'order', 'Order #' + o.id + ' · ' + v.name, o.id); emit('orders', o); return o.id;
      },
      async orders() {
        const u = user();
        return db.orders.filter(o => o.student_id === cur || o.rider_id === cur || ownerOf(o) === cur || u.role === 'admin' ||
          (o.status === 'ready' && !o.rider_id && ['rider', 'driver'].includes(myRole()))).map(view);
      },
      async cancelOrder(oid) { const o = db.orders.find(x => x.id === oid); if (!o || o.student_id !== cur) fail('Order not found'); if (o.status !== 'placed') fail('The kitchen already accepted this order'); o.status = 'cancelled'; credit(cur, o.total, 'refund', 'Refund · Order #' + oid + ' (cancelled)', oid); emit('orders', o); },
      async vendorSetStatus(oid, st) {
        const o = db.orders.find(x => x.id === oid); if (!o) fail('Order not found'); if (ownerOf(o) !== cur) fail('Not your order');
        const ok = (o.status === 'placed' && ['accepted', 'declined'].includes(st)) || (o.status === 'accepted' && st === 'preparing') || (o.status === 'preparing' && st === 'ready');
        if (!ok) fail('Cannot move an order from ' + o.status + ' to ' + st);
        o.status = st; o.updated_at = T();
        if (st === 'declined') { const keep = cur; db.users[o.student_id].balance += o.total; db.tx.unshift({ id: ++tseq, user_id: o.student_id, amount: o.total, kind: 'refund', label: 'Refund · Order #' + oid + ' (declined)', order_id: oid, created_at: T() }); cur = keep; }
        emit('orders', o);
      },
      async riderAccept(oid) { const o = db.orders.find(x => x.id === oid); if (!['rider', 'driver'].includes(myRole())) fail('Only approved delivery interns can do this'); if (!o || o.status !== 'ready' || o.rider_id) fail('This job is no longer available'); o.rider_id = cur; o.status = 'pickedup'; o.updated_at = T(); emit('orders', o); },
      async riderDeliver(oid) {
        const o = db.orders.find(x => x.id === oid); if (!o || o.rider_id !== cur) fail('Not your delivery'); if (o.status !== 'pickedup') fail('This order is not out for delivery');
        o.status = 'delivered'; o.updated_at = T(); const ow = ownerOf(o);
        if (ow) { db.users[ow].balance += Math.floor(o.subtotal * 0.92); db.tx.unshift({ id: ++tseq, user_id: ow, amount: Math.floor(o.subtotal * 0.92), kind: 'earning', label: 'Order #' + oid + ' payout', order_id: oid, created_at: T() }); }
        credit(cur, o.delivery_fee, 'earning', 'Delivery · Order #' + oid, oid); emit('orders', o);
      },
      async messages(oid) { return db.messages.filter(m => m.order_id === oid); },
      async sendMessage(oid, body) { const o = db.orders.find(x => x.id === oid); if (!o || !inOrder(o, cur)) fail('Not allowed'); const m = { id: ++seq, order_id: oid, sender_id: cur, body, created_at: T() }; db.messages.push(m); emit('message', m); },
      async myVendor() { return db.vendors.find(v => v.owner_id === cur) || null; },
      async claimVendor(vid) { if (myRole() !== 'vendor') fail('Only approved vendor accounts can claim a kitchen'); const v = db.vendors.find(x => x.id === vid); if (!v || v.owner_id) fail('That kitchen already has an owner'); v.owner_id = cur; },
      async setVendorOpen(vid, open) { db.vendors.find(v => v.id === vid && v.owner_id === cur).is_open = open; },
      async setItemAvailable(iid, a) { db.menu.find(i => i.id === iid).available = a; },
      async addItem(vid, name, description, price) { db.menu.push({ id: 'i' + (++seq), vendor_id: vid, name, description, price, available: true }); },
      async deleteItem(iid) { db.menu = db.menu.filter(i => i.id !== iid); },
      async pending() { if (user().role !== 'admin') fail('Admins only'); return Object.values(db.users).filter(u => !u.approved && u.role !== 'admin').map(u => ({ id: u.id, full_name: u.full_name, phone: u.phone, role: u.role, email: u.email })); },
      async setApproved(uid2, ok) { if (user().role !== 'admin') fail('Admins only'); db.users[uid2].approved = ok; },
      async sendSignal(s) { const row = { id: ++seq, from_user: cur, to_user: s.to, call_id: s.callId, kind: s.kind, payload: s.payload || {}, created_at: T() }; db.signals.push(row); if (db.users[s.to] && cb && s.to === cur) emit('signal', row); },
      async clearSignals(cid) { db.signals = db.signals.filter(s => s.call_id !== cid); },
      async subscribe(fn) { cb = fn; },
      async unsubscribe() { cb = null; },
      // test helpers
      _makeAdmin(email, password) { const u = { id: id(), email, password, full_name: 'Admin', phone: '', role: 'admin', approved: true, balance: 0 }; db.users[u.id] = u; }
    };
  }

  const api = MOCK ? makeMock() : (configured ? makeReal() : null);
  window.EDEN_API = api;
  window.EDEN_META = { MOCK, configured, STATUS_ORDER };
})();
