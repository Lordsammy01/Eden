/* EDEN app. Screens talk only to window.EDEN_API (see api.js). */
(function () {
  const api = window.EDEN_API, META = window.EDEN_META, CFG = window.EDEN_CONFIG || {};
  const $app = document.getElementById('app'), $call = document.getElementById('callRoot'), $toast = document.getElementById('toast');
  const CUSTOMER = ['student', 'academic', 'nonacademic'];
  const STEPS = ['placed', 'accepted', 'preparing', 'ready', 'pickedup', 'delivered'];
  const STEP_LABEL = { placed: 'Order placed', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready for pickup', pickedup: 'On the way', delivered: 'Delivered', declined: 'Declined', cancelled: 'Cancelled' };
  const ROLE_LABEL = { student: 'Student', academic: 'Academic staff', nonacademic: 'Non-academic staff', vendor: 'Vendor', rider: 'Delivery intern', driver: 'Driver', admin: 'Admin' };
  const IC = {
    home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z', bag: 'M6 7h12l1 14H5zM9 7a3 3 0 0 1 6 0',
    wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2-3h12v3M16 14h2', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    back: 'M15 18l-6-6 6-6', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
    mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6 11a6 6 0 0 0 12 0M12 17v4', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    bike: 'M5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 18l-2-6 4-3 2 3h3M9 6h3', check: 'M5 13l4 4L19 7',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', food: 'M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10', send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z'
  };
  const ic = (n, s) => `<svg viewBox="0 0 24 24" width="${s || 22}" height="${s || 22}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${IC[n]}"/></svg>`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '₦' + Number(n || 0).toLocaleString('en-NG');
  const initials = n => (n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const ago = d => { const s = Math.max(0, (Date.now() - new Date(d)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : new Date(d).toLocaleDateString(); };

  const S = { ready: false, user: null, locations: [], vendors: [], menus: {}, orders: [], tx: [], msgs: {}, cart: { vendorId: null, q: {} }, myVendor: null, pending: [], authMode: 'login', err: '', busy: false, info: '' };
  let calls = null, pollT = null, beepCtx = null, sigT = null; const seenSig = new Set();
  function onSignal(row) { if (!row || seenSig.has(row.id)) return; seenSig.add(row.id); calls.handleSignal(row, nameFor); }
  function sigLoop() { clearTimeout(sigT); if (!S.user || !S.user.approved) return; api.pollSignals().then(rows => rows.forEach(onSignal)).catch(() => {}).finally(() => { const busy = calls && calls.state.phase !== 'idle'; sigT = setTimeout(sigLoop, busy ? 1200 : 4000); }); }

  /* ---------- helpers ---------- */
  const role = () => S.user && S.user.role;
  const isCustomer = () => CUSTOMER.includes(role());
  const isRider = () => ['rider', 'driver'].includes(role());
  const loc = id => S.locations.find(l => l.id === id);
  const vendor = id => S.vendors.find(v => v.id === id);
  const order = id => S.orders.find(o => String(o.id) === String(id));
  let toastT;
  function toast(m) { $toast.textContent = m; $toast.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => $toast.classList.remove('show'), 3200); beep(); if (navigator.vibrate) try { navigator.vibrate(120); } catch (e) {} }
  function beep() { try { beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)(); const o = beepCtx.createOscillator(), g = beepCtx.createGain(); o.frequency.value = 880; g.gain.value = .06; o.connect(g); g.connect(beepCtx.destination); o.start(); o.stop(beepCtx.currentTime + .15); } catch (e) {} }
  const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/');
  const go = h => { location.hash = '#/' + h; };
  async function run(fn, okMsg) { S.err = ''; try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { S.err = e.message || String(e); toast(S.err); render(); return undefined; } }
  const personFor = id => { for (const o of S.orders) for (const p of [o.student, o.rider, o.vendorOwner]) if (p && p.id === id) return p; return null; };
  const nameFor = id => { const p = personFor(id); return p ? p.full_name : 'Someone'; };

  /* ---------- data loading ---------- */
  async function refreshOrders(notify) {
    const prev = Object.fromEntries(S.orders.map(o => [o.id, o.status]));
    let rows; try { rows = await api.orders(); } catch (e) { return; }
    S.orders = rows;
    if (notify) for (const o of rows) {
      const p = prev[o.id];
      if (role() === 'vendor' && p === undefined && o.status === 'placed') toast('New order #' + o.id + ' · ' + money(o.subtotal));
      else if (isCustomer() && p && p !== o.status) toast('Order #' + o.id + ': ' + STEP_LABEL[o.status]);
      else if (isRider() && o.status === 'ready' && !o.rider_id && p !== 'ready') toast('New delivery job: order #' + o.id);
    }
    render();
  }
  async function refreshWallet() { try { const w = await api.wallet(); S.user.balance = w.balance; S.tx = w.tx; } catch (e) {} }
  async function loadAll() {
    S.user = await api.me();
    if (!S.user.approved) return;
    [S.locations, S.vendors] = await Promise.all([api.locations(), api.vendors()]);
    if (role() === 'vendor') { S.myVendor = await api.myVendor(); if (S.myVendor) S.menus[S.myVendor.id] = await api.menu(S.myVendor.id); }
    if (role() === 'admin') S.pending = await api.pending();
    await refreshWallet(); await refreshOrders(false);
    startLive();
  }
  function startLive() {
    initCalls();
    api.subscribe((k, row) => {
      if (!row) return;
      if (k === 'orders') refreshOrders(true);
      else if (k === 'wallet') { S.user.balance = row.balance; refreshWallet().then(render); }
      else if (k === 'message') {
        const list = S.msgs[row.order_id];
        if (list && !list.some(m => m.id === row.id)) list.push(row);
        if (row.sender_id !== S.user.id) { const r = route(); if (!(r[0] === 'order' && String(r[1]) === String(row.order_id))) toast('New message on order #' + row.order_id); }
        render(); const c = document.querySelector('.chat'); if (c) c.scrollTop = c.scrollHeight;
      } else if (k === 'signal') onSignal(row);
    });
    sigLoop();
    clearInterval(pollT);
    pollT = setInterval(() => { if (S.user && S.user.approved) { refreshOrders(true); refreshWallet(); } }, 15000);
  }
  function initCalls() {
    if (calls) return;
    calls = new window.EdenCalls.CallManager({ signal: { send: s => api.sendSignal(s), clear: id => api.clearSignals(id) }, onState: renderCall, iceServers: CFG.ICE_SERVERS });
  }

  /* ---------- rendering ---------- */
  function keepState(fn) {
    const vals = {}, ae = document.activeElement, ak = ae && ae.dataset && ae.dataset.k, sel = ae && ae.selectionStart;
    $app.querySelectorAll('[data-k]').forEach(el => { vals[el.dataset.k] = el.value; });
    const main = $app.querySelector('.main'), st = main ? main.scrollTop : 0, sig = main ? main.dataset.sig : '';
    fn();
    $app.querySelectorAll('[data-k]').forEach(el => { if (vals[el.dataset.k] !== undefined && !el.dataset.reset) el.value = vals[el.dataset.k]; });
    const m2 = $app.querySelector('.main'); if (m2 && m2.dataset.sig === sig) m2.scrollTop = st;
    if (ak) { const el = $app.querySelector(`[data-k="${ak}"]`); if (el) { el.focus(); try { el.setSelectionRange(sel, sel); } catch (e) {} } }
  }
  function render() { if (!S.ready) return; keepState(() => { $app.innerHTML = screen(); }); }
  function shell(title, body, o = {}) {
    const sig = route().join('/');
    return `<div class="top">${o.back ? `<button class="back" data-a="back" aria-label="Back">${ic('back')}</button>` : ''}<h1>${title}${o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''}</h1>${o.right || ''}</div>
    <div class="main" data-sig="${sig}">${body}</div>${o.notabs ? '' : tabs()}`;
  }
  function tabsFor() {
    if (isCustomer()) return [['home', 'Home', 'home'], ['orders', 'Orders', 'bag'], ['wallet', 'Wallet', 'wallet'], ['me', 'Profile', 'user']];
    if (role() === 'vendor') return [['board', 'Orders', 'bag'], ['menu', 'Menu', 'food'], ['wallet', 'Earnings', 'wallet'], ['me', 'Profile', 'user']];
    if (isRider()) return [['jobs', 'Jobs', 'bike'], ['mine', 'My runs', 'list'], ['wallet', 'Earnings', 'wallet'], ['me', 'Profile', 'user']];
    return [['approvals', 'Approvals', 'shield'], ['orders', 'Orders', 'bag'], ['me', 'Profile', 'user']];
  }
  function homeRoute() { return tabsFor()[0][0]; }
  function tabs() {
    const cur = route()[0] || homeRoute();
    const n = role() === 'vendor' ? S.orders.filter(o => o.status === 'placed').length : isRider() ? S.orders.filter(o => o.status === 'ready' && !o.rider_id).length : role() === 'admin' ? S.pending.length : 0;
    return `<nav class="tabs">${tabsFor().map(([r, l, i], idx) => `<a href="#/${r}" class="${cur === r ? 'on' : ''}"><span class="ib">${ic(i)}</span>${l}${idx === 0 && n ? `<span class="badge">${n}</span>` : ''}</a>`).join('')}</nav>`;
  }

  function screen() {
    if (!S.user) return authScreen();
    if (!S.user.approved) return pendingScreen();
    const r = route(); const k = r[0] || homeRoute();
    const known = { home, orders: ordersList, wallet: walletScreen, me: profile, board, menu: menuScreen, jobs, mine, approvals, kitchen, cart, order: orderScreen };
    return (known[k] || home)(r);
  }

  /* ---- auth ---- */
  function authScreen() {
    const su = S.authMode === 'signup';
    return `<div class="hero"><div class="logo">EDEN</div><p>Redeemer's University · everything on campus</p></div>
    <div class="main" style="margin-top:-18px;border-radius:24px 24px 0 0;background:var(--bg)"><form data-form="${su ? 'signup' : 'login'}" style="padding-top:8px">
      <div class="seg"><button type="button" class="${su ? '' : 'on'}" data-a="mode" data-v="login">Log in</button><button type="button" class="${su ? 'on' : ''}" data-a="mode" data-v="signup">Create account</button></div>
      ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}${S.info ? `<div class="card" style="background:#fff8d9">${esc(S.info)}</div>` : ''}
      ${su ? `<label class="field"><span>Full name</span><input data-k="name" name="name" autocomplete="name" required></label>
      <label class="field"><span>Phone</span><input data-k="phone" name="phone" type="tel" autocomplete="tel" placeholder="080..." required></label>` : ''}
      <label class="field"><span>Email</span><input data-k="email" name="email" type="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input data-k="pw" name="pw" type="password" minlength="6" autocomplete="${su ? 'new-password' : 'current-password'}" required></label>
      ${su ? `<label class="field"><span>I am a…</span><select data-k="role" name="role"><option value="student">Student</option><option value="academic">Academic staff</option><option value="nonacademic">Non-academic staff</option><option value="vendor">Food vendor</option><option value="rider">Delivery intern</option></select></label>
      <div class="mut" style="margin-bottom:12px">Students get in straight away. Staff with an @run.edu.ng email do too. Vendors and delivery interns are approved by the admin first.</div>` : ''}
      <button class="btn gold" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Please wait…' : su ? 'Create account' : 'Log in'}</button>
    </form></div>`;
  }
  function pendingScreen() {
    return `<div class="hero"><div class="logo">EDEN</div><p>Almost there</p></div><div class="main"><div class="card" style="text-align:center"><div style="color:var(--navy)">${ic('shield', 40)}</div>
    <h3 class="h" style="margin:8px 0">Waiting for approval</h3><p class="mut">Your ${esc(ROLE_LABEL[role()] || 'account')} account needs to be approved by the EDEN admin before you can start. This screen updates when that happens.</p>
    <button class="btn" data-a="refresh">Check again</button><div style="height:8px"></div><button class="btn ghost" data-a="logout">Log out</button></div></div>`;
  }

  /* ---- customer ---- */
  function home() {
    const first = (S.user.full_name || '').split(' ')[0];
    return shell('Hi' + (first ? ', ' + esc(first) : ''), `<div class="bal row"><div><div style="opacity:.75;font-size:12px;font-weight:600">WALLET</div><div class="n">${money(S.user.balance)}</div></div><div class="sp"></div><a href="#/wallet" class="btn gold sm" style="text-decoration:none">Top up</a></div>
    <h3 class="h" style="margin:4px 0 10px">Order food</h3>
    ${S.vendors.map(v => `<a class="card row" href="#/kitchen/${v.id}" style="text-decoration:none;color:inherit"><div class="av">${esc(v.short || initials(v.name))}</div><div class="sp"><div class="b">${esc(v.name)}</div><div class="mut">${esc(v.cuisine)} · ${esc(v.eta)}</div></div><span class="pill ${v.is_open ? 'ready' : 'cancelled'}">${v.is_open ? 'Open' : 'Closed'}</span></a>`).join('') || '<div class="empty">No kitchens yet</div>'}`, { sub: 'Redeemer\'s University' });
  }
  function kitchen(r) {
    const v = vendor(r[1]); if (!v) return shell('Kitchen', '<div class="empty">Kitchen not found</div>', { back: 1 });
    if (!S.menus[v.id]) { api.menu(v.id).then(m => { S.menus[v.id] = m; render(); }); return shell(v.name, '<div class="empty">Loading menu…</div>', { back: 1 }); }
    const q = S.cart.vendorId === v.id ? S.cart.q : {};
    const count = Object.values(q).reduce((a, b) => a + b, 0);
    const items = S.menus[v.id];
    return shell(esc(v.name), `<div class="mut" style="margin-bottom:10px">${esc(v.cuisine)} · ${esc(v.eta)} · ${esc(v.hours)} ${v.is_open ? '' : '· <b style="color:var(--bad)">Closed right now</b>'}</div>
    <div class="card">${items.map(i => `<div class="item ${i.available ? '' : 'sold'}"><div class="sp"><div class="b">${esc(i.name)}</div><div class="mut">${esc(i.description)}</div><div class="b" style="margin-top:3px">${money(i.price)}</div></div>
      ${i.available && v.is_open ? `<div class="qty">${q[i.id] ? `<button class="minus" data-a="dec" data-v="${i.id}" data-vendor="${v.id}">−</button><b>${q[i.id]}</b>` : ''}<button data-a="inc" data-v="${i.id}" data-vendor="${v.id}">+</button></div>` : `<span class="pill cancelled">${i.available ? 'Closed' : 'Sold out'}</span>`}</div>`).join('') || '<div class="empty">No items yet</div>'}</div>
    ${count ? `<div class="cartbar"><a class="btn gold" href="#/cart" style="text-decoration:none">View cart · ${count} item${count > 1 ? 's' : ''}</a></div>` : ''}`, { back: 1 });
  }
  function cartLines() {
    const v = vendor(S.cart.vendorId); const menu = v ? S.menus[v.id] || [] : [];
    const lines = Object.entries(S.cart.q).filter(([, n]) => n > 0).map(([id, n]) => ({ item: menu.find(m => m.id === id), n })).filter(l => l.item);
    return { v, lines, sub: lines.reduce((a, l) => a + l.item.price * l.n, 0) };
  }
  function cart() {
    const { v, lines, sub } = cartLines();
    if (!lines.length) return shell('Cart', '<div class="empty">Your cart is empty.<br><br><a class="btn sm" href="#/home" style="text-decoration:none;display:inline-flex">Browse kitchens</a></div>', { back: 1 });
    const lid = (document.querySelector('[data-k="loc"]') || {}).value || S.cart.loc || '';
    const l = loc(lid), fee = l ? l.fee : 0, total = sub + fee, short = total - S.user.balance;
    return shell('Your cart', `<div class="mut" style="margin-bottom:8px">From <b>${esc(v.name)}</b></div>
    <div class="card">${lines.map(x => `<div class="item"><div class="sp b">${esc(x.item.name)}</div><div class="qty"><button class="minus" data-a="dec" data-v="${x.item.id}" data-vendor="${v.id}">−</button><b>${x.n}</b><button data-a="inc" data-v="${x.item.id}" data-vendor="${v.id}">+</button></div><div class="b" style="width:70px;text-align:right">${money(x.item.price * x.n)}</div></div>`).join('')}</div>
    <label class="field"><span>Deliver to</span><select data-k="loc" data-a-change="loc"><option value="">Choose a location…</option>${S.locations.map(x => `<option value="${x.id}" ${x.id === lid ? 'selected' : ''}>${esc(x.name)} (+${money(x.fee)})</option>`).join('')}</select></label>
    <label class="field"><span>Note for the kitchen (optional)</span><input data-k="note" maxlength="140" placeholder="e.g. no pepper"></label>
    <div class="card"><div class="row"><span class="sp">Food</span>${money(sub)}</div><div class="row"><span class="sp">Delivery</span>${l ? money(fee) : '—'}</div><div class="row b" style="margin-top:6px"><span class="sp">Total</span>${money(total)}</div><div class="row mut" style="margin-top:6px"><span class="sp">Wallet balance</span>${money(S.user.balance)}</div></div>
    ${l && short > 0 ? `<div class="err">You need ${money(short)} more. <a href="#/wallet" style="color:inherit;text-decoration:underline">Top up wallet</a></div>` : ''}
    <button class="btn gold" data-a="place" ${!l || short > 0 || S.busy ? 'disabled' : ''}>${S.busy ? 'Placing…' : 'Place order · ' + money(total)}</button>`, { back: 1 });
  }
  function orderRow(o, who) {
    return `<a class="card row" href="#/order/${o.id}" style="text-decoration:none;color:inherit"><div class="sp"><div class="b">#${o.id} · ${esc(o.vendor ? o.vendor.name : '')}</div><div class="mut">${who ? esc(who) + ' · ' : ''}${o.items.map(i => i.qty + '× ' + esc(i.name)).join(', ')}</div><div class="mut">${ago(o.created_at)} · ${money(o.total)}</div></div><span class="pill ${o.status}">${STEP_LABEL[o.status]}</span></a>`;
  }
  function ordersList() {
    if (role() === 'admin') return shell('All orders', S.orders.map(o => orderRow(o, o.student && o.student.full_name)).join('') || '<div class="empty">No orders yet</div>');
    const active = S.orders.filter(o => !['delivered', 'declined', 'cancelled'].includes(o.status));
    const past = S.orders.filter(o => ['delivered', 'declined', 'cancelled'].includes(o.status));
    return shell('My orders', `${active.length ? '<h3 class="h" style="margin-bottom:8px">In progress</h3>' + active.map(o => orderRow(o)).join('') : ''}${past.length ? '<h3 class="h" style="margin:8px 0">Past</h3>' + past.map(o => orderRow(o)).join('') : ''}${S.orders.length ? '' : '<div class="empty">No orders yet.<br>Pick a kitchen on Home to start.</div>'}`);
  }

  /* ---- order detail (all roles) ---- */
  function orderScreen(r) {
    const o = order(r[1]); if (!o) return shell('Order', '<div class="empty">Order not found</div>', { back: 1 });
    if (!S.msgs[o.id]) { S.msgs[o.id] = []; api.messages(o.id).then(m => { S.msgs[o.id] = m; render(); const c = document.querySelector('.chat'); if (c) c.scrollTop = c.scrollHeight; }).catch(() => {}); }
    const idx = STEPS.indexOf(o.status), me = S.user.id;
    const people = [['Student', o.student], ['Kitchen', o.vendorOwner], ['Delivery', o.rider]].filter(([, p]) => p && p.id !== me);
    const L = loc(o.location_id);
    let actions = '';
    if (role() === 'vendor') {
      if (o.status === 'placed') actions = `<div class="row"><button class="btn bad" data-a="vstat" data-id="${o.id}" data-v="declined">Decline</button><button class="btn" data-a="vstat" data-id="${o.id}" data-v="accepted">Accept</button></div>`;
      else if (o.status === 'accepted') actions = `<button class="btn" data-a="vstat" data-id="${o.id}" data-v="preparing">Start preparing</button>`;
      else if (o.status === 'preparing') actions = `<button class="btn gold" data-a="vstat" data-id="${o.id}" data-v="ready">Mark ready for pickup</button>`;
    } else if (isRider()) {
      if (o.status === 'ready' && !o.rider_id) actions = `<button class="btn gold" data-a="raccept" data-id="${o.id}">Take this delivery · earn ${money(o.delivery_fee)}</button>`;
      else if (o.status === 'pickedup' && o.rider_id === me) actions = `<button class="btn gold" data-a="rdeliver" data-id="${o.id}">Mark as delivered</button>`;
    } else if (o.student_id === me && o.status === 'placed') actions = `<button class="btn bad" data-a="cancel" data-id="${o.id}">Cancel order (full refund)</button>`;
    const chatOk = o.student_id === me || o.rider_id === me || (o.vendor && o.vendor.owner_id === me) || role() === 'admin';
    const canChat = chatOk && role() !== 'admin' && !['cancelled', 'declined'].includes(o.status) || (chatOk && role() !== 'admin');
    return shell('Order #' + o.id, `<div class="card"><div class="row"><div class="sp b">${esc(o.vendor ? o.vendor.name : '')}</div><span class="pill ${o.status}">${STEP_LABEL[o.status]}</span></div>
      ${idx >= 0 ? `<div class="steps">${STEPS.map((s, i) => `<i class="${i <= idx ? 'd' : ''}"></i>`).join('')}</div>` : ''}
      <div class="mut">Placed ${ago(o.created_at)}${L ? ' · to ' + esc(L.name) : ''}</div>${o.note ? `<div class="mut">Note: ${esc(o.note)}</div>` : ''}</div>
    <div class="card">${o.items.map(i => `<div class="row" style="padding:3px 0"><span class="sp">${i.qty}× ${esc(i.name)}</span>${money(i.price * i.qty)}</div>`).join('')}
      <div class="row mut" style="margin-top:6px"><span class="sp">Delivery</span>${money(o.delivery_fee)}</div><div class="row b"><span class="sp">Total</span>${money(o.total)}</div></div>
    ${actions ? `<div class="card">${actions}</div>` : ''}
    ${people.length && !['cancelled', 'declined'].includes(o.status) ? `<div class="card"><h3 class="h" style="margin-bottom:8px">People on this order</h3>${people.map(([l, p]) => `<div class="item"><div class="av">${initials(p.full_name)}</div><div class="sp"><div class="b">${esc(p.full_name)}</div><div class="mut">${l}</div></div><button class="btn sm" data-a="call" data-id="${p.id}" data-name="${esc(p.full_name)}" style="gap:6px">${ic('phone', 16)} Call</button></div>`).join('')}</div>` : ''}
    ${canChat ? `<div class="card"><h3 class="h" style="margin-bottom:8px">Chat</h3><div class="chat">${(S.msgs[o.id] || []).map(m => `<div class="msg ${m.sender_id === me ? 'me' : ''}"><small>${m.sender_id === me ? 'You' : esc(nameFor(m.sender_id))}</small>${esc(m.body)}</div>`).join('') || '<div class="mut">No messages yet. Say hi.</div>'}</div>
    <form class="row" data-form="chat" data-id="${o.id}"><input data-k="chat${o.id}" name="body" maxlength="500" placeholder="Message…" autocomplete="off" style="flex:1;padding:12px;border:1.5px solid var(--line);border-radius:13px"><button class="btn sm" aria-label="Send">${ic('send', 18)}</button></form></div>` : ''}`, { back: 1 });
  }

  /* ---- wallet ---- */
  function walletScreen() {
    const cust = isCustomer();
    return shell(cust ? 'Wallet' : 'Earnings', `<div class="bal"><div style="opacity:.75;font-size:12px;font-weight:600">${cust ? 'BALANCE' : 'EARNED SO FAR'}</div><div class="n">${money(S.user.balance)}</div></div>
    ${cust ? `<div class="card"><div class="b">Add money</div><div class="chips">${[500, 1000, 2000, 5000].map(a => `<button class="chip" data-a="topup" data-v="${a}">+${money(a)}</button>`).join('')}</div><div class="mut">Demo mode: this adds test money instantly. Real card/transfer payments are coming soon.</div></div>` : ''}
    <h3 class="h" style="margin:4px 0 8px">History</h3><div class="card">${S.tx.map(t => `<div class="item"><div class="sp"><div class="b" style="font-size:14px">${esc(t.label)}</div><div class="mut">${ago(t.created_at)}</div></div><div class="b" style="color:${t.amount < 0 ? 'var(--bad)' : 'var(--ok)'}">${t.amount < 0 ? '−' : '+'}${money(Math.abs(t.amount))}</div></div>`).join('') || '<div class="empty">Nothing yet</div>'}</div>`);
  }
  function profile() {
    const u = S.user;
    return shell('Profile', `<div class="card row"><div class="av">${initials(u.full_name)}</div><div class="sp"><div class="b">${esc(u.full_name)}</div><div class="mut">${esc(ROLE_LABEL[u.role] || u.role)} · ${esc(u.email)}</div></div></div>
    <form class="card" data-form="profile"><label class="field"><span>Full name</span><input data-k="pname" data-reset="" name="name" value="${esc(u.full_name)}" required></label><label class="field"><span>Phone</span><input data-k="pphone" name="phone" value="${esc(u.phone || '')}"></label><button class="btn">Save changes</button></form>
    ${role() === 'vendor' && S.myVendor ? `<div class="card row"><div class="sp"><div class="b">${esc(S.myVendor.name)}</div><div class="mut">${S.myVendor.is_open ? 'Taking orders' : 'Closed'}</div></div><button class="btn sm ${S.myVendor.is_open ? 'ghost' : ''}" data-a="toggleopen">${S.myVendor.is_open ? 'Close kitchen' : 'Open kitchen'}</button></div>` : ''}
    <button class="btn ghost" data-a="logout">Log out</button><div class="sheet-note">EDEN · early version</div>`);
  }

  /* ---- vendor ---- */
  function board() {
    if (!S.myVendor) {
      const free = S.vendors.filter(v => !v.owner_id);
      return shell('Claim your kitchen', `<div class="mut" style="margin-bottom:10px">Pick the kitchen you run. Once claimed, its orders come to you.</div>${free.map(v => `<div class="card row"><div class="av">${esc(v.short || initials(v.name))}</div><div class="sp b">${esc(v.name)}</div><button class="btn sm" data-a="claim" data-v="${v.id}">This is mine</button></div>`).join('') || '<div class="empty">No unclaimed kitchens. Ask the admin to add yours.</div>'}`);
    }
    const mine = S.orders.filter(o => o.vendor && o.vendor.id === S.myVendor.id);
    const act = mine.filter(o => ['placed', 'accepted', 'preparing', 'ready'].includes(o.status)), done = mine.filter(o => !act.includes(o));
    return shell('Orders', `${act.length ? act.map(o => orderRow(o, o.student && o.student.full_name)).join('') : '<div class="empty">No active orders.<br>New ones appear here with a sound.</div>'}${done.length ? '<h3 class="h" style="margin:10px 0 8px">Earlier</h3>' + done.slice(0, 15).map(o => orderRow(o, o.student && o.student.full_name)).join('') : ''}`, { sub: S.myVendor.name });
  }
  function menuScreen() {
    if (!S.myVendor) return board();
    const items = S.menus[S.myVendor.id] || [];
    return shell('Menu', `<div class="card">${items.map(i => `<div class="item"><div class="sp"><div class="b">${esc(i.name)}</div><div class="mut">${money(i.price)}</div></div><button class="chip ${i.available ? 'on' : ''}" data-a="avail" data-v="${i.id}">${i.available ? 'Available' : 'Sold out'}</button><button class="chip" data-a="delitem" data-v="${i.id}" style="color:var(--bad)">Delete</button></div>`).join('') || '<div class="empty">No items yet</div>'}</div>
    <form class="card" data-form="additem"><div class="b" style="margin-bottom:8px">Add an item</div><label class="field"><span>Name</span><input data-k="iname" name="name" required></label><label class="field"><span>Description</span><input data-k="idesc" name="desc"></label><label class="field"><span>Price (₦)</span><input data-k="iprice" name="price" type="number" min="50" step="50" required></label><button class="btn">Add to menu</button></form>`, { sub: S.myVendor.name });
  }

  /* ---- rider ---- */
  function jobs() {
    const j = S.orders.filter(o => o.status === 'ready' && !o.rider_id);
    return shell('Delivery jobs', j.map(o => `<div class="card"><div class="row"><div class="sp"><div class="b">#${o.id} · ${esc(o.vendor.name)}</div><div class="mut">To ${esc((loc(o.location_id) || {}).name || '')}</div></div><div class="b">${money(o.delivery_fee)}</div></div><div style="height:10px"></div><button class="btn gold" data-a="raccept" data-id="${o.id}">Take this delivery</button></div>`).join('') || '<div class="empty">No jobs right now.<br>You\'ll be alerted when a kitchen has food ready.</div>');
  }
  function mine() {
    const m = S.orders.filter(o => o.rider_id === S.user.id);
    return shell('My runs', m.map(o => orderRow(o, (loc(o.location_id) || {}).name)).join('') || '<div class="empty">No deliveries yet</div>');
  }

  /* ---- admin ---- */
  function approvals() {
    return shell('Approvals', S.pending.map(p => `<div class="card row"><div class="av">${initials(p.full_name)}</div><div class="sp"><div class="b">${esc(p.full_name)}</div><div class="mut">${esc(ROLE_LABEL[p.role] || p.role)} · ${esc(p.phone || '')}</div><div class="mut">${esc(p.email || '')}</div></div><button class="btn sm" data-a="approve" data-v="${p.id}">Approve</button></div>`).join('') || '<div class="empty">Nobody is waiting for approval</div>', { right: `<button class="back" data-a="refresh" aria-label="Refresh">↻</button>` });
  }

  /* ---------- call overlay ---------- */
  function renderCall(st) {
    if (!st || st.phase === 'idle') { $call.innerHTML = ''; return; }
    const t = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    const label = { calling: 'Calling…', incoming: 'Incoming call', connecting: 'Connecting…', connected: t(st.seconds || 0), ended: st.reason || 'Call ended' }[st.phase];
    const hang = `<button class="red" data-a="hangup" aria-label="End call"><span style="display:inline-block;transform:rotate(135deg)">${ic('phone', 28)}</span></button>`;
    $call.innerHTML = `<div class="call"><div class="av">${esc(initials(st.peerName))}</div><h2 class="h">${esc(st.peerName || '')}</h2><div style="opacity:.8">${label}</div>
    <div class="acts">${st.phase === 'incoming' ? `<button class="red" data-a="decline" aria-label="Decline"><span style="display:inline-block;transform:rotate(135deg)">${ic('phone', 28)}</span></button><button class="grn" data-a="accept" aria-label="Answer">${ic('phone', 28)}</button>`
      : st.phase === 'ended' ? '' : `<button class="${st.muted ? 'act' : ''}" data-a="mute" aria-label="Mute">${ic('mic', 26)}</button>${hang}`}</div></div>`;
  }

  /* ---------- actions ---------- */
  const ACT = {
    mode(d) { S.authMode = d.v; S.err = ''; S.info = ''; render(); },
    back() { history.length > 1 ? history.back() : go(homeRoute()); },
    refresh: async () => { await run(loadAll); render(); },
    logout: async () => { clearInterval(pollT); clearTimeout(sigT); seenSig.clear(); calls = null; await api.signOut(); S.user = null; S.orders = []; S.msgs = {}; S.cart = { vendorId: null, q: {} }; S.myVendor = null; S.authMode = 'login'; location.hash = ''; render(); },
    inc(d) { if (S.cart.vendorId !== d.vendor) S.cart = { vendorId: d.vendor, q: {} }; S.cart.q[d.v] = Math.min(20, (S.cart.q[d.v] || 0) + 1); render(); },
    dec(d) { if (S.cart.vendorId !== d.vendor) return; S.cart.q[d.v] = Math.max(0, (S.cart.q[d.v] || 0) - 1); if (!S.cart.q[d.v]) delete S.cart.q[d.v]; render(); },
    async place() {
      const { v, lines } = cartLines(); const lid = document.querySelector('[data-k="loc"]').value, note = document.querySelector('[data-k="note"]').value;
      S.busy = true; render();
      const id = await run(() => api.placeOrder(v.id, lines.map(l => ({ item_id: l.item.id, qty: l.n })), lid, note));
      S.busy = false;
      if (id !== undefined) { S.cart = { vendorId: null, q: {} }; await refreshWallet(); await refreshOrders(false); toast('Order placed! The kitchen has been told.'); go('order/' + id); } else render();
    },
    async cancel(d) { await run(() => api.cancelOrder(+d.id), 'Order cancelled and refunded'); await refreshWallet(); await refreshOrders(false); },
    async vstat(d) { await run(() => api.vendorSetStatus(+d.id, d.v)); await refreshWallet(); await refreshOrders(false); },
    async raccept(d) { const ok = await run(() => api.riderAccept(+d.id).then(() => 1), 'Delivery accepted'); await refreshOrders(false); if (ok) go('order/' + d.id); },
    async rdeliver(d) { await run(() => api.riderDeliver(+d.id), 'Delivered. Payment added to your earnings'); await refreshWallet(); await refreshOrders(false); },
    async topup(d) { await run(() => api.demoTopup(+d.v), 'Added ' + money(+d.v)); await refreshWallet(); render(); },
    async claim(d) { await run(() => api.claimVendor(d.v), 'Kitchen claimed'); S.myVendor = await api.myVendor(); if (S.myVendor) S.menus[S.myVendor.id] = await api.menu(S.myVendor.id); await refreshOrders(false); },
    async toggleopen() { await run(() => api.setVendorOpen(S.myVendor.id, !S.myVendor.is_open)); S.myVendor = await api.myVendor(); render(); },
    async avail(d) { const it = S.menus[S.myVendor.id].find(i => i.id === d.v); await run(() => api.setItemAvailable(d.v, !it.available)); S.menus[S.myVendor.id] = await api.menu(S.myVendor.id); render(); },
    async delitem(d) { await run(() => api.deleteItem(d.v)); S.menus[S.myVendor.id] = await api.menu(S.myVendor.id); render(); },
    async approve(d) { await run(() => api.setApproved(d.v, true), 'Approved'); S.pending = await api.pending(); render(); },
    call(d) { initCalls(); calls.start(d.id, d.name); },
    accept() { calls.accept(); }, decline() { calls.decline(); }, hangup() { calls.hangup(); }, mute() { calls.toggleMute(); }
  };
  document.addEventListener('click', e => { const t = e.target.closest('[data-a]'); if (!t || t.tagName === 'SELECT') return; e.preventDefault(); const f = ACT[t.dataset.a]; if (f) f(t.dataset, t); });
  document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.k === 'loc') { S.cart.loc = e.target.value; render(); } });
  document.addEventListener('submit', async e => {
    const f = e.target.dataset && e.target.dataset.form; if (!f) return; e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    if (f === 'login' || f === 'signup') {
      S.busy = true; S.err = ''; S.info = ''; render();
      try {
        if (f === 'signup') { const r = await api.signUp({ email: v.email.trim(), password: v.pw, full_name: v.name.trim(), phone: v.phone.trim(), role: v.role }); if (r.needsConfirm) { S.busy = false; S.authMode = 'login'; S.info = 'Account created. Check your email to confirm it, then log in.'; return render(); } }
        else await api.signIn(v.email.trim(), v.pw);
        await loadAll(); location.hash = '';
      } catch (er) { S.err = er.message; S.user = null; }
      S.busy = false; render();
    } else if (f === 'chat') {
      const body = (v.body || '').trim(); if (!body) return;
      e.target.querySelector('input').value = ''; const inp = document.querySelector(`[data-k="chat${e.target.dataset.id}"]`);
      await run(() => api.sendMessage(+e.target.dataset.id, body));
      if (META.MOCK) S.msgs[e.target.dataset.id] = await api.messages(+e.target.dataset.id);
      render(); const c = document.querySelector('.chat'); if (c) c.scrollTop = c.scrollHeight;
    } else if (f === 'profile') { await run(() => api.updateProfile({ full_name: v.name.trim(), phone: v.phone.trim() }), 'Saved'); S.user = await api.me(); render(); }
    else if (f === 'additem') { await run(() => api.addItem(S.myVendor.id, v.name.trim(), (v.desc || '').trim(), parseInt(v.price, 10)), 'Item added'); S.menus[S.myVendor.id] = await api.menu(S.myVendor.id); e.target.reset(); render(); }
  });
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && S.user.approved) { refreshOrders(false); refreshWallet().then(render); } });

  /* ---------- boot ---------- */
  async function boot() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!api) {
      $app.innerHTML = `<div class="hero"><div class="logo">EDEN</div><p>Setup needed</p></div><div class="main"><div class="card"><h3 class="h">Not connected to a database yet</h3><p class="mut">Open <b>app/config.js</b> and paste your Supabase Project URL and anon public key, then reload. To try the screens without a database, add <b>?mock=1</b> to the address.</p></div></div>`;
      return;
    }
    try { const uid = await api.init(); if (uid) await loadAll(); } catch (e) { S.err = e.message; S.user = null; }
    S.ready = true; render();
    if (META.MOCK) { const b = document.createElement('div'); b.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#E8C94A;color:#14126B;font:700 11px Inter;padding:3px 10px;border-radius:10px;z-index:50;pointer-events:none'; b.textContent = 'TEST MODE · data is not saved'; document.body.appendChild(b); }
    window.__eden = { S, api, ACT, calls: () => calls };
  }
  boot();
})();
