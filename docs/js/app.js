/* Bizzle Huddle v4.20 — main app (vanilla JS, no build step).
   Real multiplayer on the user's own Supabase project. No keys are hardcoded. */
(function () {
'use strict';
var VERSION = window.HUDDLE_VERSION, BUILD = window.HUDDLE_BUILD;
var AI = window.HuddleAI;
var MAX_HOPS = 3;                 // agent→agent chain limit
var RATE_PER_AGENT_MIN = 6;       // replies per agent per minute (on the owner's device)
var RATE_PER_OWNER_MIN = 12;      // all of my agents per minute
var BUCKET = 'huddle-files';
var LS = { conn: 'bh.conn', invite: 'bh.pendingInvite', lastWs: 'bh.lastWs', bizzy: 'bh.bizzy', rate: 'bh.rate', seen: 'bh.seenJobs' };

/* ---------------- tiny helpers ---------------- */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); })); }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
function fmtTime(t) { var d = new Date(t); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function fmtDay(t) { var d = new Date(t), n = new Date(); if (d.toDateString() === n.toDateString()) return 'Today'; var y = new Date(Date.now() - 864e5); if (d.toDateString() === y.toDateString()) return 'Yesterday'; return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); }
function ago(t) { if (!t) return 'never'; var s = (Date.now() - new Date(t)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }
function fmtBytes(n) { n = Number(n || 0); if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
function toast(msg, err) { var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; $('#toasts').appendChild(t); setTimeout(function () { t.remove(); }, err ? 6000 : 3000); }
function debounce(fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; }
function isPhone() { return window.matchMedia('(max-width:767px)').matches; }
function copyText(text) {
  function fallback() { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).catch(fallback); else fallback();
  toast('Copied ✓');
}
function avatarHtml(av, cls) {
  av = av || '🙂';
  var inner = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(av) ? '<img alt="" src="' + av + '">' : esc(av).slice(0, 16);
  return '<div class="av ' + (cls || '') + '">' + inner + '</div>';
}
function fileToBase64(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(file); }); }
function blobToBase64(b) { return fileToBase64(b); }
function resizeImage(file, max) {
  return new Promise(function (res, rej) {
    var img = new Image(); var url = URL.createObjectURL(file);
    img.onload = function () { var s = Math.min(1, max / Math.max(img.width, img.height)); var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = rej; img.src = url;
  });
}

/* Safe mini-markdown: escape first, then format. */
function md(text, opts) {
  opts = opts || {};
  var blocks = [];
  var s = String(text || '').replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) { blocks.push('<pre><code>' + esc(code) + '</code></pre>'); return '\u0000' + (blocks.length - 1) + '\u0000'; });
  s = esc(s);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/^#{1,3} (.+)$/gm, '<b>$1</b>')
    .replace(/^[-*] (.+)$/gm, '• $1');
  // @mentions
  var names = (opts.names || []).slice().sort(function (a, b) { return b.length - a.length; });
  if (names.length) {
    var re = new RegExp('@(' + names.map(function (n) { return esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')(?![\\w])', 'gi');
    s = s.replace(re, function (m, n) { var me = opts.me && n.toLowerCase() === esc(opts.me).toLowerCase(); return '<span class="mention' + (me ? ' me' : '') + '">@' + n + '</span>'; });
  }
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return blocks[+i]; });
  return s;
}

/* ---------------- state ---------------- */
var S = {
  sb: null, conn: null, user: null, profile: null,
  wsList: [], ws: null, role: 'member',
  members: [], profiles: {}, rooms: [], unread: {}, agents: [],
  msgs: {}, threadMsgs: {}, replyCounts: {}, lastActivity: {}, threadsByRoom: {},
  online: {}, typing: {}, approvals: [], apps: [], automations: [], runs: [], files: [],
  sideTab: 'home', chan: null, route: {}, pendingFiles: [], threadPendingFiles: [],
  signed: {}, autoTimer: null, bizzyOpen: false
};
function me() { return S.user && S.user.id; }
function isAdmin() { return S.role === 'admin'; }
function profileOf(id) { return S.profiles[id] || { display_name: 'Someone', avatar: '🙂' }; }
function agentOf(id) { for (var i = 0; i < S.agents.length; i++) if (S.agents[i].id === id) return S.agents[i]; return null; }
function roomOf(id) { for (var i = 0; i < S.rooms.length; i++) if (S.rooms[i].id === id) return S.rooms[i]; return null; }
function myAgents() { return S.agents.filter(function (a) { return a.owner_id === me(); }); }
function agentOnline(a) { return !!S.online[a.owner_id]; }
function mentionNames() { return S.members.map(function (m) { return profileOf(m.user_id).display_name; }).concat(S.agents.map(function (a) { return a.name; })); }

/* ---------------- connection (URL + anon key in localStorage) ---------------- */
function getConn() { return lsGet(LS.conn, null); }
function setConn(c) { lsSet(LS.conn, c); }
function validConn(c) { return c && /^https?:\/\/[^\s/]+/.test(c.url || '') && (c.key || '').length > 20; }
function makeClient(c) {
  return supabase.createClient(c.url.replace(/\/+$/, ''), c.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'bh.auth.' + c.url.replace(/[^a-z0-9]/gi, '').slice(-24) },
    realtime: { params: { eventsPerSecond: 20 } }
  });
}
function appBase() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
function webBase() { return window.Capacitor ? 'https://leehizzbt.github.io/bizzle-huddle/' : appBase(); }
/* Email confirmation / magic-link redirect: carries the (public) connection + pending invite in the
   query string so the link also works in a fresh browser that never saw the connect screen. */
function authRedirect() {
  var c = S.conn || {}, inv = lsGet(LS.invite, null);
  return webBase() + '?hc=' + encodeURIComponent(c.url || '') + '&hk=' + encodeURIComponent(c.key || '') + (inv ? '&hi=' + encodeURIComponent(inv) : '');
}
function handleAuthRedirectQuery() {
  var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (!q.get('hc') && !q.get('hi')) return;
  if (q.get('hc') && q.get('hk')) { var prev = getConn(); if (!prev || prev.url !== q.get('hc') || prev.key !== q.get('hk')) setConn({ url: q.get('hc'), key: q.get('hk') }); }
  if (q.get('hi')) lsSet(LS.invite, q.get('hi'));
  history.replaceState(null, '', location.pathname + location.hash);
}
/* Android app: invite links arriving as bizzlehuddle://join#/join?u=..&k=..&i=.. (or an https invite link shared to the app) */
function appInviteLink() { var l = inviteLink(); return 'bizzlehuddle://join' + l.slice(l.indexOf('#/join')); }
function handleAppUrl(url) {
  if (!url || url.indexOf('#/join') < 0) return;
  try { if (sessionStorage.getItem('bh.lastAppUrl') === url) return; sessionStorage.setItem('bh.lastAppUrl', url); } catch (e) {}
  var h = url.slice(url.indexOf('#/join'));
  if (location.hash === h) return;
  location.hash = h; // processed by the hashchange handler (stores connection + invite, joins if signed in)
}
(function initAppLinks() {
  var App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (!App) return;
  try {
    App.addListener('appUrlOpen', function (e) { handleAppUrl(e && e.url); });
    App.getLaunchUrl().then(function (r) { if (r && r.url) setTimeout(function () { handleAppUrl(r.url); }, 300); });
  } catch (e) { console.warn('app links', e); }
})();
function inviteLink() {
  var c = S.conn; var code = S.ws && S.ws.invite_code;
  return webBase() + '#/join?u=' + encodeURIComponent(c.url) + '&k=' + encodeURIComponent(c.key) + (code ? '&i=' + encodeURIComponent(code) : '');
}
function parseInvite(str) {
  var i = str.indexOf('#/join'); if (i < 0) return null;
  var q = str.slice(i + 6).replace(/^\?/, ''); var o = {};
  q.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) o[p[0]] = decodeURIComponent(p[1] || ''); });
  return o;
}

/* ---------------- routing ---------------- */
var navStack = [location.hash];
function canBack() { return navStack.length > 1; }
function parseRoute() {
  var h = location.hash.replace(/^#\/?/, '').split('?')[0];
  var p = h.split('/').filter(Boolean);
  var r = { view: p[0] || '' };
  if (p[0] === 'w') {
    r.ws = p[1]; r.view = 'home';
    if (p[2] === 'r') { r.view = 'room'; r.room = p[3]; r.tab = 'chat'; if (p[4] === 't') r.thread = p[5]; else if (p[4]) r.tab = p[4]; }
    else if (p[2]) r.view = p[2];
  }
  return r;
}
function go(path, replace) {
  var h = '#/' + path;
  if (location.hash === h) { render(); return; }
  if (replace) { history.replaceState(null, '', h); navStack[navStack.length - 1] = h; render(); } else { location.hash = h; }
}
function wsPath(rest) { return 'w/' + S.ws.id + (rest ? '/' + rest : ''); }
function goBack(fallback) {
  if (canBack()) { history.back(); return; }
  go(fallback || (S.ws ? wsPath('') : ''), true);
}
function backBtn(fallback, label) {
  return '<button class="back" data-back="' + esc(fallback || '') + '" title="Back" aria-label="Back">←' + (label ? ' <span>' + esc(label) + '</span>' : '') + '</button>';
}
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-back]'); if (b) { e.preventDefault(); goBack(b.getAttribute('data-back') || null); return; }
  var g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.getAttribute('data-go')); }
});
window.addEventListener('hashchange', function () {
  // invite link opened in an already-running app (same document): process it now
  if (location.hash.indexOf('#/join') === 0) {
    var inv = parseInvite(location.hash), prev = getConn();
    var connChanged = inv && inv.u && inv.k && (!prev || prev.url !== inv.u || prev.key !== inv.k);
    handleInviteHash();
    if (connChanged || !S.sb) { location.reload(); return; }
    if (S.user) { teardown(); afterLogin(); } else renderAuth(true);
    return;
  }
  var h = location.hash;
  if (navStack.length > 1 && navStack[navStack.length - 2] === h) navStack.pop();
  else if (navStack[navStack.length - 1] !== h) { navStack.push(h); if (navStack.length > 100) navStack.shift(); }
  render();
});

/* ---------------- boot ---------------- */
function handleInviteHash() {
  var inv = parseInvite(location.hash);
  if (!inv) return false;
  if (inv.u && inv.k) {
    var prev = getConn();
    if (!prev || prev.url !== inv.u || prev.key !== inv.k) setConn({ url: inv.u, key: inv.k });
  }
  if (inv.i) lsSet(LS.invite, inv.i);
  history.replaceState(null, '', location.pathname + location.search + '#/');
  return true;
}
async function boot() {
  applyTheme();
  handleAuthRedirectQuery();
  var fromInvite = handleInviteHash();
  S.conn = getConn();
  if (!validConn(S.conn)) { renderConnect(); return; }
  try { S.sb = makeClient(S.conn); } catch (e) { toast('Bad Supabase URL: ' + e.message, true); renderConnect(); return; }
  var res = await S.sb.auth.getSession();
  S.sb.auth.onAuthStateChange(function (ev, session) {
    if (ev === 'SIGNED_OUT') { S.user = null; teardown(); renderAuth(); }
    else if (ev === 'SIGNED_IN' && session && (!S.user || S.user.id !== session.user.id)) { S.user = session.user; afterLogin(); }
  });
  if (!res.data.session) {
    var em = /error_description=([^&]+)/.exec(location.hash);
    if (/access_token|error_description/.test(location.hash)) history.replaceState(null, '', '#/');
    renderAuth(fromInvite);
    if (em) { var t = decodeURIComponent(em[1].replace(/\+/g, ' ')); toast('Email link problem: ' + t + '. Sign in with your password, or use Resend.', true); }
    return;
  }
  S.user = res.data.session.user;
  await afterLogin();
}
var loggingIn = false;
async function afterLogin() {
  if (loggingIn) return; loggingIn = true;
  var startHash = location.hash;
  try {
    if (/access_token/.test(location.hash)) history.replaceState(null, '', '#/');
    // the cached session may belong to an account that was deleted on the server: verify it once
    var gu = await S.sb.auth.getUser();
    if (gu.error && gu.error.status && gu.error.status >= 400 && gu.error.status < 500) {
      try { await S.sb.auth.signOut({ scope: 'local' }); } catch (e) {}
      S.user = null; loggingIn = false; renderAuth(); toast('Your session ended (account not found). Please sign in or sign up again.', true); return;
    }
    await loadProfile();
    var code = lsGet(LS.invite, null);
    if (code) {
      var j = await S.sb.rpc('join_workspace', { p_code: code });
      localStorage.removeItem(LS.invite);
      if (j.error) toast('Invite: ' + j.error.message, true); else { lsSet(LS.lastWs, j.data); toast('Joined the workspace 🎉'); }
    }
    await loadWorkspaces();
    var r = parseRoute();
    var target = (r.ws && S.wsList.some(function (w) { return w.id === r.ws; })) ? r.ws : lsGet(LS.lastWs, null);
    if (!S.wsList.some(function (w) { return w.id === target; })) target = S.wsList[0] && S.wsList[0].id;
    if (!target) { go('onboard', true); return; }
    await enterWorkspace(target);
    if (location.hash !== startHash && parseRoute().ws === target) render(); // user already navigated inside this workspace
    else if (!r.ws || r.ws !== target) go('w/' + target, true); else render();
  } catch (e) { console.error(e); toast(e.message || String(e), true); renderFatal(e); }
  finally { loggingIn = false; }
}
async function loadProfile() {
  var r = await S.sb.from('profiles').select('*').eq('id', me()).maybeSingle();
  if (!r.data) {
    var name = (S.user.user_metadata && S.user.user_metadata.display_name) || (S.user.email || 'friend').split('@')[0];
    var ins = await S.sb.from('profiles').upsert({ id: me(), display_name: name }).select().single();
    if (ins.error) throw ins.error; S.profile = ins.data;
  } else S.profile = r.data;
  S.profiles[me()] = S.profile;
}
async function loadWorkspaces() {
  var r = await S.sb.from('workspace_members').select('role, workspaces(*)').eq('user_id', me());
  if (r.error) throw r.error;
  S.wsList = (r.data || []).filter(function (x) { return x.workspaces; }).map(function (x) { var w = x.workspaces; w.myRole = x.role; return w; });
}
function renderFatal(e) {
  var msg = e && e.message || String(e);
  var hint = /relation .* does not exist|PGRST20|schema cache|Could not find/i.test(msg) ? '<div class="note">It looks like the database tables are missing. Open your Supabase SQL editor and run <b>schema.sql</b> (see SETUP.md), then reload.</div>' : '';
  $('#app').innerHTML = '<div class="screen"><div class="card"><div class="screen-head">' + backBtn('connect') + '<h2>Something went wrong</h2></div><p class="muted">' + esc(msg) + '</p>' + hint +
    '<div class="row wrap"><button class="btn primary" onclick="location.reload()">Reload</button><button class="btn" id="fatal-out">Sign out</button><button class="btn" id="fatal-conn">Change Supabase connection</button></div></div></div>';
  $('#fatal-conn').onclick = function () { renderConnect(); };
  $('#fatal-out').onclick = async function () { try { await S.sb.auth.signOut({ scope: 'local' }); } catch (e) {} location.hash = '#/'; location.reload(); };
}

/* ---------------- screens: connect / auth / onboarding ---------------- */
function renderConnect() {
  var c = getConn() || {};
  $('#app').innerHTML = '<div class="screen"><div class="card">' +
    '<div class="screen-head">' + backBtn('') + '<div class="logo">🫂</div><div><h1 class="brand">Bizzle Huddle <span class="v420">v4.20</span></h1><div class="muted small">Free multiplayer AI workspace</div></div></div>' +
    '<h2>Connect your Supabase</h2><p class="muted small">Huddle runs on <b>your own free Supabase project</b>. Paste its Project URL and <b>publishable</b> (or legacy anon) key: tap <b>Connect</b> on your project page, or open Project Settings → API Keys. Or paste an invite link a friend sent you.</p>' +
    '<label>Invite link (optional)</label><input id="c-inv" placeholder="https://…/bizzle-huddle/#/join?u=…">' +
    '<label>Project URL</label><input id="c-url" type="url" placeholder="https://abcd1234.supabase.co" value="' + esc(c.url || '') + '">' +
    '<label>Publishable key (or legacy anon key)</label><input id="c-key" type="password" placeholder="eyJhbGciOi… or sb_publishable_…" value="' + esc(c.key || '') + '">' +
    '<div class="note">🔒 The <b>anon / publishable key is public-safe</b>: it is designed to ship inside apps and only allows what the Row Level Security policies in <code>schema.sql</code> allow (members see only their own workspaces and rooms). It is stored only in this browser (localStorage). <b>Never</b> paste the <code>service_role</code> / secret key here.</div>' +
    '<div class="row wrap"><button class="btn primary" id="c-save">Connect</button><a class="btn" href="https://supabase.com/dashboard" target="_blank" rel="noopener">Open Supabase ↗</a></div>' +
    '<p class="muted small">New here? Follow SETUP.md: sign in at supabase.com with GitHub → New project (Free) → SQL Editor → paste <code>schema.sql</code> → Run.</p>' +
    '<p class="tiny muted">v' + VERSION + ' · build ' + BUILD + '</p></div></div>';
  $('#c-inv').addEventListener('input', function () {
    var o = parseInvite(this.value.trim()); if (!o) return;
    if (o.u) $('#c-url').value = o.u; if (o.k) $('#c-key').value = o.k; if (o.i) lsSet(LS.invite, o.i);
    toast('Invite link read ✓');
  });
  $('#c-save').onclick = async function () {
    var conn = { url: $('#c-url').value.trim().replace(/\/+$/, ''), key: $('#c-key').value.trim() };
    if (!validConn(conn)) { toast('Enter a valid URL and key', true); return; }
    if (/service_role|sb_secret_/.test(conn.key) || keyRole(conn.key) === 'service_role') { toast('That is a SECRET service_role key. Use the anon public key instead.', true); return; }
    this.disabled = true; this.textContent = 'Checking…';
    try {
      var r = await fetch(conn.url + '/rest/v1/workspaces?select=id&limit=1', { headers: { apikey: conn.key, Authorization: 'Bearer ' + conn.key } });
      var txt = await r.text();
      if (/permission denied/i.test(txt)) throw new Error('Connected, but database permissions are missing. Run the latest schema.sql in the SQL editor again.');
      if (r.status === 401 || r.status === 403) throw new Error('Key rejected (' + r.status + '). Copy the publishable (anon) key again.');
      if (r.status === 404 || /PGRST20|does not exist|schema cache/.test(txt)) throw new Error('Connected, but the tables are missing. Run schema.sql in the SQL editor first.');
      if (!r.ok) throw new Error('Supabase answered ' + r.status + ': ' + txt.slice(0, 120));
      setConn(conn); toast('Connected ✓'); location.hash = '#/'; location.reload();
    } catch (e) { toast(e.message.indexOf('Failed to fetch') >= 0 ? 'Could not reach that URL. Check it and your internet.' : e.message, true); this.disabled = false; this.textContent = 'Connect'; }
  };
}
function keyRole(k) { try { return JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch (e) { return null; } }

function renderAuth(fromInvite) {
  var tab = renderAuth.tab || 'signin';
  var inv = lsGet(LS.invite, null);
  $('#app').innerHTML = '<div class="screen"><div class="card">' +
    '<div class="screen-head">' + backBtn('connect') + '<div class="logo">🫂</div><div><h1 class="brand">Bizzle Huddle <span class="v420">v4.20</span></h1><div class="muted small">' + esc((S.conn.url || '').replace(/^https?:\/\//, '')) + '</div></div></div>' +
    (inv ? '<div class="note">🎟️ You were invited! Sign up or sign in and you\'ll join the workspace automatically.</div>' : '') +
    '<div class="tabs" id="a-tabs"><button data-t="signin" class="' + (tab === 'signin' ? 'on' : '') + '">Sign in</button><button data-t="signup" class="' + (tab === 'signup' ? 'on' : '') + '">Sign up</button><button data-t="magic" class="' + (tab === 'magic' ? 'on' : '') + '">Magic link</button></div>' +
    (tab === 'signup' ? '<label>Your name</label><input id="a-name" placeholder="Nunya">' : '') +
    '<label>Email</label><input id="a-email" type="email" autocomplete="email" placeholder="you@example.com">' +
    (tab !== 'magic' ? '<label>Password</label><input id="a-pass" type="password" autocomplete="' + (tab === 'signup' ? 'new-password' : 'current-password') + '" placeholder="at least 6 characters">' : '') +
    '<div class="row" style="margin-top:14px"><button class="btn primary" id="a-go">' + ({ signin: 'Sign in', signup: 'Create account', magic: 'Email me a link' })[tab] + '</button></div>' +
    '<p class="muted small" id="a-msg"></p>' +
    '<p class="tiny muted">Magic links open in the browser. In the Android app, use email + password.</p>' +
    '<button class="btn sm" id="a-conn">Change Supabase connection</button></div></div>';
  $$('#a-tabs button').forEach(function (b) { b.onclick = function () { renderAuth.tab = b.getAttribute('data-t'); renderAuth(); }; });
  $('#a-conn').onclick = renderConnect;
  $('#a-go').onclick = async function () {
    var email = $('#a-email').value.trim(), pass = $('#a-pass') ? $('#a-pass').value : '';
    var msg = $('#a-msg'); if (!email) { toast('Enter your email', true); return; }
    this.disabled = true;
    try {
      var r;
      if (tab === 'signin') r = await S.sb.auth.signInWithPassword({ email: email, password: pass });
      else if (tab === 'signup') {
        r = await S.sb.auth.signUp({ email: email, password: pass, options: { data: { display_name: ($('#a-name').value || '').trim() || email.split('@')[0] }, emailRedirectTo: authRedirect() } });
        if (!r.error && !r.data.session) { msg.innerHTML = '📬 <b>Almost there!</b> We emailed a confirmation link to <b>' + esc(email) + '</b>. Tap it (check spam too). It opens Huddle in your browser already signed in. In the Android app, come back here and <b>Sign in</b> with your email + password after confirming.' + ' <button class="btn sm" id="a-resend">Resend email</button>'; wireResend(email); }
      } else {
        r = await S.sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: authRedirect() } });
        if (!r.error) msg.innerHTML = '📬 Magic link sent! Open it on this device.';
      }
      if (r.error) throw r.error;
    } catch (e) {
      if (/not confirmed/i.test(e.message)) { msg.innerHTML = '📬 Your email isn\'t confirmed yet. Open the confirmation email we sent to <b>' + esc(email) + '</b>, tap the link, then sign in again. <button class="btn sm" id="a-resend">Resend email</button>'; wireResend(email); }
      else if (/not authorized/i.test(e.message)) { msg.innerHTML = '✉️ Supabase\'s free built-in mailer only emails the project owner\'s team. Ask the workspace admin to turn off <b>Confirm email</b> (Authentication → Sign In / Providers → Email) or add free custom SMTP. See SETUP.md.'; toast(e.message, true); }
      else if (/rate limit/i.test(e.message)) { msg.innerHTML = '⏳ Supabase\'s free mailer allows only a couple of emails per hour. Wait a bit, or ask the admin to turn off <b>Confirm email</b> (see SETUP.md).'; toast(e.message, true); }
      else { toast(e.message, true); msg.textContent = e.message; }
    }
    this.disabled = false;
  };
}

function wireResend(email) {
  var b = $('#a-resend'); if (!b) return;
  b.onclick = async function () {
    b.disabled = true;
    var r = await S.sb.auth.resend({ type: 'signup', email: email, options: { emailRedirectTo: authRedirect() } });
    if (r.error) toast(r.error.message, true); else toast('Confirmation email sent again ✓');
    setTimeout(function () { b.disabled = false; }, 30000);
  };
}

function renderOnboard() {
  $('#app').innerHTML = '<div class="screen"><div class="card">' +
    '<div class="screen-head">' + backBtn('') + '<div class="logo">🫂</div><div><div class="muted small">Step 1 of 2</div><h1>Name your workspace</h1></div></div>' +
    '<p class="muted">This is your team\'s home: people, AI agents, rooms, apps and automations.</p>' +
    '<label>Workspace name</label><input id="o-name" maxlength="80" placeholder="Bizzle HQ">' +
    '<label>Your display name</label><input id="o-dn" maxlength="40" value="' + esc(S.profile && S.profile.display_name || '') + '">' +
    '<div class="row" style="margin-top:14px"><button class="btn primary" id="o-go">Create workspace →</button></div>' +
    '<hr style="border-color:var(--line);margin:18px 0"><label>Got an invite code instead?</label><div class="row"><input id="o-code" placeholder="invite code"><button class="btn" id="o-join">Join</button></div>' +
    (S.wsList.length ? '<p><button class="btn sm" id="o-cancel">Back to my workspaces</button></p>' : '') +
    '<p><button class="btn sm" id="o-out">Sign out</button></p></div></div>';
  $('#o-out').onclick = function () { S.sb.auth.signOut(); };
  if ($('#o-cancel')) $('#o-cancel').onclick = function () { go('w/' + (S.ws ? S.ws.id : S.wsList[0].id)); };
  $('#o-go').onclick = async function () {
    var name = $('#o-name').value.trim(), dn = $('#o-dn').value.trim();
    if (!name) { toast('Give it a name', true); return; }
    this.disabled = true;
    if (dn && dn !== S.profile.display_name) { await S.sb.from('profiles').update({ display_name: dn }).eq('id', me()); S.profile.display_name = dn; }
    var r = await S.sb.rpc('create_workspace', { p_name: name });
    if (r.error) { toast(r.error.message, true); this.disabled = false; return; }
    await loadWorkspaces(); await enterWorkspace(r.data);
    go('invite-team', true);
  };
  $('#o-join').onclick = async function () {
    var code = $('#o-code').value.trim(); if (!code) return;
    var r = await S.sb.rpc('join_workspace', { p_code: code });
    if (r.error) { toast(r.error.message, true); return; }
    await loadWorkspaces(); await enterWorkspace(r.data); go('w/' + r.data, true);
  };
}
function renderInviteTeam() {
  if (!S.ws) { go('', true); return; }
  var link = inviteLink();
  $('#app').innerHTML = '<div class="screen"><div class="card">' +
    '<div class="screen-head">' + backBtn(wsPath('')) + '<div class="logo">🎉</div><div><div class="muted small">Step 2 of 2</div><h1>Your workspace is almost ready</h1></div></div>' +
    '<h2>Who else should be on the team?</h2><p class="muted">Send this one-tap invite link. It carries your Supabase URL + anon key in the <b>#fragment</b> (never sent to any server) plus a workspace invite code.</p>' +
    inviteBox(link) +
    '<div class="row wrap" style="margin-top:16px"><button class="btn primary" id="i-go">Open #welcome →</button></div></div></div>';
  bindInviteBox();
  $('#i-go').onclick = function () { var w = S.rooms.find(function (r) { return r.name === 'welcome'; }) || S.rooms[0]; go(wsPath(w ? 'r/' + w.id : '')); };
}
function inviteBox(link) {
  return '<div class="card" style="background:var(--panel2)"><div class="small muted">Invite link</div><div style="word-break:break-all;font-family:ui-monospace,monospace;font-size:12px;margin:6px 0" id="inv-link">' + esc(link) + '</div>' +
    '<div class="row wrap"><button class="btn primary sm" id="inv-copy">📋 Copy link</button>' + (navigator.share ? '<button class="btn sm" id="inv-share">📤 Share</button>' : '') +
    (isAdmin() ? '<button class="btn sm" id="inv-rotate">🔄 New code</button>' : '') + '</div>' +
    '<div class="tiny muted" style="margin-top:6px">The anon key is public-safe (RLS protects every row). The invite code lets someone join <b>this</b> workspace — rotate it any time.</div></div>';
}
function bindInviteBox() {
  $('#inv-copy').onclick = function () { copyText($('#inv-link').textContent); };
  if ($('#inv-share')) $('#inv-share').onclick = function () { navigator.share({ title: 'Join ' + S.ws.name + ' on Bizzle Huddle', text: 'Join my Bizzle Huddle workspace', url: $('#inv-link').textContent }).catch(function () {}); };
  if ($('#inv-rotate')) $('#inv-rotate').onclick = async function () {
    var r = await S.sb.rpc('rotate_invite', { p_ws: S.ws.id }); if (r.error) { toast(r.error.message, true); return; }
    S.ws.invite_code = r.data; $('#inv-link').textContent = inviteLink(); toast('New invite code — old links stop working');
  };
}

/* ---------------- workspace data + realtime ---------------- */
function teardown() {
  if (S.chan) { try { S.sb.removeChannel(S.chan); } catch (e) {} S.chan = null; }
  if (S.autoTimer) { clearInterval(S.autoTimer); S.autoTimer = null; }
  S.msgs = {}; S.threadMsgs = {}; S.replyCounts = {}; S.online = {}; S.typing = {};
}
async function enterWorkspace(wsId) {
  teardown();
  var w = S.wsList.find(function (x) { return x.id === wsId; });
  if (!w) throw new Error('Workspace not found');
  S.ws = w; S.role = w.myRole || 'member'; lsSet(LS.lastWs, wsId);
  var sb = S.sb;
  var res = await Promise.all([
    sb.from('workspace_members').select('*').eq('workspace_id', wsId),
    sb.from('rooms').select('*').eq('workspace_id', wsId).order('created_at'),
    sb.from('agents').select('*').eq('workspace_id', wsId).order('created_at'),
    sb.from('approvals').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(100),
    sb.from('apps').select('id,room_id,name,status,agent_id,created_by,approved_by,published_at,updated_at,created_at,prompt').eq('workspace_id', wsId).order('created_at', { ascending: false }),
    sb.from('automations').select('*').eq('workspace_id', wsId).order('created_at'),
    sb.from('messages').select('id,room_id,parent_id,created_at,content,author_id,agent_id').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(400)
  ]);
  res.forEach(function (r) { if (r.error) throw r.error; });
  S.members = res[0].data; S.rooms = res[1].data; S.agents = res[2].data; S.approvals = res[3].data; S.apps = res[4].data; S.automations = res[5].data;
  var me_ = S.members.find(function (m) { return m.user_id === me(); }); if (me_) S.role = me_.role;
  var ids = S.members.map(function (m) { return m.user_id; });
  var pr = await sb.from('profiles').select('*').in('id', ids.length ? ids : [me()]);
  (pr.data || []).forEach(function (p) { S.profiles[p.id] = p; });
  // activity + thread index from recent messages
  S.lastActivity = {}; S.threadsByRoom = {}; S.replyCounts = {};
  res[6].data.slice().reverse().forEach(indexActivity);
  await refreshUnread();
  subscribe();
  startAutomationLoop();
  catchUpAgentJobs();
}
function indexActivity(m) {
  S.lastActivity[m.room_id] = m.created_at;
  if (m.parent_id) {
    S.replyCounts[m.parent_id] = (S.replyCounts[m.parent_id] || 0) + 1;
    var list = S.threadsByRoom[m.room_id] = S.threadsByRoom[m.room_id] || {};
    list[m.parent_id] = { id: m.parent_id, last: m.created_at };
  }
}
async function refreshUnread() {
  var r = await S.sb.rpc('unread_counts', { p_ws: S.ws.id });
  S.unread = {};
  (r.data || []).forEach(function (x) { S.unread[x.room_id] = { unread: Number(x.unread), mentions: Number(x.mentions) }; });
}
function totalUnread() { var n = 0; for (var k in S.unread) n += S.unread[k].unread; return n; }
function pendingApprovals() { return S.approvals.filter(function (a) { return a.status === 'pending'; }); }

function subscribe() {
  var wsId = S.ws.id;
  var ch = S.sb.channel('ws:' + wsId, { config: { presence: { key: me() }, broadcast: { self: false } } });
  function pg(table, filterWs, cb) {
    var o = { event: '*', schema: 'public', table: table };
    if (filterWs) o.filter = 'workspace_id=eq.' + wsId;
    ch.on('postgres_changes', o, cb);
  }
  pg('messages', true, onMessageChange);
  pg('rooms', true, function (p) { upsertList(S.rooms, p); if (p.eventType === 'INSERT') S.unread[p.new.id] = { unread: 0, mentions: 0 }; renderSidebarOnly(); });
  pg('agents', true, function (p) { upsertList(S.agents, p); rerenderSoft(); });
  pg('approvals', true, function (p) { upsertList(S.approvals, p); S.approvals.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }); rerenderSoft(); });
  pg('apps', true, function (p) { if (p.new && p.new.html !== undefined) { var n = Object.assign({}, p.new); delete n.html; p = { eventType: p.eventType, new: n, old: p.old }; } upsertList(S.apps, p); appsChanged(p); });
  pg('automations', true, function (p) { upsertList(S.automations, p); rerenderTab('automations'); });
  pg('automation_runs', true, function (p) { upsertList(S.runs, p); rerenderTab('automations'); });
  pg('files', true, function (p) { upsertList(S.files, p); rerenderTab('files'); });
  pg('workspace_members', true, async function (p) {
    upsertList(S.members, p, ['workspace_id', 'user_id']);
    if (p.eventType === 'INSERT' && !S.profiles[p.new.user_id]) { var r = await S.sb.from('profiles').select('*').eq('id', p.new.user_id).maybeSingle(); if (r.data) S.profiles[r.data.id] = r.data; }
    var mine = S.members.find(function (m) { return m.user_id === me(); });
    if (!mine) { toast('You were removed from this workspace', true); await loadWorkspaces(); S.ws = null; go('', true); location.reload(); return; }
    S.role = mine.role; rerenderSoft();
  });
  pg('app_kv', false, onKvChange);
  ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, function (p) { S.profiles[p.new.id] = p.new; rerenderSoft(); });
  ch.on('presence', { event: 'sync' }, function () {
    var st = ch.presenceState(); S.online = {};
    Object.keys(st).forEach(function (k) { S.online[k] = st[k][0] || true; });
    // self-heal: someone is online that we don't know as a member (missed realtime event) -> refetch
    if (Object.keys(S.online).some(function (k) { return !S.members.some(function (m) { return m.user_id === k; }); })) refreshMembers();
    renderPresenceBits();
  });
  ch.on('broadcast', { event: 'typing' }, function (msg) {
    var p = msg.payload || {}; var key = (p.room_id || '') + '|' + (p.thread_id || '');
    S.typing[key] = S.typing[key] || {}; S.typing[key][p.who] = { name: p.name, at: Date.now(), stop: p.stop };
    if (p.stop) delete S.typing[key][p.who];
    renderTyping();
  });
  ch.subscribe(function (status) {
    if (status === 'SUBSCRIBED' && ch._bhSubscribedOnce) refreshMembers(); // reconnected: catch up on missed member changes
    if (status === 'SUBSCRIBED') ch._bhSubscribedOnce = true;
    if (status === 'SUBSCRIBED') ch.track({ user_id: me(), name: S.profile.display_name, agents: myAgents().map(function (a) { return a.id; }), at: new Date().toISOString() });
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('realtime', status);
  });
  S.chan = ch;
}
function upsertList(list, p, keys) {
  keys = keys || ['id'];
  function same(a, b) { return keys.every(function (k) { return a[k] === b[k]; }); }
  if (p.eventType === 'DELETE') { var i = list.findIndex(function (x) { return same(x, p.old); }); if (i >= 0) list.splice(i, 1); return; }
  var j = list.findIndex(function (x) { return same(x, p.new); });
  if (j >= 0) list[j] = Object.assign(list[j], p.new); else list.push(p.new);
}
function onMessageChange(p) {
  var m = p.new, r = S.route;
  if (p.eventType === 'DELETE') {
    var o = p.old; [S.msgs[o.room_id], S.threadMsgs[o.parent_id]].forEach(function (l) { if (l) { var i = l.findIndex(function (x) { return x.id === o.id; }); if (i >= 0) l.splice(i, 1); } });
    rerenderSoft(); return;
  }
  if (p.eventType === 'UPDATE') {
    [S.msgs[m.room_id], S.threadMsgs[m.parent_id]].forEach(function (l) { if (l) { var x = l.find(function (y) { return y.id === m.id; }); if (x) Object.assign(x, m); } });
    rerenderSoft(); return;
  }
  // INSERT
  indexActivity(m);
  if (m.parent_id) { if (S.threadMsgs[m.parent_id] && !S.threadMsgs[m.parent_id].some(function (x) { return x.id === m.id; })) S.threadMsgs[m.parent_id].push(m); }
  else if (S.msgs[m.room_id] && !S.msgs[m.room_id].some(function (x) { return x.id === m.id; })) S.msgs[m.room_id].push(m);
  var viewing = r.view === 'room' && r.room === m.room_id && document.visibilityState === 'visible';
  if (m.author_id !== me() || m.agent_id) {
    if (viewing) markRead(m.room_id);
    else {
      var u = S.unread[m.room_id] = S.unread[m.room_id] || { unread: 0, mentions: 0 };
      if (!m.parent_id) u.unread++;
      if ((m.mention_users || []).indexOf(me()) >= 0) { u.mentions++; notify(m); }
    }
  }
  // clear typing for that author
  Object.keys(S.typing).forEach(function (k) { delete S.typing[k][m.agent_id || m.author_id]; });
  rerenderSoft(true);
  agentRunner(m);
}
function notify(m) {
  if (document.visibilityState === 'visible' || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification('Bizzle Huddle — ' + (m.agent_id ? (agentOf(m.agent_id) || {}).name : profileOf(m.author_id).display_name), { body: (m.content || '').slice(0, 140), icon: 'icons/icon-192.png' }); } catch (e) {}
}
var readTimers = {};
function markRead(roomId) {
  if (S.unread[roomId]) { S.unread[roomId].unread = 0; S.unread[roomId].mentions = 0; }
  clearTimeout(readTimers[roomId]);
  readTimers[roomId] = setTimeout(function () {
    S.sb.from('room_members').upsert({ room_id: roomId, user_id: me(), last_read_at: new Date().toISOString() }, { onConflict: 'room_id,user_id' }).then(function (r) { if (r.error) console.warn('markRead', r.error.message); });
  }, 400);
}
var lastTypingSent = 0;
function sendTyping(roomId, threadId, stop) {
  if (!S.chan) return;
  if (!stop && Date.now() - lastTypingSent < 1500) return;
  lastTypingSent = stop ? 0 : Date.now();
  S.chan.send({ type: 'broadcast', event: 'typing', payload: { room_id: roomId, thread_id: threadId || '', who: me(), name: S.profile.display_name, stop: !!stop } });
}
function sendAgentThinking(agent, roomId, threadId, stop) {
  if (!S.chan) return;
  S.chan.send({ type: 'broadcast', event: 'typing', payload: { room_id: roomId, thread_id: threadId || '', who: agent.id, name: agent.name + ' (agent)', stop: !!stop, thinking: true } });
  var key = roomId + '|' + (threadId || ''); S.typing[key] = S.typing[key] || {};
  if (stop) delete S.typing[key][agent.id]; else S.typing[key][agent.id] = { name: agent.name + ' (agent)', at: Date.now() };
  renderTyping();
}
setInterval(function () {
  var changed = false; var now = Date.now();
  Object.keys(S.typing).forEach(function (k) { Object.keys(S.typing[k]).forEach(function (w) { var t = S.typing[k][w]; if (now - t.at > (/(agent)/.test(t.name) ? 90000 : 5000)) { delete S.typing[k][w]; changed = true; } }); });
  if (changed) renderTyping();
}, 1500);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.route.view === 'room' && S.route.room) { markRead(S.route.room); renderSidebarOnly(); } });

/* ---------------- render: router + shell ---------------- */
function render() {
  var r = parseRoute(); S.route = r;
  if (!S.sb) { renderConnect(); return; }
  if (r.view === 'connect') { renderConnect(); return; }
  if (!S.user) { renderAuth(); return; }
  if (r.view === 'onboard') { renderOnboard(); return; }
  if (r.view === 'invite-team') { renderInviteTeam(); return; }
  if (!S.ws) { if (!loggingIn) afterLogin(); return; }
  if (r.ws && r.ws !== S.ws.id) {
    if (S.wsList.some(function (w) { return w.id === r.ws; })) { enterWorkspace(r.ws).then(render).catch(function (e) { toast(e.message, true); }); return; }
    go(wsPath(''), true); return;
  }
  if (!r.ws) { go(wsPath(''), true); return; }
  renderShell(r);
}
function phoneView(r) {
  if (r.view === 'home') return 'view-side';
  if (r.thread) return 'view-thread';
  return 'view-main';
}
function renderShell(r) {
  var shell = $('#shell');
  if (!shell) {
    $('#app').innerHTML = '<div class="shell" id="shell"><nav class="rail" id="rail"></nav><aside class="side" id="side"></aside><main class="main" id="main"></main><section class="thread hidden" id="thread"></section></div>' +
      '<nav class="bottomnav" id="bottomnav"></nav><button class="bizzy-fab" id="bizzy-fab" title="Ask Bizzy Bot" aria-label="Ask Bizzy Bot">🐝</button><div id="bizzy-root"></div>';
    shell = $('#shell');
    $('#bizzy-fab').onclick = toggleBizzy;
  }
  shell.className = 'shell ' + phoneView(r) + (r.thread ? ' with-thread' : '');
  renderRail(); renderSidebar(); renderBottomNav();
  var main = $('#main');
  main.setAttribute('data-view', r.view);
  if (r.view !== 'room') main.removeAttribute('data-key');
  if (r.view === 'room') renderRoom(r);
  else if (r.view === 'members') renderMembers();
  else if (r.view === 'usage') renderUsage();
  else if (r.view === 'approvals') renderApprovals();
  else if (r.view === 'settings') renderSettings();
  else if (r.view === 'mentions') { main.innerHTML = '<div class="head">' + backBtn(wsPath('')) + '<h2>@me</h2></div><div class="body" id="mentions-body"></div>'; renderMentionsInto($('#mentions-body')); }
  else renderHomeMain();
  var th = $('#thread');
  if (r.thread) { th.classList.remove('hidden'); renderThread(r); } else { th.classList.add('hidden'); th.innerHTML = ''; th.removeAttribute('data-key'); }
}
function rerenderSoft(newMsg) {
  if (!$('#shell')) return;
  renderRail(); renderSidebarOnly(); renderBottomNav();
  var r = S.route;
  if (r.view === 'room') {
    if (r.tab === 'chat' || !r.tab) renderMsgList();
    else if (r.tab === 'apps') renderAppsTab(roomOf(r.room));
  }
  if (r.thread) renderThreadList();
  if (r.view === 'approvals') renderApprovals();
  if (r.view === 'members' && !$('.modal-wrap')) renderMembers();
}
function rerenderTab(tab) { if (S.route.view === 'room' && S.route.tab === tab) { var room = roomOf(S.route.room); if (tab === 'automations') renderAutomationsTab(room); if (tab === 'files') renderFilesTab(room); } }
function renderSidebarOnly() { if ($('#side')) renderSidebar(true); }
var refreshingMembers = null;
function refreshMembers() {
  if (refreshingMembers || !S.ws) return refreshingMembers;
  var wsId = S.ws.id;
  refreshingMembers = (async function () {
    try {
      var r = await S.sb.from('workspace_members').select('*').eq('workspace_id', wsId);
      if (r.error || !S.ws || S.ws.id !== wsId) return;
      S.members = r.data;
      var missing = S.members.map(function (m) { return m.user_id; }).filter(function (id) { return !S.profiles[id]; });
      if (missing.length) { var pr = await S.sb.from('profiles').select('*').in('id', missing); (pr.data || []).forEach(function (p) { S.profiles[p.id] = p; }); }
      rerenderSoft(); renderPresenceBits();
    } finally { setTimeout(function () { refreshingMembers = null; }, 3000); }
  })();
  return refreshingMembers;
}
function renderPresenceBits() { if (!$('#shell')) return; renderSidebarOnly(); if (S.route.view === 'members' && !$('.modal-wrap')) renderMembers(); $$('[data-online-for]').forEach(function (d) { d.classList.toggle('on', !!S.online[d.getAttribute('data-online-for')]); }); }

function renderRail() {
  var r = S.route, pa = pendingApprovals().length, un = totalUnread();
  $('#rail').innerHTML =
    '<button class="ws" id="ws-switch" title="' + esc(S.ws.name) + ' — switch workspace">' + esc((S.ws.name || '?').trim().charAt(0).toUpperCase()) + '</button>' +
    '<button class="ri ' + ((r.view === 'home' || r.view === 'room') ? 'on' : '') + '" data-go="' + wsPath('') + '" title="Chat">💬' + (un ? '<span class="badge">' + un + '</span>' : '') + '</button>' +
    '<button class="ri ' + (r.view === 'members' ? 'on' : '') + '" data-go="' + wsPath('members') + '" title="Members & agents">👥</button>' +
    '<button class="ri ' + (r.view === 'approvals' ? 'on' : '') + '" data-go="' + wsPath('approvals') + '" title="Approvals">✅' + (pa ? '<span class="badge">' + pa + '</span>' : '') + '</button>' +
    '<button class="ri ' + (r.view === 'usage' ? 'on' : '') + '" data-go="' + wsPath('usage') + '" title="Usage">📊</button>' +
    '<button class="ri" id="rail-ai" title="Advanced AI Settings">🧠</button>' +
    '<div class="sp"></div>' +
    '<button class="ri ' + (r.view === 'settings' ? 'on' : '') + '" data-go="' + wsPath('settings') + '" title="Settings">' + avatarHtml(S.profile.avatar, 'sm') + '</button>' +
    '<div class="ver v420">v4.20</div>';
  $('#ws-switch').onclick = openWorkspaceMenu;
  $('#rail-ai').onclick = openAISettings;
}
function renderBottomNav() {
  var r = S.route, pa = pendingApprovals().length, un = totalUnread();
  $('#bottomnav').innerHTML =
    '<button class="' + ((r.view === 'home' || r.view === 'room') ? 'on' : '') + '" data-go="' + wsPath('') + '">💬<span>Chat</span>' + (un ? '<i class="badge">' + un + '</i>' : '') + '</button>' +
    '<button class="' + (r.view === 'members' ? 'on' : '') + '" data-go="' + wsPath('members') + '">👥<span>Members</span></button>' +
    '<button class="' + (r.view === 'approvals' ? 'on' : '') + '" data-go="' + wsPath('approvals') + '">✅<span>Approvals</span>' + (pa ? '<i class="badge">' + pa + '</i>' : '') + '</button>' +
    '<button class="' + (r.view === 'usage' ? 'on' : '') + '" data-go="' + wsPath('usage') + '">📊<span>Usage</span></button>' +
    '<button class="' + (r.view === 'settings' ? 'on' : '') + '" data-go="' + wsPath('settings') + '">⚙️<span>Settings</span></button>';
}

function roomItem(room, active) {
  var u = S.unread[room.id] || { unread: 0, mentions: 0 };
  return '<button class="item ' + (active ? 'on ' : '') + (u.unread ? 'unread' : '') + '" data-go="' + wsPath('r/' + room.id) + '" data-room="' + room.id + '">' +
    '<span>' + (room.is_private ? '🔒' : '#') + '</span><span class="nm">' + esc(room.name) + '</span>' +
    (u.mentions ? '<span class="badge at">@' + u.mentions + '</span>' : '') + (u.unread ? '<span class="badge">' + u.unread + '</span>' : '') + '</button>';
}
function threadTitle(id) {
  var all = [];
  Object.keys(S.msgs).forEach(function (k) { all = all.concat(S.msgs[k]); });
  var m = all.find(function (x) { return x.id === id; }) || threadRootCache[id];
  return m ? (m.content || 'Attachment').replace(/[*`#]/g, '').slice(0, 60) : 'Thread';
}
var threadRootCache = {};
function renderSidebar(soft) {
  var side = $('#side'), r = S.route, tab = S.sideTab;
  var searchVal = $('#side-search') ? $('#side-search').value : '';
  if (soft && document.activeElement && document.activeElement.id === 'side-search') { renderSideList(); return; }
  side.innerHTML =
    '<div class="side-head">' + (isPhone() ? '<button class="ws" style="width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:var(--accent-ink);font-weight:900" id="ws-switch2">' + esc((S.ws.name || '?').charAt(0).toUpperCase()) + '</button>' : '') +
    '<h3>' + esc(S.ws.name) + '</h3><span class="v420 small">v4.20</span><button class="btn sm" id="new-room" title="New room">＋</button></div>' +
    '<div class="search"><input id="side-search" placeholder="🔎 Search messages" value="' + esc(searchVal) + '"></div>' +
    '<div class="tabs" id="side-tabs">' + ['home', 'recent', 'unread', 'me'].map(function (t) { return '<button data-t="' + t + '" class="' + (tab === t ? 'on' : '') + '">' + ({ home: 'Home', recent: 'Recent', unread: 'Unread', me: '@me' })[t] + '</button>'; }).join('') + '</div>' +
    '<div class="side-scroll" id="side-list"></div>';
  $('#new-room').onclick = openNewRoom;
  if ($('#ws-switch2')) $('#ws-switch2').onclick = openWorkspaceMenu;
  $$('#side-tabs button').forEach(function (b) { b.onclick = function () { S.sideTab = b.getAttribute('data-t'); renderSidebar(); }; });
  $('#side-search').addEventListener('input', debounce(function () { renderSideList(); }, 300));
  renderSideList();
}
async function renderSideList() {
  var el = $('#side-list'); if (!el) return;
  var r = S.route, tab = S.sideTab, q = ($('#side-search') || {}).value || '';
  if (q.trim().length >= 2) {
    el.innerHTML = '<div class="muted small" style="padding:8px">Searching…</div>';
    var res = await S.sb.from('messages').select('id,room_id,parent_id,content,created_at,author_id,agent_id').eq('workspace_id', S.ws.id).ilike('content', '%' + q.trim().replace(/[%_]/g, '') + '%').order('created_at', { ascending: false }).limit(30);
    el.innerHTML = '<div class="sec">Results</div>' + ((res.data || []).map(function (m) {
      var room = roomOf(m.room_id); var path = m.parent_id ? 'r/' + m.room_id + '/t/' + m.parent_id : 'r/' + m.room_id;
      return '<button class="item" data-go="' + wsPath(path) + '"><span>' + (room && room.is_private ? '🔒' : '#') + '</span><span class="nm"><b>' + esc(room ? room.name : '') + '</b> · ' + esc((m.content || '').slice(0, 70)) + '</span></button>';
    }).join('') || '<div class="empty small">No matches</div>');
    return;
  }
  var html = '';
  if (tab === 'home') {
    html += '<div class="sec"><span>Rooms</span></div>';
    S.rooms.forEach(function (room) {
      html += roomItem(room, r.room === room.id);
      if (r.room === room.id) {
        var th = S.threadsByRoom[room.id] ? Object.keys(S.threadsByRoom[room.id]).map(function (k) { return S.threadsByRoom[room.id][k]; }) : [];
        th.sort(function (a, b) { return a.last < b.last ? 1 : -1; }).slice(0, 6).forEach(function (t) {
          html += '<button class="item thread ' + (r.thread === t.id ? 'on' : '') + '" data-go="' + wsPath('r/' + room.id + '/t/' + t.id) + '">🧵 <span class="nm">' + esc(threadTitle(t.id)) + '</span><span class="tiny">' + ago(t.last) + '</span></button>';
        });
      }
    });
    if (!S.rooms.length) html += '<div class="empty small">No rooms yet</div>';
    html += '<div class="sec"><span>Agents</span><button class="btn sm" id="side-new-agent">＋</button></div>';
    S.agents.forEach(function (a) {
      html += '<button class="item" data-agent="' + a.id + '">' + avatarHtml(a.avatar, 'sm agent') + '<span class="nm">' + esc(a.name) + (a.is_private ? ' 🔒' : '') + '</span><span class="dot ' + (agentOnline(a) ? 'on' : '') + '" title="' + (agentOnline(a) ? 'Online (owner\'s app is open)' : 'Offline (owner\'s app is closed)') + '"></span></button>';
    });
    if (!S.agents.length) html += '<div class="muted small" style="padding:4px 10px">No agents yet. Tap ＋ to create one.</div>';
    html += '<div class="sec"><span>People</span></div>';
    S.members.forEach(function (m) {
      var p = profileOf(m.user_id);
      html += '<div class="item">' + avatarHtml(p.avatar, 'sm') + '<span class="nm">' + esc(p.display_name) + (m.user_id === me() ? ' (you)' : '') + '</span><span class="dot ' + (S.online[m.user_id] ? 'on' : '') + '" data-online-for="' + m.user_id + '"></span></div>';
    });
  } else if (tab === 'recent') {
    var items = S.rooms.map(function (room) { return { t: S.lastActivity[room.id] || room.created_at, html: roomItem(room, r.room === room.id && !r.thread) }; });
    Object.keys(S.threadsByRoom).forEach(function (rid) {
      var room = roomOf(rid); if (!room) return;
      Object.keys(S.threadsByRoom[rid]).forEach(function (k) {
        var t = S.threadsByRoom[rid][k];
        items.push({ t: t.last, html: '<button class="item ' + (r.thread === t.id ? 'on' : '') + '" data-go="' + wsPath('r/' + rid + '/t/' + t.id) + '">🧵<span class="nm">' + esc(threadTitle(t.id)) + ' <span class="muted small">in #' + esc(room.name) + '</span></span><span class="tiny">' + ago(t.last) + '</span></button>' });
      });
    });
    items.sort(function (a, b) { return a.t < b.t ? 1 : -1; });
    html += '<div class="sec">Recent activity</div>' + items.slice(0, 40).map(function (i) { return i.html; }).join('');
  } else if (tab === 'unread') {
    var un = S.rooms.filter(function (room) { var u = S.unread[room.id]; return u && (u.unread || u.mentions); });
    html += '<div class="sec">Unread</div>' + (un.map(function (room) { return roomItem(room, r.room === room.id); }).join('') || '<div class="empty">All caught up ✨</div>');
  } else {
    html += '<div class="sec">Mentions of you</div><div id="side-mentions"><div class="muted small" style="padding:8px">Loading…</div></div>';
  }
  el.innerHTML = html;
  if ($('#side-new-agent')) $('#side-new-agent').onclick = function () { openAgentDialog(); };
  $$('[data-agent]', el).forEach(function (b) { b.onclick = function () { openAgentProfile(b.getAttribute('data-agent')); }; });
  if (tab === 'me') renderMentionsInto($('#side-mentions'), true);
}
async function renderMentionsInto(el, compact) {
  var res = await S.sb.from('messages').select('*').eq('workspace_id', S.ws.id).contains('mention_users', [me()]).order('created_at', { ascending: false }).limit(40);
  if (!el) return;
  var list = res.data || [];
  el.innerHTML = list.map(function (m) {
    var room = roomOf(m.room_id); var path = m.parent_id ? 'r/' + m.room_id + '/t/' + m.parent_id : 'r/' + m.room_id;
    var who = m.agent_id ? (agentOf(m.agent_id) || {}).name : profileOf(m.author_id).display_name;
    return '<button class="item" style="align-items:flex-start" data-go="' + wsPath(path) + '"><span>@</span><span class="nm" style="white-space:normal"><b>' + esc(who || 'Someone') + '</b> <span class="muted small">#' + esc(room ? room.name : '?') + ' · ' + ago(m.created_at) + '</span><br><span class="small">' + esc((m.content || '').slice(0, compact ? 90 : 300)) + '</span></span></button>';
  }).join('') || '<div class="empty">Nobody has @mentioned you yet.</div>';
}

function renderHomeMain() {
  var main = $('#main');
  var first = S.rooms.find(function (r) { return r.name === 'welcome'; }) || S.rooms[0];
  main.innerHTML = '<div class="head">' + backBtn('', '') + '<div class="grow"><h2>' + esc(S.ws.name) + '</h2><div class="sub">' + S.members.length + ' people · ' + S.agents.length + ' agents · ' + S.rooms.length + ' rooms</div></div></div>' +
    '<div class="body"><div style="max-width:640px;margin:6vh auto 0"><h1 style="font-size:28px;margin:0 0 6px">What should we work on?</h1><p class="muted">Post to a room and @mention an agent to get it working. <span class="v420">v4.20</span></p>' +
    '<label>Room</label><select id="hw-room">' + S.rooms.map(function (r) { return '<option value="' + r.id + '"' + (first && r.id === first.id ? ' selected' : '') + '>' + (r.is_private ? '🔒 ' : '# ') + esc(r.name) + '</option>'; }).join('') + '</select>' +
    '<label>Message</label><div class="cbox"><textarea id="hw-text" rows="3" placeholder="e.g. @Researcher summarize today\'s AI news"></textarea></div>' +
    '<div class="row" style="margin-top:10px"><button class="btn primary" id="hw-send">Send ➤</button><button class="btn" id="hw-room-new">＋ New room</button><button class="btn" id="hw-agent">🤖 New agent</button></div>' +
    '<div class="card" style="margin-top:22px"><b>Invite your team</b>' + inviteBox(inviteLink()) + '</div></div></div>';
  bindInviteBox();
  $('#hw-room-new').onclick = openNewRoom; $('#hw-agent').onclick = function () { openAgentDialog(); };
  $('#hw-send').onclick = async function () {
    var rid = $('#hw-room').value, t = $('#hw-text').value; if (!rid || !t.trim()) return;
    var m = await sendMessage(rid, null, t, []); if (m) go(wsPath('r/' + rid));
  };
  // the generic back on home goes to the workspace switcher
  $('.head .back', main).onclick = function (e) { e.stopPropagation(); e.preventDefault(); if (canBack()) history.back(); else openWorkspaceMenu(); };
}

/* ---------------- room view ---------------- */
function roomMemberCount(room) { return room.is_private ? (room._memberCount || '…') : S.members.length; }
function renderRoom(r) {
  var main = $('#main'); var room = roomOf(r.room);
  if (!room) { main.innerHTML = '<div class="head">' + backBtn(wsPath('')) + '<h2>Room not found</h2></div><div class="empty">This room doesn\'t exist or you don\'t have access.</div>'; return; }
  var tab = r.tab || 'chat';
  var key = room.id + ':' + tab;
  if (main.getAttribute('data-key') !== key) {
    main.setAttribute('data-key', key);
    main.innerHTML = '<div class="head stack">' + backBtn(wsPath('')) +
      '<div class="grow" style="min-width:0"><h2>' + (room.is_private ? '🔒 ' : '# ') + esc(room.name) + '</h2><div class="sub">' + esc(room.topic || '') + '</div></div>' +
      '<button class="btn sm" id="room-members" title="Room members">👥 <span id="room-mc">' + roomMemberCount(room) + '</span></button>' +
      '<div class="tabs">' + ['chat', 'apps', 'automations', 'files'].map(function (t) {
        return '<button class="' + (tab === t ? 'on' : '') + '" data-go="' + wsPath('r/' + room.id + (t === 'chat' ? '' : '/' + t)) + '">' + ({ chat: '💬 Chat', apps: '🧩 Apps', automations: '⏰ Automations', files: '📁 Files' })[t] + '</button>';
      }).join('') + '</div></div><div id="room-body" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>';
    $('#room-members').onclick = function () { openRoomMembers(room); };
    var body = $('#room-body');
    if (tab === 'chat') {
      body.innerHTML = '<div class="msgs" id="msgs"><div class="empty">Loading…</div></div><div class="typing" id="typing-main"></div>' + composerHtml('main', 'Message #' + room.name + ' — @mention people or agents');
      bindComposer('main', room.id, null);
      loadRoomMessages(room.id).then(function () { renderMsgList(true); });
    } else if (tab === 'apps') renderAppsTab(room);
    else if (tab === 'automations') renderAutomationsTab(room);
    else if (tab === 'files') renderFilesTab(room);
    if (room.is_private) S.sb.from('room_members').select('user_id', { count: 'exact', head: true }).eq('room_id', room.id).then(function (x) { room._memberCount = x.count; var el = $('#room-mc'); if (el) el.textContent = x.count; });
  } else if (tab === 'chat') renderMsgList();
  markRead(room.id);
}
async function loadRoomMessages(roomId, force) {
  if (S.msgs[roomId] && !force) return;
  var r = await S.sb.from('messages').select('*').eq('room_id', roomId).is('parent_id', null).order('created_at', { ascending: false }).limit(80);
  if (r.error) { toast(r.error.message, true); S.msgs[roomId] = []; return; }
  S.msgs[roomId] = r.data.reverse();
  var ids = S.msgs[roomId].map(function (m) { return m.id; });
  if (ids.length) {
    var c = await S.sb.from('messages').select('parent_id').in('parent_id', ids).limit(2000);
    var counts = {}; (c.data || []).forEach(function (x) { counts[x.parent_id] = (counts[x.parent_id] || 0) + 1; });
    ids.forEach(function (id) { if (counts[id]) S.replyCounts[id] = counts[id]; });
  }
}
function msgHtml(m, inThread) {
  var ag = m.agent_id ? agentOf(m.agent_id) : null;
  var au = profileOf(m.author_id);
  var name = ag ? ag.name : (m.agent_id ? 'Agent (private)' : au.display_name);
  var av = ag ? ag.avatar : (m.agent_id ? '🤖' : au.avatar);
  var tags = '';
  if (m.agent_id) tags += '<span class="pill green">AI</span>' + (ag && ag.specialty ? '<span class="muted small">' + esc(ag.specialty) + '</span>' : '') + '<span class="tiny muted">via ' + esc(au.display_name) + '</span>';
  if (m.hop > 0) tags += '<span class="pill" title="agent-to-agent hop">↪ hop ' + m.hop + '</span>';
  if (m.meta && m.meta.automation_id) tags += '<span class="pill warn">⏰ automation</span>';
  if (m.meta && m.meta.approved_by) tags += '<span class="pill">✅ approved by ' + esc(profileOf(m.meta.approved_by).display_name) + '</span>';
  if (m.meta && m.meta.error) tags += '<span class="pill red">error</span>';
  var canDel = m.author_id === me() || isAdmin();
  var att = (m.attachments || []).map(function (a) {
    if (/^image\//.test(a.mime || '')) return '<img data-path="' + esc(a.path) + '" alt="' + esc(a.name) + '" loading="lazy">';
    return '<a class="file" href="#" data-dl="' + esc(a.path) + '" data-name="' + esc(a.name) + '">📎 ' + esc(a.name) + ' <span class="muted tiny">' + fmtBytes(a.size) + '</span></a>';
  }).join('');
  var rc = S.replyCounts[m.id];
  return '<div class="msg ' + (m.agent_id ? 'agentmsg' : '') + '" data-mid="' + m.id + '">' +
    avatarHtml(av, m.agent_id ? 'agent' : '') +
    '<div class="mb"><div class="mh"><b>' + esc(name) + '</b>' + tags + '<span class="t" title="' + esc(new Date(m.created_at).toLocaleString()) + '">' + fmtTime(m.created_at) + '</span></div>' +
    '<div class="mt">' + md(m.content, { names: mentionNames(), me: S.profile.display_name }) + '</div>' +
    (att ? '<div class="att">' + att + '</div>' : '') +
    (m.agent_id ? '<button class="copybtn" data-copy="' + m.id + '">📋 Copy</button>' : '') +
    (!inThread && rc ? '<div><button class="replies" data-go="' + wsPath('r/' + m.room_id + '/t/' + m.id) + '">🧵 ' + rc + ' repl' + (rc === 1 ? 'y' : 'ies') + '</button></div>' : '') +
    '</div><div class="acts">' + (!inThread ? '<button data-go="' + wsPath('r/' + m.room_id + '/t/' + m.id) + '" title="Reply in thread">🧵</button>' : '') +
    '<button data-copy="' + m.id + '" title="Copy">📋</button>' + (canDel ? '<button data-del="' + m.id + '" title="Delete">🗑️</button>' : '') + '</div></div>';
}
function msgListHtml(list, inThread) {
  var html = '', lastDay = '';
  list.forEach(function (m) { var d = fmtDay(m.created_at); if (d !== lastDay) { html += '<div class="daysep">' + d + '</div>'; lastDay = d; } html += msgHtml(m, inThread); });
  return html;
}
function findMsg(id) {
  var all = []; Object.keys(S.msgs).forEach(function (k) { all = all.concat(S.msgs[k]); }); Object.keys(S.threadMsgs).forEach(function (k) { all = all.concat(S.threadMsgs[k]); });
  return all.find(function (x) { return x.id === id; }) || threadRootCache[id];
}
function bindMsgActions(el) {
  $$('[data-copy]', el).forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var m = findMsg(b.getAttribute('data-copy')); if (m) copyText(m.content); }; });
  $$('[data-del]', el).forEach(function (b) { b.onclick = async function (e) { e.stopPropagation(); if (!confirm('Delete this message?')) return; var r = await S.sb.from('messages').delete().eq('id', b.getAttribute('data-del')); if (r.error) toast(r.error.message, true); }; });
  $$('[data-dl]', el).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); downloadPath(a.getAttribute('data-dl'), a.getAttribute('data-name')); }; });
  $$('img[data-path]', el).forEach(function (img) { img.onclick = function () { if (img.src) window.open(img.src, '_blank'); }; });
  hydrateImages(el);
}
function renderMsgList(forceBottom) {
  var el = $('#msgs'); if (!el) return; var rid = S.route.room; var list = S.msgs[rid]; if (!list) return;
  var nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  el.innerHTML = list.length ? msgListHtml(list, false) : '<div class="empty">No messages yet. Say hi 👋 or @mention an agent.</div>';
  bindMsgActions(el);
  if (forceBottom || nearBottom) el.scrollTop = el.scrollHeight;
  renderTyping();
}
async function hydrateImages(el) {
  var imgs = $$('img[data-path]', el).filter(function (i) { return !i.getAttribute('src'); });
  if (!imgs.length) return;
  var need = imgs.map(function (i) { return i.getAttribute('data-path'); }).filter(function (p) { return !S.signed[p] || S.signed[p].exp < Date.now(); });
  need = need.filter(function (p, i) { return need.indexOf(p) === i; });
  if (need.length) {
    var r = await S.sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    (r.data || []).forEach(function (x) { if (x.signedUrl) S.signed[x.path] = { url: x.signedUrl, exp: Date.now() + 3500e3 }; });
  }
  imgs.forEach(function (i) { var s = S.signed[i.getAttribute('data-path')]; if (s) i.src = s.url; });
}
async function downloadPath(path, name) {
  var r = await S.sb.storage.from(BUCKET).createSignedUrl(path, 120, { download: name || true });
  if (r.error) { toast(r.error.message, true); return; }
  var a = document.createElement('a'); a.href = r.data.signedUrl; a.download = name || ''; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
}
function renderTyping() {
  var r = S.route;
  [['typing-main', r.room + '|'], ['typing-thread', r.room + '|' + (r.thread || '')]].forEach(function (p) {
    var el = $('#' + p[0]); if (!el) return;
    var t = S.typing[p[1]] || {}; var names = Object.keys(t).filter(function (k) { return k !== me(); }).map(function (k) { return t[k].name; });
    el.textContent = names.length ? (names.join(', ') + (names.length > 1 ? ' are' : ' is') + (names.some(function (n) { return /\(agent\)/.test(n); }) ? ' thinking…' : ' typing…')) : '';
  });
}

/* ---------------- composer ---------------- */
function composerHtml(id, ph) {
  return '<div class="composer"><div class="cbox" id="cbox-' + id + '"><div class="pending" id="pend-' + id + '"></div>' +
    '<textarea id="ta-' + id + '" rows="1" placeholder="' + esc(ph) + '"></textarea>' +
    '<div class="cbar"><button class="ib" id="att-' + id + '" title="Attach file">📎</button><button class="ib" id="img-' + id + '" title="Screenshot / image for AI help">🖼️</button><button class="ib" id="at-' + id + '" title="Mention">@</button><span class="grow"></span><span class="tiny muted">Enter ↵ send · Shift+Enter newline</span><button class="send" id="send-' + id + '" title="Send">➤</button></div>' +
    '<input type="file" id="fi-' + id + '" multiple class="hidden"><input type="file" id="ii-' + id + '" accept="image/*" multiple class="hidden"></div></div>';
}
function bindComposer(id, roomId, threadId) {
  var ta = $('#ta-' + id), pending = [];
  function renderPending() {
    $('#pend-' + id).innerHTML = pending.map(function (f, i) { return '<div class="pf">' + (f.preview ? '<img src="' + f.preview + '">' : '📎') + esc(f.file.name.slice(0, 24)) + '<button data-rm="' + i + '">✕</button></div>'; }).join('');
    $$('#pend-' + id + ' [data-rm]').forEach(function (b) { b.onclick = function () { pending.splice(+b.getAttribute('data-rm'), 1); renderPending(); }; });
  }
  function addFiles(files) { Array.prototype.forEach.call(files, function (f) { if (f.size > 50 * 1048576) { toast(f.name + ' is over 50 MB', true); return; } pending.push({ file: f, preview: /^image\//.test(f.type) ? URL.createObjectURL(f) : null }); }); renderPending(); }
  $('#att-' + id).onclick = function () { $('#fi-' + id).click(); };
  $('#img-' + id).onclick = function () { $('#ii-' + id).click(); };
  $('#fi-' + id).onchange = function () { addFiles(this.files); this.value = ''; };
  $('#ii-' + id).onchange = function () { addFiles(this.files); this.value = ''; };
  ta.addEventListener('paste', function (e) { var items = (e.clipboardData && e.clipboardData.files) || []; if (items.length) { e.preventDefault(); addFiles(items); } });
  $('#at-' + id).onclick = function () { insertAtCursor(ta, '@'); ta.focus(); showMentionPop(id, ta); };
  async function send() {
    var text = ta.value; if (!text.trim() && !pending.length) return;
    var files = pending.map(function (p) { return p.file; });
    ta.value = ''; pending = []; renderPending(); autosize(ta); hideMentionPop(id);
    sendTyping(roomId, threadId, true);
    var m = await sendMessage(roomId, threadId, text, files);
    if (!m) { ta.value = text; autosize(ta); }
  }
  $('#send-' + id).onclick = send;
  ta.addEventListener('keydown', function (e) {
    var pop = $('#mpop-' + id);
    if (pop && !pop.classList.contains('hidden')) {
      var btns = $$('button', pop), cur = btns.findIndex(function (b) { return b.classList.contains('on'); });
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (btns.length) { if (cur >= 0) btns[cur].classList.remove('on'); cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length; btns[cur].classList.add('on'); } return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && btns.length) { e.preventDefault(); (btns[cur] || btns[0]).click(); return; }
      if (e.key === 'Escape') { hideMentionPop(id); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  ta.addEventListener('input', function () { autosize(ta); sendTyping(roomId, threadId); showMentionPop(id, ta); });
}
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px'; }
function insertAtCursor(ta, s) { var a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + s + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + s.length; }
function mentionCandidates() {
  return S.agents.map(function (a) { return { name: a.name, av: a.avatar, kind: 'agent', on: agentOnline(a) }; })
    .concat(S.members.map(function (m) { var p = profileOf(m.user_id); return { name: p.display_name, av: p.avatar, kind: 'person', on: !!S.online[m.user_id] }; }));
}
function showMentionPop(id, ta) {
  var before = ta.value.slice(0, ta.selectionStart); var m = before.match(/(^|\s)@([^\s@]{0,30})$/);
  if (!m) { hideMentionPop(id); return; }
  var q = m[2].toLowerCase();
  var list = mentionCandidates().filter(function (c) { return c.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 8);
  var pop = $('#mpop-' + id);
  if (!pop) { pop = document.createElement('div'); pop.className = 'mpop'; pop.id = 'mpop-' + id; $('#cbox-' + id).appendChild(pop); }
  if (!list.length) { pop.classList.add('hidden'); return; }
  pop.classList.remove('hidden');
  pop.innerHTML = list.map(function (c, i) { return '<button class="' + (i === 0 ? 'on' : '') + '" data-name="' + esc(c.name) + '">' + avatarHtml(c.av, 'sm' + (c.kind === 'agent' ? ' agent' : '')) + '<span class="grow">' + esc(c.name) + '</span><span class="pill">' + c.kind + '</span><span class="dot ' + (c.on ? 'on' : '') + '"></span></button>'; }).join('');
  $$('button', pop).forEach(function (b) {
    b.onmousedown = function (e) { e.preventDefault(); };
    b.onclick = function () {
      var name = b.getAttribute('data-name'); var pos = ta.selectionStart; var start = ta.value.slice(0, pos).lastIndexOf('@');
      ta.value = ta.value.slice(0, start) + '@' + name + ' ' + ta.value.slice(pos); ta.selectionStart = ta.selectionEnd = start + name.length + 2; hideMentionPop(id); ta.focus();
    };
  });
}
function hideMentionPop(id) { var p = $('#mpop-' + id); if (p) p.classList.add('hidden'); }

function parseMentions(text, excludeAgentId) {
  var users = [], agents = [];
  var t = ' ' + String(text || '').toLowerCase();
  function has(name) { var n = name.toLowerCase(); var i = -1; while ((i = t.indexOf('@' + n, i + 1)) >= 0) { var nx = t.charAt(i + n.length + 1); if (!/[a-z0-9_]/.test(nx)) return true; } return false; }
  S.agents.forEach(function (a) { if (a.id !== excludeAgentId && has(a.name)) agents.push(a.id); });
  S.members.forEach(function (m) { if (has(profileOf(m.user_id).display_name)) users.push(m.user_id); });
  return { users: users, agents: agents };
}
async function uploadFiles(roomId, files) {
  var out = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
    var path = S.ws.id + '/' + roomId + '/' + uid() + '-' + safe;
    var up = await S.sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
    if (up.error) { toast('Upload failed: ' + up.error.message, true); continue; }
    await S.sb.from('files').insert({ workspace_id: S.ws.id, room_id: roomId, path: path, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, uploaded_by: me() });
    out.push({ path: path, name: f.name, mime: f.type || 'application/octet-stream', size: f.size });
  }
  return out;
}
async function sendMessage(roomId, threadId, text, files) {
  try {
    var att = files && files.length ? await uploadFiles(roomId, files) : [];
    if (!String(text || '').trim() && !att.length) return null;
    var mn = parseMentions(text);
    var row = { workspace_id: S.ws.id, room_id: roomId, parent_id: threadId || null, author_id: me(), content: String(text || '').trim(), mention_users: mn.users, mention_agents: mn.agents, attachments: att };
    var r = await S.sb.from('messages').insert(row).select().single();
    if (r.error) throw r.error;
    onMessageChange({ eventType: 'INSERT', new: r.data });
    return r.data;
  } catch (e) { toast('Send failed: ' + (e.message || e), true); return null; }
}

/* ---------------- thread pane ---------------- */
async function renderThread(r) {
  var th = $('#thread'); var room = roomOf(r.room);
  var key = r.thread;
  if (th.getAttribute('data-key') !== key) {
    th.setAttribute('data-key', key);
    th.innerHTML = '<div class="head">' + backBtn(wsPath('r/' + r.room), '') + '<div class="grow"><h2>🧵 Thread</h2><div class="sub">' + (room ? (room.is_private ? '🔒 ' : '# ') + esc(room.name) : '') + '</div></div><button class="btn sm" id="th-copy-link" title="Copy link">🔗</button></div>' +
      '<div class="msgs" id="tmsgs"><div class="empty">Loading…</div></div><div class="typing" id="typing-thread"></div>' + composerHtml('thread', 'Reply in thread…');
    bindComposer('thread', r.room, r.thread);
    $('#th-copy-link').onclick = function () { copyText(location.href); };
    var root = findMsg(r.thread);
    if (!root) { var x = await S.sb.from('messages').select('*').eq('id', r.thread).maybeSingle(); root = x.data; }
    if (root) threadRootCache[root.id] = root;
    var rep = await S.sb.from('messages').select('*').eq('parent_id', r.thread).order('created_at').limit(500);
    S.threadMsgs[r.thread] = rep.data || [];
  }
  renderThreadList(true);
}
function renderThreadList(force) {
  var el = $('#tmsgs'); var id = S.route.thread; if (!el || !id) return;
  var root = threadRootCache[id] || findMsg(id); var list = S.threadMsgs[id]; if (!list) return;
  var near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  el.innerHTML = (root ? msgHtml(root, true) + '<div class="daysep">' + list.length + ' repl' + (list.length === 1 ? 'y' : 'ies') + '</div>' : '<div class="empty">Thread starter was deleted.</div>') + list.map(function (m) { return msgHtml(m, true); }).join('');
  bindMsgActions(el);
  if (force || near) el.scrollTop = el.scrollHeight;
  renderTyping();
}

/* ---------------- AI agents: runner (runs on the agent OWNER's open app) ---------------- */
var handled = {};
function rateOk(agentId) {
  var now = Date.now(), rt = lsGet(LS.rate, {}), all = 0;
  Object.keys(rt).forEach(function (k) { rt[k] = (rt[k] || []).filter(function (t) { return now - t < 60000; }); all += rt[k].length; });
  var a = rt[agentId] || [];
  if (a.length >= RATE_PER_AGENT_MIN || all >= RATE_PER_OWNER_MIN) { lsSet(LS.rate, rt); return false; }
  a.push(now); rt[agentId] = a; lsSet(LS.rate, rt); return true;
}
function agentRunner(m) {
  if (!m || !S.ws || m.workspace_id !== S.ws.id) return;
  if (Date.now() - new Date(m.created_at).getTime() > 10 * 60000) return;   // only fresh work
  (m.mention_agents || []).forEach(function (aid) {
    var ag = agentOf(aid);
    if (ag && ag.owner_id === me() && m.agent_id !== aid) runAgent(ag, m);
  });
}
async function catchUpAgentJobs() {
  var ids = myAgents().map(function (a) { return a.id; }); if (!ids.length) return;
  var since = new Date(Date.now() - 10 * 60000).toISOString();
  var r = await S.sb.from('messages').select('*').eq('workspace_id', S.ws.id).overlaps('mention_agents', ids).gte('created_at', since).order('created_at').limit(20);
  (r.data || []).forEach(agentRunner);
}
function logUsage(o) {
  var row = Object.assign({ workspace_id: S.ws.id, user_id: me(), kind: 'chat', prompt_tokens: 0, completion_tokens: 0, estimated: false, ok: true }, o);
  return S.sb.from('usage_events').insert(row).then(function (r) { if (r.error) console.warn('usage', r.error.message); });
}
async function runAgent(ag, m) {
  var key = m.id + ':' + ag.id; if (handled[key]) return; handled[key] = 1;
  if ((m.hop || 0) >= MAX_HOPS) { console.info('hop limit reached for', ag.name); return; }
  var c = await S.sb.rpc('claim_agent_job', { p_message: m.id, p_agent: ag.id });
  if (c.error || !c.data) return;                      // another device of mine already took it
  if (!rateOk(ag.id)) {
    await S.sb.from('messages').insert({ workspace_id: S.ws.id, room_id: m.room_id, parent_id: m.parent_id, author_id: me(), agent_id: ag.id, hop: Math.min(10, (m.hop || 0) + 1), content: '⏳ Rate limit: I answer at most ' + RATE_PER_AGENT_MIN + ' times per minute (owner limit ' + RATE_PER_OWNER_MIN + '/min). Try again in a moment.', meta: { reply_to: m.id, rate_limited: true } });
    return;
  }
  sendAgentThinking(ag, m.room_id, m.parent_id, false);
  var st = AI.getSettings();
  try {
    if (m.meta && m.meta.app_request) { await buildApp(ag, m); return; }
    var ctx = await buildContext(ag, m);
    var res = await AI.chat({ provider: ag.provider, model: ag.model || null, effort: ag.effort, system: ctx.system, messages: ctx.messages, temperature: st.temperature, maxTokens: st.maxTokens });
    await postAgentReply(ag, m, res.text || '(no reply)', res, m.meta && m.meta.automation_id ? 'automation' : 'chat');
  } catch (e) {
    console.warn('agent error', e);
    await S.sb.from('messages').insert({ workspace_id: S.ws.id, room_id: m.room_id, parent_id: m.parent_id, author_id: me(), agent_id: ag.id, hop: Math.min(10, (m.hop || 0) + 1), content: '⚠️ I couldn\'t answer: ' + (e.message || e), meta: { reply_to: m.id, error: true } });
    logUsage({ room_id: m.room_id, agent_id: ag.id, automation_id: (m.meta && m.meta.automation_id) || null, kind: (m.meta && m.meta.app_request) ? 'app' : 'chat', provider: ag.provider, model: e.model || ag.model || AI.modelFor(ag.provider, ag.effort), ok: false });
    if (m.meta && m.meta.automation_run) S.sb.from('automation_runs').update({ status: 'error', output: String(e.message || e).slice(0, 500), finished_at: new Date().toISOString() }).eq('id', m.meta.automation_run).then(function () {});
    if (m.meta && m.meta.app_request) S.sb.from('apps').update({ status: 'failed' }).eq('id', m.meta.app_request).then(function () {});
  } finally { sendAgentThinking(ag, m.room_id, m.parent_id, true); }
}
async function imagesFromAttachments(atts) {
  var out = [];
  var imgs = (atts || []).filter(function (a) { return /^image\//.test(a.mime || '') && (a.size || 0) < 5 * 1048576; }).slice(0, 3);
  for (var i = 0; i < imgs.length; i++) {
    var d = await S.sb.storage.from(BUCKET).download(imgs[i].path);
    if (d.data) out.push({ mime: imgs[i].mime, base64: await blobToBase64(d.data) });
  }
  return out;
}
async function buildContext(ag, m) {
  var hist;
  if (m.parent_id) {
    var root = await S.sb.from('messages').select('*').eq('id', m.parent_id).maybeSingle();
    var reps = await S.sb.from('messages').select('*').eq('parent_id', m.parent_id).lte('created_at', m.created_at).order('created_at', { ascending: false }).limit(19);
    hist = (root.data ? [root.data] : []).concat((reps.data || []).reverse());
  } else {
    var r = await S.sb.from('messages').select('*').eq('room_id', m.room_id).is('parent_id', null).lte('created_at', m.created_at).order('created_at', { ascending: false }).limit(20);
    hist = (r.data || []).reverse();
  }
  if (!hist.some(function (h) { return h.id === m.id; })) hist.push(m);
  var images = await imagesFromAttachments(m.attachments);
  var messages = hist.map(function (h) {
    var mine = h.agent_id === ag.id;
    var who = h.agent_id ? ((agentOf(h.agent_id) || {}).name || 'Agent') + ' (AI agent)' : profileOf(h.author_id).display_name;
    var files = (h.attachments || []).length ? ' [attached: ' + h.attachments.map(function (a) { return a.name; }).join(', ') + ']' : '';
    return { role: mine ? 'assistant' : 'user', text: mine ? h.content : who + ': ' + h.content + files, images: h.id === m.id ? images : [] };
  });
  var room = roomOf(m.room_id);
  var people = S.members.map(function (x) { return profileOf(x.user_id).display_name; }).join(', ');
  var others = S.agents.filter(function (a) { return a.id !== ag.id; }).map(function (a) { return '@' + a.name + (a.specialty ? ' (' + a.specialty + ')' : ''); }).join(', ') || 'none';
  var st = AI.getSettings();
  var system = (ag.system_prompt || 'You are a helpful, concise AI teammate.') +
    '\n\n---\nYou are "' + ag.name + '", an AI agent inside the Bizzle Huddle workspace "' + S.ws.name + '", room #' + (room ? room.name : '?') + (m.parent_id ? ' (inside a thread)' : '') + '.' +
    '\nHumans here: ' + people + '. Other AI agents you can ask by writing their @Name: ' + others + '.' +
    '\nOnly @mention another agent when you truly need its help (agent chains stop after ' + MAX_HOPS + ' hops). Current hop: ' + ((m.hop || 0) + 1) + '.' +
    '\nReply in Markdown, be concise and friendly. Never reveal API keys.' + (st.systemPrompt ? '\n\nOwner instructions: ' + st.systemPrompt : '');
  return { system: system, messages: messages };
}
async function postAgentReply(ag, m, text, res, kind) {
  var mn = parseMentions(text, ag.id);
  var hop = Math.min(10, (m.hop || 0) + 1);
  var meta = { reply_to: m.id, provider: res.provider, model: res.model };
  if (m.meta && m.meta.automation_id) { meta.automation_id = m.meta.automation_id; meta.automation_run = m.meta.automation_run; }
  var row = { workspace_id: S.ws.id, room_id: m.room_id, parent_id: m.parent_id || null, agent_id: ag.id, content: text, mention_users: mn.users, mention_agents: mn.agents, hop: hop, meta: meta };
  var posted = null;
  if (ag.needs_approval) {
    row.owner_id = me();
    var a = await S.sb.from('approvals').insert(row).select().single();
    if (a.error) throw a.error;
    toast('📝 ' + ag.name + ' drafted a reply — waiting in Approvals');
  } else {
    row.author_id = me();
    var r = await S.sb.from('messages').insert(row).select().single();
    if (r.error) throw r.error; posted = r.data;
  }
  logUsage({ room_id: m.room_id, agent_id: ag.id, automation_id: meta.automation_id || null, kind: kind || 'chat', provider: res.provider, model: res.model, prompt_tokens: res.promptTokens, completion_tokens: res.completionTokens, estimated: !!res.estimated });
  if (m.meta && m.meta.automation_run) {
    await S.sb.from('automation_runs').update({ status: 'ok', output: (ag.needs_approval ? '[sent to Approvals] ' : '') + text.slice(0, 1500), message_id: posted ? posted.id : null, finished_at: new Date().toISOString() }).eq('id', m.meta.automation_run);
  }
  return posted;
}

/* ---------------- approvals ---------------- */
function renderApprovals() {
  var main = $('#main'); main.removeAttribute('data-key');
  var pend = pendingApprovals(), done = S.approvals.filter(function (a) { return a.status !== 'pending'; }).slice(0, 30);
  function card(a) {
    var ag = agentOf(a.agent_id) || { name: 'Agent', avatar: '🤖' }; var room = roomOf(a.room_id);
    var can = a.owner_id === me() || isAdmin();
    return '<div class="card" style="margin-bottom:10px"><div class="row">' + avatarHtml(ag.avatar, 'agent') + '<div class="grow"><b>' + esc(ag.name) + '</b> <span class="muted small">in #' + esc(room ? room.name : '?') + (a.parent_id ? ' (thread)' : '') + ' · ' + ago(a.created_at) + '</span><div class="tiny muted">owner: ' + esc(profileOf(a.owner_id).display_name) + '</div></div>' +
      (a.status === 'pending' ? '<span class="pill warn">pending</span>' : a.status === 'approved' ? '<span class="pill green">approved</span>' : '<span class="pill red">rejected</span>') + '</div>' +
      '<div class="mt" style="margin:10px 0;background:var(--bubble);border:1px solid var(--line);border-radius:10px;padding:10px">' + md(a.content, { names: mentionNames() }) + '</div>' +
      '<div class="row wrap"><button class="copybtn" data-copyap="' + a.id + '">📋 Copy</button>' +
      (a.status === 'pending' ? (can ? '<button class="btn primary sm" data-approve="' + a.id + '">✅ Approve & post</button><button class="btn danger sm" data-reject="' + a.id + '">✖ Reject</button>' : '<span class="muted small">Only the agent owner or an admin can decide.</span>') :
        '<span class="muted small">' + esc(a.status) + ' by ' + esc(profileOf(a.decided_by).display_name) + ' ' + ago(a.decided_at) + '</span>') + '</div></div>';
  }
  main.innerHTML = '<div class="head">' + backBtn(wsPath('')) + '<div class="grow"><h2>✅ Approvals</h2><div class="sub">Agents with “needs approval” post here first. A human approves or rejects.</div></div></div>' +
    '<div class="body"><div style="max-width:820px;margin:0 auto"><h3>Pending (' + pend.length + ')</h3>' + (pend.map(card).join('') || '<div class="empty">Nothing waiting 🎉</div>') +
    '<h3 style="margin-top:24px">Recently decided</h3>' + (done.map(card).join('') || '<div class="muted">None yet.</div>') + '</div></div>';
  $$('[data-approve]', main).forEach(function (b) { b.onclick = function () { decide(b.getAttribute('data-approve'), true, b); }; });
  $$('[data-reject]', main).forEach(function (b) { b.onclick = function () { decide(b.getAttribute('data-reject'), false, b); }; });
  $$('[data-copyap]', main).forEach(function (b) { b.onclick = function () { var a = S.approvals.find(function (x) { return x.id === b.getAttribute('data-copyap'); }); if (a) copyText(a.content); }; });
}
async function decide(id, approve, btn) {
  btn.disabled = true;
  var r = await S.sb.rpc('decide_approval', { p_id: id, p_approve: approve });
  if (r.error) { toast(r.error.message, true); btn.disabled = false; return; }
  toast(approve ? 'Approved and posted ✓' : 'Rejected');
  var a = S.approvals.find(function (x) { return x.id === id; }); if (a) { a.status = approve ? 'approved' : 'rejected'; a.decided_by = me(); a.decided_at = new Date().toISOString(); }
  renderApprovals(); renderRail(); renderBottomNav();
}

/* ---------------- mini-apps ---------------- */
var APP_BUILDER_PROMPT = 'You build small single-file HTML mini-apps for a team chat workspace.\n' +
  'Output ONLY one complete HTML document inside a ```html code block. No explanations outside it.\n' +
  'Rules: inline CSS and JS only. External scripts, fonts, images, fetch/XHR and network calls are BLOCKED by a strict CSP — do not use them.\n' +
  'The app runs in a sandboxed iframe. To save shared data (visible to everyone in the room) use the async global bridge:\n' +
  '  await huddle.get(key) -> value or null\n  await huddle.set(key, value)   // any JSON value\n  await huddle.del(key)\n' +
  '  await huddle.list() -> [{key, value}]\n  huddle.onChange(function(key, value){ ... })  // fires when anyone changes data\n  await huddle.user() -> {id, name}\n' +
  'Do NOT use localStorage, cookies, alert(), confirm(), prompt() or <form> submit (all unavailable in the sandbox); use in-page UI instead. Make it mobile-friendly (works at 360px wide), accessible, with a clean dark look and neon-green (#39ff14) accents unless asked otherwise.';
function extractHtml(t) {
  var m = String(t || '').match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  var h = m ? m[1] : t;
  if (!/<html|<body|<div|<script/i.test(h || '')) return null;
  return h.trim();
}
async function buildApp(ag, m) {
  var appId = m.meta.app_request;
  var a = await S.sb.from('apps').select('*').eq('id', appId).single();
  if (a.error) throw a.error;
  var app = a.data, st = AI.getSettings();
  var user = 'App name: ' + app.name + '\nWhat it should do: ' + (app.prompt || '') + (m.meta.revise && app.html ? '\n\nHere is the CURRENT app HTML:\n```html\n' + app.html.slice(0, 40000) + '\n```\nApply this change request and return the full updated file: ' + m.meta.revise : '');
  var res = await AI.chat({ provider: ag.provider, model: ag.model || null, effort: ag.effort, system: APP_BUILDER_PROMPT, messages: [{ role: 'user', text: user }], temperature: 0.4, maxTokens: Math.max(8192, st.maxTokens) });
  var html = extractHtml(res.text);
  if (!html) throw new Error('The model did not return HTML. Try again or pick a stronger tier.');
  var up = await S.sb.from('apps').update({ html: html, status: 'draft', agent_id: ag.id }).eq('id', appId);
  if (up.error) throw up.error;
  await S.sb.from('messages').insert({ workspace_id: S.ws.id, room_id: m.room_id, parent_id: m.parent_id || null, author_id: me(), agent_id: ag.id, hop: Math.min(10, (m.hop || 0) + 1),
    content: '🧩 ' + (m.meta.revise ? 'Updated' : 'Built') + ' **' + app.name + '** (' + Math.round(html.length / 1024) + ' KB). It\'s saved as a **draft** — an admin can preview and publish it in the Apps tab.', meta: { reply_to: m.id, app_id: appId, provider: res.provider, model: res.model } });
  logUsage({ room_id: m.room_id, agent_id: ag.id, kind: 'app', provider: res.provider, model: res.model, prompt_tokens: res.promptTokens, completion_tokens: res.completionTokens, estimated: !!res.estimated });
}
function renderAppsTab(room) {
  var body = $('#room-body'); if (!body || !room) return;
  if ($('#app-form-name') && document.activeElement && body.contains(document.activeElement)) { renderAppsList(room); return; }
  var agents = S.agents;
  body.innerHTML = '<div class="body"><div style="max-width:900px;margin:0 auto">' +
    '<div class="card"><b>🧩 Ask an agent to build an app</b><p class="muted small">The agent writes a single-file HTML app. It is saved as a <b>draft</b>; a workspace admin approves it to publish. Apps run sandboxed and can store room data.</p>' +
    '<div class="row wrap"><div class="grow" style="min-width:180px"><label>App name</label><input id="app-form-name" placeholder="Carousel board"></div><div style="min-width:180px"><label>Agent</label><select id="app-form-agent">' +
    (agents.length ? agents.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + (agentOnline(a) ? ' 🟢' : ' ⚪') + '</option>'; }).join('') : '<option value="">No agents yet</option>') + '</select></div></div>' +
    '<label>What should it do?</label><textarea id="app-form-prompt" rows="3" placeholder="A kanban board for post ideas with columns Idea / Draft / Ready / Live, shared with the room."></textarea>' +
    '<div class="row" style="margin-top:10px"><button class="btn primary" id="app-form-go"' + (agents.length ? '' : ' disabled') + '>✨ Build it</button><span class="muted small">The agent\'s owner must have the app open (🟢).</span></div></div>' +
    '<h3>Apps in #' + esc(room.name) + '</h3><div id="apps-list" class="grid"></div></div></div>';
  $('#app-form-go').onclick = async function () {
    var name = $('#app-form-name').value.trim() || 'Untitled app', prompt = $('#app-form-prompt').value.trim(), aid = $('#app-form-agent').value;
    if (!prompt) { toast('Describe the app', true); return; } if (!aid) return;
    this.disabled = true;
    var ins = await S.sb.from('apps').insert({ workspace_id: S.ws.id, room_id: room.id, name: name, prompt: prompt, status: 'building', agent_id: aid, created_by: me() }).select('id,room_id,name,status,agent_id,created_by,prompt,created_at,updated_at').single();
    if (ins.error) { toast(ins.error.message, true); this.disabled = false; return; }
    upsertList(S.apps, { eventType: 'INSERT', new: ins.data });
    var ag = agentOf(aid);
    await requestAgentApp(room.id, ag, ins.data.id, '@' + ag.name + ' please build an app: **' + name + '** — ' + prompt, {});
    $('#app-form-name').value = ''; $('#app-form-prompt').value = ''; this.disabled = false;
    toast('Request sent to ' + ag.name + ' ✨'); renderAppsList(room);
  };
  renderAppsList(room);
}
async function requestAgentApp(roomId, ag, appId, text, extra) {
  var r = await S.sb.from('messages').insert({ workspace_id: S.ws.id, room_id: roomId, author_id: me(), content: text, mention_agents: [ag.id], meta: Object.assign({ app_request: appId }, extra || {}) }).select().single();
  if (r.error) { toast(r.error.message, true); return; }
  onMessageChange({ eventType: 'INSERT', new: r.data });
}
function renderAppsList(room) {
  var el = $('#apps-list'); if (!el) return;
  var list = S.apps.filter(function (a) { return a.room_id === room.id; });
  el.innerHTML = list.map(function (a) {
    var ag = agentOf(a.agent_id);
    var pill = { building: '<span class="pill warn">⏳ building…</span>', draft: '<span class="pill warn">draft · needs approval</span>', published: '<span class="pill green">published</span>', failed: '<span class="pill red">failed</span>' }[a.status];
    return '<div class="card"><div class="row"><b class="grow">' + esc(a.name) + '</b>' + pill + '</div><div class="muted small" style="margin:6px 0">' + esc((a.prompt || '').slice(0, 140)) + '</div>' +
      '<div class="tiny muted">by ' + esc(ag ? ag.name : 'agent') + ' · ' + ago(a.updated_at) + (a.approved_by ? ' · approved by ' + esc(profileOf(a.approved_by).display_name) : '') + '</div>' +
      '<div class="row wrap" style="margin-top:10px">' + (a.status === 'draft' || a.status === 'published' ? '<button class="btn sm primary" data-open-app="' + a.id + '">' + (a.status === 'published' ? '▶ Open' : '👀 Preview') + '</button>' : '') +
      (a.status === 'draft' && isAdmin() ? '<button class="btn sm" data-publish="' + a.id + '">🚀 Approve & publish</button>' : '') +
      (a.status === 'draft' && !isAdmin() ? '<span class="tiny muted">Waiting for an admin to publish</span>' : '') +
      ((a.status === 'draft' || a.status === 'published' || a.status === 'failed') ? '<button class="btn sm" data-revise="' + a.id + '">✏️ Request changes</button>' : '') +
      ((a.created_by === me() || isAdmin()) ? '<button class="btn sm danger" data-del-app="' + a.id + '">🗑️</button>' : '') + '</div></div>';
  }).join('') || '<div class="muted">No apps yet.</div>';
  $$('[data-open-app]', el).forEach(function (b) { b.onclick = function () { openApp(b.getAttribute('data-open-app')); }; });
  $$('[data-publish]', el).forEach(function (b) { b.onclick = function () { publishApp(b.getAttribute('data-publish')); }; });
  $$('[data-del-app]', el).forEach(function (b) { b.onclick = async function () { if (!confirm('Delete this app and its data?')) return; var r = await S.sb.from('apps').delete().eq('id', b.getAttribute('data-del-app')); if (r.error) toast(r.error.message, true); else { upsertList(S.apps, { eventType: 'DELETE', old: { id: b.getAttribute('data-del-app') } }); renderAppsList(room); } }; });
  $$('[data-revise]', el).forEach(function (b) { b.onclick = function () {
    var app = S.apps.find(function (x) { return x.id === b.getAttribute('data-revise'); });
    modal('✏️ Request changes — ' + esc(app.name), '<label>Agent</label><select id="rv-agent">' + S.agents.map(function (a) { return '<option value="' + a.id + '"' + (a.id === app.agent_id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select><label>What should change?</label><textarea id="rv-text" rows="4"></textarea>',
      [{ label: 'Send to agent', primary: true, onClick: async function (close) { var t = $('#rv-text').value.trim(); if (!t) return; var ag = agentOf($('#rv-agent').value); await S.sb.from('apps').update({ status: 'building' }).eq('id', app.id); app.status = 'building'; await requestAgentApp(app.room_id, ag, app.id, '@' + ag.name + ' please update the app **' + app.name + '**: ' + t, { revise: t }); close(); renderAppsList(room); } }]);
  }; });
}
function appsChanged(p) { if (S.route.view === 'room' && S.route.tab === 'apps') renderAppsList(roomOf(S.route.room)); }
async function publishApp(id) {
  var r = await S.sb.from('apps').update({ status: 'published' }).eq('id', id).select('id,status,approved_by,published_at').single();
  if (r.error) { toast(r.error.message, true); return; }
  upsertList(S.apps, { eventType: 'UPDATE', new: r.data }); toast('Published 🚀'); appsChanged();
}
var openFrames = {};   // appId -> {iframe, roomId}
function bridgeScript() {
  return '<script>(function(){var P={},n=0,subs=[];function call(op,a){return new Promise(function(res,rej){var id=++n;P[id]={res:res,rej:rej};parent.postMessage({__huddle:1,id:id,op:op,args:a||{}},"*");});}' +
    'window.addEventListener("message",function(e){var d=e.data;if(!d||!d.__huddle)return;if(d.event==="change"){subs.forEach(function(f){try{f(d.key,d.value)}catch(x){}});return;}var p=P[d.id];if(!p)return;delete P[d.id];d.error?p.rej(new Error(d.error)):p.res(d.result);});' +
    'window.huddle={get:function(k){return call("get",{key:k})},set:function(k,v){return call("set",{key:k,value:v})},del:function(k){return call("del",{key:k})},list:function(){return call("list")},user:function(){return call("user")},onChange:function(f){subs.push(f)}};})();<\/script>';
}
function buildSrcdoc(html) {
  var csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; media-src data: blob:; form-action \'none\'">';
  var head = csp + '<meta name="viewport" content="width=device-width,initial-scale=1">' + bridgeScript();
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + head; });
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, function (m) { return m + '<head>' + head + '</head>'; });
  return '<!doctype html><html><head>' + head + '</head><body>' + html + '</body></html>';
}
async function openApp(id) {
  var r = await S.sb.from('apps').select('*').eq('id', id).single();
  if (r.error) { toast(r.error.message, true); return; }
  var app = r.data;
  var m = modal((app.status === 'published' ? '▶ ' : '👀 Preview (draft) — ') + esc(app.name), '<iframe class="appframe" id="appframe" title="' + esc(app.name) + '"></iframe>', [], { wide: true, noPad: true,
    extraHead: (app.status === 'draft' && isAdmin() ? '<button class="btn sm primary" id="app-pub-inline">🚀 Publish</button>' : '') + '<button class="btn sm" id="app-copy-html">📋 HTML</button>',
    onClose: function () { delete openFrames[id]; } });
  var f = $('#appframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.srcdoc = buildSrcdoc(app.html);
  openFrames[id] = { iframe: f, roomId: app.room_id };
  $('#app-copy-html').onclick = function () { copyText(app.html); };
  if ($('#app-pub-inline')) $('#app-pub-inline').onclick = function () { publishApp(id); this.remove(); };
}
window.addEventListener('message', async function (e) {
  var d = e.data; if (!d || !d.__huddle || !d.op) return;
  var appId = Object.keys(openFrames).find(function (k) { return openFrames[k].iframe.contentWindow === e.source; });
  if (!appId) return;                                   // only our open app frames may use the bridge
  var fr = openFrames[appId], reply = function (result, error) { e.source.postMessage({ __huddle: 1, id: d.id, result: result, error: error }, '*'); };
  try {
    var key = d.args && d.args.key;
    if (d.op !== 'list' && d.op !== 'user' && (typeof key !== 'string' || !key || key.length > 200)) throw new Error('key must be a 1-200 char string');
    if (d.op === 'get') { var g = await S.sb.from('app_kv').select('value').eq('app_id', appId).eq('key', key).maybeSingle(); if (g.error) throw g.error; reply(g.data ? g.data.value : null); }
    else if (d.op === 'set') {
      var json = JSON.stringify(d.args.value === undefined ? null : d.args.value); if (json.length > 200000) throw new Error('value too large (200 KB max)');
      var s = await S.sb.from('app_kv').upsert({ app_id: appId, room_id: fr.roomId, key: key, value: JSON.parse(json), updated_by: me(), updated_at: new Date().toISOString() }, { onConflict: 'app_id,key' }); if (s.error) throw s.error; reply(true);
    } else if (d.op === 'del') { var x = await S.sb.from('app_kv').delete().eq('app_id', appId).eq('key', key); if (x.error) throw x.error; reply(true); }
    else if (d.op === 'list') { var l = await S.sb.from('app_kv').select('key,value').eq('app_id', appId).order('key').limit(1000); if (l.error) throw l.error; reply(l.data); }
    else if (d.op === 'user') reply({ id: me(), name: S.profile.display_name });
    else throw new Error('unknown op');
  } catch (err) { reply(null, err.message || String(err)); }
});
function onKvChange(p) {
  var row = p.new && p.new.app_id ? p.new : p.old; if (!row) return;
  var fr = openFrames[row.app_id]; if (!fr) return;
  fr.iframe.contentWindow.postMessage({ __huddle: 1, event: 'change', key: row.key, value: p.eventType === 'DELETE' ? null : p.new.value }, '*');
}

/* ---------------- automations ---------------- */
function scheduleText(a) {
  if (a.schedule_kind === 'daily') return 'Daily at ' + String(a.daily_time || '').slice(0, 5) + ' (' + a.tz + ')';
  var n = a.every_minutes || 0; return n % 60 === 0 ? 'Every ' + (n / 60) + ' hour' + (n === 60 ? '' : 's') : 'Every ' + n + ' minute' + (n === 1 ? '' : 's');
}
async function renderAutomationsTab(room) {
  var body = $('#room-body'); if (!body || !room) return;
  var list = S.automations.filter(function (a) { return a.room_id === room.id; });
  var ids = list.map(function (a) { return a.id; });
  if (ids.length) { var rr = await S.sb.from('automation_runs').select('*').in('automation_id', ids).order('started_at', { ascending: false }).limit(60); S.runs = rr.data || []; } else S.runs = [];
  if (document.activeElement && body.contains(document.activeElement) && $('#au-name')) { renderAutoList(room, list); return; }
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  body.innerHTML = '<div class="body"><div style="max-width:900px;margin:0 auto">' +
    '<div class="card"><b>⏰ New automation</b><p class="muted small">Runs on schedule <b>while any admin has the app open</b> (free = no server). Each run is claimed atomically in the database, so two open devices never double-run it.</p>' +
    '<div class="row wrap"><div class="grow" style="min-width:160px"><label>Name</label><input id="au-name" placeholder="Daily check-in"></div><div style="min-width:160px"><label>Agent</label><select id="au-agent">' + (S.agents.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; }).join('') || '<option value="">No agents yet</option>') + '</select></div></div>' +
    '<label>Prompt</label><textarea id="au-prompt" rows="2" placeholder="Post a 3-bullet summary of what this room did today."></textarea>' +
    '<div class="row wrap"><div><label>Schedule</label><select id="au-kind"><option value="interval">Every N minutes / hours</option><option value="daily">Daily at a time</option></select></div>' +
    '<div id="au-int" class="row"><div><label>Every</label><input id="au-n" type="number" min="1" value="60" style="width:90px"></div><div><label>&nbsp;</label><select id="au-unit"><option value="1">minutes</option><option value="60">hours</option></select></div></div>' +
    '<div id="au-day" class="hidden"><label>Time (' + esc(tz) + ')</label><input id="au-time" type="time" value="09:00"></div></div>' +
    '<div class="row" style="margin-top:12px"><button class="btn primary" id="au-go"' + (S.agents.length ? '' : ' disabled') + '>＋ Create automation</button></div></div>' +
    '<h3>Automations in #' + esc(room.name) + '</h3><div id="au-list"></div></div></div>';
  $('#au-kind').onchange = function () { var d = this.value === 'daily'; $('#au-int').classList.toggle('hidden', d); $('#au-day').classList.toggle('hidden', !d); };
  $('#au-go').onclick = async function () {
    var kind = $('#au-kind').value, prompt = $('#au-prompt').value.trim(); if (!prompt) { toast('Add a prompt', true); return; }
    var row = { workspace_id: S.ws.id, room_id: room.id, agent_id: $('#au-agent').value || null, name: $('#au-name').value.trim() || 'Automation', prompt: prompt, schedule_kind: kind, tz: tz, created_by: me(), enabled: true };
    if (kind === 'interval') row.every_minutes = Math.max(1, parseInt($('#au-n').value, 10) || 60) * parseInt($('#au-unit').value, 10); else row.daily_time = $('#au-time').value || '09:00';
    // first run happens one interval from now (not instantly)
    if (kind === 'interval') row.last_run = new Date().toISOString();
    var r = await S.sb.from('automations').insert(row).select().single();
    if (r.error) { toast(r.error.message, true); return; }
    upsertList(S.automations, { eventType: 'INSERT', new: r.data }); toast('Automation created ⏰'); renderAutomationsTab(room);
  };
  renderAutoList(room, list);
}
function renderAutoList(room, list) {
  var el = $('#au-list'); if (!el) return;
  el.innerHTML = list.map(function (a) {
    var ag = agentOf(a.agent_id); var runs = S.runs.filter(function (r) { return r.automation_id === a.id; }).slice(0, 8);
    var canEdit = a.created_by === me() || isAdmin();
    return '<div class="card" style="margin-bottom:10px"><div class="row wrap"><b class="grow">' + esc(a.name) + '</b>' + (a.enabled ? '<span class="pill green">Active</span>' : '<span class="pill">Paused</span>') + '</div>' +
      '<div class="small" style="margin:6px 0">' + esc(scheduleText(a)) + ' · agent <b>' + esc(ag ? ag.name : '(none)') + '</b> · last run ' + ago(a.last_run) + '</div><div class="muted small">“' + esc(a.prompt) + '”</div>' +
      '<div class="row wrap" style="margin-top:8px"><button class="btn sm primary" data-run="' + a.id + '">▶ Run now</button>' + (canEdit ? '<button class="btn sm" data-toggle="' + a.id + '">' + (a.enabled ? '⏸ Pause' : '▶ Resume') + '</button><button class="btn sm danger" data-del-au="' + a.id + '">🗑️</button>' : '') + '</div>' +
      '<details style="margin-top:8px"' + (runs.length ? ' open' : '') + '><summary class="small muted">History (' + runs.length + ')</summary><table><tr><th>When</th><th>Status</th><th>Output</th></tr>' +
      (runs.map(function (r) { return '<tr><td class="small">' + esc(new Date(r.started_at).toLocaleString()) + '</td><td>' + ({ ok: '<span class="pill green">ok</span>', error: '<span class="pill red">error</span>', dispatched: '<span class="pill warn">sent to agent</span>', claimed: '<span class="pill">running</span>' })[r.status] + '</td><td class="small">' + esc((r.output || '').slice(0, 160)) + '</td></tr>'; }).join('') || '<tr><td colspan="3" class="muted small">No runs yet</td></tr>') + '</table></details></div>';
  }).join('') || '<div class="muted">No automations yet.</div>';
  $$('[data-run]', el).forEach(function (b) { b.onclick = async function () { b.disabled = true; var r = await S.sb.rpc('run_automation_now', { p_id: b.getAttribute('data-run') }); if (r.error) toast(r.error.message, true); else { toast('Running…'); executeRun(r.data); } b.disabled = false; }; });
  $$('[data-toggle]', el).forEach(function (b) { b.onclick = async function () { var a = S.automations.find(function (x) { return x.id === b.getAttribute('data-toggle'); }); var r = await S.sb.from('automations').update({ enabled: !a.enabled }).eq('id', a.id); if (r.error) toast(r.error.message, true); else { a.enabled = !a.enabled; renderAutoList(room, S.automations.filter(function (x) { return x.room_id === room.id; })); } }; });
  $$('[data-del-au]', el).forEach(function (b) { b.onclick = async function () { if (!confirm('Delete automation?')) return; var id = b.getAttribute('data-del-au'); var r = await S.sb.from('automations').delete().eq('id', id); if (r.error) toast(r.error.message, true); else { upsertList(S.automations, { eventType: 'DELETE', old: { id: id } }); renderAutomationsTab(room); } }; });
}
function startAutomationLoop() {
  if (S.autoTimer) clearInterval(S.autoTimer);
  var tick = async function () {
    if (!S.ws || !isAdmin()) return;
    var r = await S.sb.rpc('claim_due_automations', { p_ws: S.ws.id });
    if (r.error) { console.warn('automations', r.error.message); return; }
    (r.data || []).forEach(executeRun);
  };
  S.autoTimer = setInterval(tick, 30000); setTimeout(tick, 4000);
}
async function executeRun(run) {
  upsertList(S.runs, { eventType: 'INSERT', new: run });
  var a = S.automations.find(function (x) { return x.id === run.automation_id; });
  if (!a) { var q = await S.sb.from('automations').select('*').eq('id', run.automation_id).single(); a = q.data; }
  var ag = a && agentOf(a.agent_id);
  function fin(status, output, mid) { return S.sb.from('automation_runs').update({ status: status, output: String(output || '').slice(0, 1500), message_id: mid || null, finished_at: status === 'dispatched' ? null : new Date().toISOString() }).eq('id', run.id); }
  if (!a || !ag) { await fin('error', 'No agent (deleted or private).'); return; }
  try {
    // Hand the job to the agent: a message that @mentions it. The agent OWNER's app runs it
    // (if that is me, my runner picks it up immediately via realtime / direct call).
    var r = await S.sb.from('messages').insert({ workspace_id: a.workspace_id, room_id: a.room_id, author_id: me(), content: '⏰ **' + a.name + '** — @' + ag.name + ' ' + a.prompt, mention_agents: [ag.id], meta: { automation_id: a.id, automation_run: run.id } }).select().single();
    if (r.error) throw r.error;
    await fin('dispatched', 'Sent to ' + ag.name + (agentOnline(ag) ? '' : ' (owner offline — runs when their app opens, within 10 min)'), r.data.id);
    onMessageChange({ eventType: 'INSERT', new: r.data });
  } catch (e) { await fin('error', e.message || String(e)); }
}

/* ---------------- files ---------------- */
async function renderFilesTab(room) {
  var body = $('#room-body'); if (!body || !room) return;
  var r = await S.sb.from('files').select('*').eq('room_id', room.id).order('created_at', { ascending: false }).limit(300);
  S.files = (r.data || []);
  body.innerHTML = '<div class="body"><div style="max-width:900px;margin:0 auto"><div class="card"><div class="row wrap"><b class="grow">📁 Files in #' + esc(room.name) + '</b><button class="btn primary" id="f-up">⬆ Upload</button><input type="file" id="f-in" multiple class="hidden"></div>' +
    '<p class="muted small">Stored in your Supabase Storage bucket <code>' + BUCKET + '</code>, visible only to people who can see this room. Max 50 MB each.</p><div id="f-prog" class="small"></div></div>' +
    '<div class="card" style="margin-top:12px;padding:6px"><div class="list" id="f-list"></div></div></div></div>';
  $('#f-up').onclick = function () { $('#f-in').click(); };
  $('#f-in').onchange = async function () {
    var files = Array.prototype.slice.call(this.files); this.value = ''; if (!files.length) return;
    $('#f-prog').textContent = 'Uploading ' + files.length + ' file(s)…';
    var out = await uploadFiles(room.id, files);
    $('#f-prog').textContent = out.length ? '✓ Uploaded ' + out.map(function (f) { return f.name; }).join(', ') : '';
    renderFilesTab(room);
  };
  var list = S.files.filter(function (f) { return f.room_id === room.id; });
  $('#f-list').innerHTML = list.map(function (f) {
    var isImg = /^image\//.test(f.mime || '');
    return '<div class="li">' + (isImg ? '<img data-path="' + esc(f.path) + '" style="width:44px;height:44px;object-fit:cover;border-radius:8px">' : '<div class="av">📄</div>') +
      '<div class="grow" style="min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>' + esc(f.name) + '</b></div><div class="tiny muted">' + fmtBytes(f.size) + ' · ' + esc(profileOf(f.uploaded_by).display_name) + ' · ' + ago(f.created_at) + '</div></div>' +
      '<button class="btn sm" data-dl="' + esc(f.path) + '" data-name="' + esc(f.name) + '">⬇</button>' + ((f.uploaded_by === me() || isAdmin()) ? '<button class="btn sm danger" data-del-file="' + f.id + '" data-path="' + esc(f.path) + '">🗑️</button>' : '') + '</div>';
  }).join('') || '<div class="empty">No files yet.</div>';
  $$('[data-dl]', body).forEach(function (a) { a.onclick = function () { downloadPath(a.getAttribute('data-dl'), a.getAttribute('data-name')); }; });
  $$('[data-del-file]', body).forEach(function (b) { b.onclick = async function () {
    if (!confirm('Delete file?')) return;
    var s = await S.sb.storage.from(BUCKET).remove([b.getAttribute('data-path')]); if (s.error) { toast(s.error.message, true); return; }
    await S.sb.from('files').delete().eq('id', b.getAttribute('data-del-file')); renderFilesTab(room);
  }; });
  hydrateImages(body);
}

/* ---------------- modal helper ---------------- */
function modal(title, bodyHtml, buttons, opts) {
  opts = opts || {};
  var wrap = document.createElement('div'); wrap.className = 'modal-wrap';
  wrap.innerHTML = '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true"><div class="modal-h"><button class="back" data-close="1" aria-label="Back">←</button><h3>' + title + '</h3>' + (opts.extraHead || '') + '<button class="btn sm" data-close="1" aria-label="Close">✕</button></div>' +
    '<div class="modal-b"' + (opts.noPad ? ' style="padding:0;flex:1;display:flex"' : '') + '>' + bodyHtml + '</div>' +
    ((buttons && buttons.length) ? '<div class="modal-f">' + buttons.map(function (b, i) { return '<button class="btn ' + (b.primary ? 'primary' : '') + (b.danger ? ' danger' : '') + '" data-mb="' + i + '">' + b.label + '</button>'; }).join('') + '</div>' : '') + '</div>';
  $('#modals').appendChild(wrap);
  function close() { wrap.remove(); if (opts.onClose) opts.onClose(); }
  $$('[data-close]', wrap).forEach(function (b) { b.onclick = close; });
  wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
  (buttons || []).forEach(function (b, i) { $('[data-mb="' + i + '"]', wrap).onclick = function () { b.onClick ? b.onClick(close, this) : close(); }; });
  var first = $('input,textarea,select', wrap); if (first && !isPhone()) setTimeout(function () { first.focus(); }, 50);
  return { el: wrap, close: close };
}
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var m = $$('.modal-wrap').pop(); if (m) $('[data-close]', m).click(); } });

/* ---------------- workspace menu / new room ---------------- */
function openWorkspaceMenu() {
  var m = modal('Workspaces', S.wsList.map(function (w) {
    return '<button class="item ' + (w.id === S.ws.id ? 'on' : '') + '" data-ws="' + w.id + '"><span class="av sm">' + esc(w.name.charAt(0).toUpperCase()) + '</span><span class="nm">' + esc(w.name) + '</span><span class="pill">' + esc(w.myRole) + '</span></button>';
  }).join('') + '<div class="row wrap" style="margin-top:12px"><button class="btn" id="wm-new">＋ Create / join workspace</button><button class="btn" id="wm-invite">🎟️ Invite people</button></div>', []);
  $$('[data-ws]', m.el).forEach(function (b) { b.onclick = function () { m.close(); go('w/' + b.getAttribute('data-ws')); }; });
  $('#wm-new', m.el).onclick = function () { m.close(); go('onboard'); };
  $('#wm-invite', m.el).onclick = function () { m.close(); openInvite(); };
}
function openInvite() { var m = modal('🎟️ Invite people to ' + esc(S.ws.name), inviteBox(inviteLink()), []); bindInviteBox(); }
function openNewRoom() {
  modal('＋ New room', '<label>Name</label><input id="nr-name" maxlength="60" placeholder="ais-media"><label>Topic</label><input id="nr-topic" maxlength="140" placeholder="What is this room for?">' +
    '<div class="switch"><input type="checkbox" id="nr-priv"><div><b>Private</b><div class="muted small">Only people you add (and admins) can see it.</div></div></div>',
    [{ label: 'Create room', primary: true, onClick: async function (close, btn) {
      var name = $('#nr-name').value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]/g, ''); if (!name) { toast('Name it', true); return; }
      btn.disabled = true;
      var r = await S.sb.from('rooms').insert({ workspace_id: S.ws.id, name: name, topic: $('#nr-topic').value.trim(), is_private: $('#nr-priv').checked, created_by: me() }).select().single();
      if (r.error) { toast(r.error.message, true); btn.disabled = false; return; }
      await S.sb.from('room_members').insert({ room_id: r.data.id, user_id: me(), role: 'admin' });
      upsertList(S.rooms, { eventType: 'INSERT', new: r.data }); S.unread[r.data.id] = { unread: 0, mentions: 0 };
      close(); go(wsPath('r/' + r.data.id));
    } }]);
}
async function openRoomMembers(room) {
  var r = await S.sb.from('room_members').select('*').eq('room_id', room.id);
  var rm = r.data || [];
  var inRoom = room.is_private ? rm.map(function (x) { return x.user_id; }) : S.members.map(function (x) { return x.user_id; });
  var canManage = isAdmin() || room.created_by === me();
  var people = inRoom.map(function (uid_) { var p = profileOf(uid_); var w = S.members.find(function (x) { return x.user_id === uid_; }) || {}; return '<div class="li">' + avatarHtml(p.avatar) + '<div class="grow"><b>' + esc(p.display_name) + '</b> <span class="dot ' + (S.online[uid_] ? 'on' : '') + '"></span><div class="tiny muted">' + esc(w.role || 'member') + '</div></div>' + (room.is_private && canManage && uid_ !== me() ? '<button class="btn sm danger" data-rm-user="' + uid_ + '">Remove</button>' : '') + '</div>'; }).join('');
  var agents = S.agents.map(function (a) { return '<div class="li">' + avatarHtml(a.avatar, 'agent') + '<div class="grow"><b>' + esc(a.name) + '</b> <span class="pill green">agent</span><div class="tiny muted">owner ' + esc(profileOf(a.owner_id).display_name) + '</div></div><span class="dot ' + (agentOnline(a) ? 'on' : '') + '"></span></div>'; }).join('');
  var addable = S.members.filter(function (x) { return inRoom.indexOf(x.user_id) < 0; });
  var m = modal('👥 ' + (room.is_private ? '🔒 ' : '#') + esc(room.name) + ' members',
    (room.is_private ? '' : '<div class="note">Public room: everyone in the workspace can read and post.</div>') +
    '<div class="list">' + people + '</div><div class="sec">Agents (mention any of them)</div><div class="list">' + agents + '</div>' +
    (room.is_private && canManage && addable.length ? '<label>Add member</label><div class="row"><select id="rm-add">' + addable.map(function (x) { return '<option value="' + x.user_id + '">' + esc(profileOf(x.user_id).display_name) + '</option>'; }).join('') + '</select><button class="btn primary" id="rm-add-go">Add</button></div>' : ''), []);
  if ($('#rm-add-go', m.el)) $('#rm-add-go', m.el).onclick = async function () { var x = await S.sb.from('room_members').insert({ room_id: room.id, user_id: $('#rm-add').value }); if (x.error) toast(x.error.message, true); else { toast('Added ✓'); m.close(); room._memberCount = null; openRoomMembers(room); } };
  $$('[data-rm-user]', m.el).forEach(function (b) { b.onclick = async function () { var x = await S.sb.from('room_members').delete().eq('room_id', room.id).eq('user_id', b.getAttribute('data-rm-user')); if (x.error) toast(x.error.message, true); else { m.close(); openRoomMembers(room); } }; });
}

/* ---------------- members page ---------------- */
var membersTab = 'all';
function renderMembers() {
  var main = $('#main'); main.removeAttribute('data-key');
  var t = membersTab;
  var people = S.members.map(function (m) {
    var p = profileOf(m.user_id);
    var roleCtl = isAdmin() && m.user_id !== me() ? '<select data-role="' + m.user_id + '" style="width:auto"><option value="member"' + (m.role === 'member' ? ' selected' : '') + '>Member</option><option value="admin"' + (m.role === 'admin' ? ' selected' : '') + '>Admin</option></select><button class="btn sm danger" data-kick="' + m.user_id + '">Remove</button>' : '<span class="pill' + (m.role === 'admin' ? ' green' : '') + '">' + esc(m.role) + '</span>';
    return '<div class="li">' + avatarHtml(p.avatar) + '<div class="grow"><b>' + esc(p.display_name) + '</b>' + (m.user_id === me() ? ' <span class="muted small">(you)</span>' : '') + ' <span class="dot ' + (S.online[m.user_id] ? 'on' : '') + '" title="' + (S.online[m.user_id] ? 'online' : 'offline') + '"></span><div class="tiny muted">joined ' + ago(m.joined_at) + ' · ' + S.agents.filter(function (a) { return a.owner_id === m.user_id; }).length + ' agents</div></div><div class="row">' + roleCtl + '</div></div>';
  }).join('');
  var agents = S.agents.map(function (a) {
    return '<div class="li" style="cursor:pointer" data-agent-profile="' + a.id + '">' + avatarHtml(a.avatar, 'agent') + '<div class="grow"><b>' + esc(a.name) + '</b> <span class="pill green">agent</span>' + (a.is_private ? ' <span class="pill">🔒 private</span>' : '') + (a.needs_approval ? ' <span class="pill warn">needs approval</span>' : '') +
      '<div class="tiny muted">' + esc(AI.PROVIDERS[a.provider] ? AI.PROVIDERS[a.provider].label : a.provider) + ' · ' + esc(a.model || AI.modelFor(a.provider, a.effort)) + ' · ' + esc(a.effort) + ' · owner ' + esc(profileOf(a.owner_id).display_name) + '</div></div><span class="dot ' + (agentOnline(a) ? 'on' : '') + '" title="' + (agentOnline(a) ? 'online' : 'offline (owner app closed)') + '"></span></div>';
  }).join('');
  main.innerHTML = '<div class="head stack">' + backBtn(wsPath('')) + '<div class="grow"><h2>👥 Members</h2><div class="sub">' + S.members.length + ' people · ' + S.agents.length + ' agents</div></div>' +
    '<button class="btn sm primary" id="m-new-agent">🤖 New agent</button><button class="btn sm" id="m-invite">🎟️ Invite member</button>' +
    '<div class="tabs" id="m-tabs">' + ['all', 'people', 'agents'].map(function (x) { return '<button data-t="' + x + '" class="' + (t === x ? 'on' : '') + '">' + ({ all: 'All', people: 'People', agents: 'Agents' })[x] + '</button>'; }).join('') + '</div></div>' +
    '<div class="body"><div style="max-width:860px;margin:0 auto">' +
    (t !== 'agents' ? '<h3>People</h3><div class="card list" style="padding:4px">' + people + '</div>' : '') +
    (t !== 'people' ? '<h3>Agents</h3><div class="card list" style="padding:4px">' + (agents || '<div class="empty">No agents yet — create one!</div>') + '</div><p class="muted small">An agent is <b>online</b> when its owner has Huddle open: it runs on the owner\'s device with the owner\'s own free API key.</p>' : '') + '</div></div>';
  $$('#m-tabs button').forEach(function (b) { b.onclick = function () { membersTab = b.getAttribute('data-t'); renderMembers(); }; });
  $('#m-new-agent').onclick = function () { openAgentDialog(); };
  $('#m-invite').onclick = openInvite;
  $$('[data-agent-profile]', main).forEach(function (el) { el.onclick = function () { openAgentProfile(el.getAttribute('data-agent-profile')); }; });
  $$('[data-role]', main).forEach(function (s) { s.onchange = async function () { var r = await S.sb.from('workspace_members').update({ role: s.value }).eq('workspace_id', S.ws.id).eq('user_id', s.getAttribute('data-role')); if (r.error) { toast(r.error.message, true); renderMembers(); } else toast('Role updated'); }; });
  $$('[data-kick]', main).forEach(function (b) { b.onclick = async function () { var u = b.getAttribute('data-kick'); if (!confirm('Remove ' + profileOf(u).display_name + ' from the workspace?')) return; var r = await S.sb.from('workspace_members').delete().eq('workspace_id', S.ws.id).eq('user_id', u); if (r.error) toast(r.error.message, true); else { upsertList(S.members, { eventType: 'DELETE', old: { workspace_id: S.ws.id, user_id: u } }, ['workspace_id', 'user_id']); renderMembers(); toast('Removed'); } }; });
}

/* ---------------- agents: dialog + profile ---------------- */
var EMOJIS = ['🤖', '🧠', '🦾', '👾', '🐝', '🦉', '🐙', '🦊', '🐸', '🌿', '⚡', '🔥', '🧪', '📈', '🎨', '🛠️'];
function openAgentDialog(existing) {
  var a = existing || { name: '', avatar: '🤖', specialty: '', provider: AI.getSettings().provider || 'gemini', model: '', effort: 'Pro', system_prompt: '', is_private: false, needs_approval: false };
  var avatar = a.avatar;
  var provOpts = Object.keys(AI.PROVIDERS).map(function (k) { return '<option value="' + k + '"' + (a.provider === k ? ' selected' : '') + '>' + esc(AI.PROVIDERS[k].label) + '</option>'; }).join('');
  var m = modal(existing ? '✏️ Edit agent' : '🤖 New agent',
    '<div class="row" style="margin-top:8px"><div id="ag-av-prev">' + avatarHtml(avatar, 'agent') + '</div><div class="grow"><label style="margin-top:0">Avatar — pick an emoji or upload</label><div class="emoji-row" id="ag-emojis">' + EMOJIS.map(function (e) { return '<button type="button" class="' + (e === avatar ? 'on' : '') + '">' + e + '</button>'; }).join('') + '<button type="button" id="ag-up" title="Upload image">⬆</button></div><input type="file" id="ag-file" accept="image/*" class="hidden"></div></div>' +
    '<label>Name</label><input id="ag-name" maxlength="40" value="' + esc(a.name) + '" placeholder="Researcher">' +
    '<label>Specialty</label><input id="ag-spec" maxlength="80" value="' + esc(a.specialty || '') + '" placeholder="e.g. Research and synthesis">' +
    '<label>Provider (runs on your device with your own free key)</label><select id="ag-prov">' + provOpts + '</select>' +
    '<label>Intelligence</label><div class="tabs" id="ag-tier">' + ['Fast', 'Pro', 'Max'].map(function (t) { return '<button type="button" data-t="' + t + '" class="' + (a.effort === t ? 'on' : '') + '">' + t + '</button>'; }).join('') + '</div><div class="tiny muted" id="ag-tier-info"></div>' +
    '<label>Model <span class="tiny">(blank = use the tier\'s default)</span></label><div class="row"><select id="ag-model"></select><button class="btn sm" type="button" id="ag-refresh" title="Load live model list">↻</button></div><div class="tiny muted" id="ag-model-note"></div>' +
    '<label>System prompt / persona</label><textarea id="ag-sys" rows="4" placeholder="You are a sharp researcher. Cite sources when you can.">' + esc(a.system_prompt || '') + '</textarea>' +
    '<div class="switch"><input type="checkbox" id="ag-priv"' + (a.is_private ? ' checked' : '') + '><div><b>Private</b><div class="muted small">Only you can see and @mention it.</div></div></div>' +
    '<div class="switch"><input type="checkbox" id="ag-appr"' + (a.needs_approval ? ' checked' : '') + '><div><b>Needs approval before posting</b><div class="muted small">Replies go to ✅ Approvals; you or an admin approve or reject.</div></div></div>' +
    '<div class="note">🔑 Your provider key is <b>never</b> stored in the database. It lives only in this device\'s ⚙️ Advanced AI Settings. The agent replies only while your app is open.</div>',
    [{ label: existing ? 'Save' : 'Create agent', primary: true, onClick: async function (close, btn) {
      var row = { name: $('#ag-name').value.trim(), avatar: avatar, specialty: $('#ag-spec').value.trim(), provider: $('#ag-prov').value, effort: $('#ag-tier .on').getAttribute('data-t'), model: $('#ag-model').value, system_prompt: $('#ag-sys').value, is_private: $('#ag-priv').checked, needs_approval: $('#ag-appr').checked };
      if (!row.name) { toast('Name your agent', true); return; }
      if (/\s{2,}|@/.test(row.name)) { toast('Avoid @ and double spaces in names', true); return; }
      btn.disabled = true;
      var r = existing ? await S.sb.from('agents').update(row).eq('id', existing.id).select().single() : await S.sb.from('agents').insert(Object.assign(row, { workspace_id: S.ws.id, owner_id: me() })).select().single();
      if (r.error) { toast(/duplicate|unique/.test(r.error.message) ? 'An agent with that name already exists here' : r.error.message, true); btn.disabled = false; return; }
      upsertList(S.agents, { eventType: existing ? 'UPDATE' : 'INSERT', new: r.data });
      if (S.chan) S.chan.track({ user_id: me(), name: S.profile.display_name, agents: myAgents().map(function (x) { return x.id; }), at: new Date().toISOString() });
      close(); toast(existing ? 'Saved ✓' : row.name + ' is ready — @mention it in any room 🎉');
      if (!AI.getKeys()[row.provider]) toast('Add your ' + AI.PROVIDERS[row.provider].label + ' key in 🧠 Advanced AI Settings so it can reply', true);
      rerenderSoft();
    } }]);
  function fillModels(list) {
    var p = $('#ag-prov').value, cur = a.provider === p ? a.model : '';
    var opts = '<option value="">Tier default (' + esc(AI.modelFor(p, $('#ag-tier .on').getAttribute('data-t'))) + ')</option>' +
      (list || AI.PROVIDERS[p].models.map(function (id) { return { id: id }; })).map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.id) + (x.vision ? ' 👁️' : '') + '</option>'; }).join('');
    if (cur && opts.indexOf('value="' + esc(cur) + '"') < 0) opts += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>';
    $('#ag-model').innerHTML = opts;
  }
  function tierInfo() { var t = $('#ag-tier .on').getAttribute('data-t'); $('#ag-tier-info').textContent = AI.TIER_INFO[t] + ' → ' + AI.modelFor($('#ag-prov').value, t); }
  $$('#ag-tier button').forEach(function (b) { b.onclick = function () { $$('#ag-tier button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); tierInfo(); fillModels(); }; });
  $('#ag-prov').onchange = function () { tierInfo(); fillModels(); $('#ag-model-note').textContent = AI.getKeys()[this.value] ? '' : 'No ' + AI.PROVIDERS[this.value].label + ' key on this device yet.'; };
  $('#ag-refresh').onclick = function () { var p = $('#ag-prov').value; $('#ag-model-note').textContent = 'Loading live list…'; AI.listModels(p).then(function (l) { fillModels(l); $('#ag-model-note').textContent = l.length + ' models (' + (p === 'openrouter' ? 'free only' : 'from your key') + ')'; }).catch(function (e) { $('#ag-model-note').textContent = 'Could not load: ' + e.message; }); };
  $$('#ag-emojis button:not(#ag-up)').forEach(function (b) { b.onclick = function () { avatar = b.textContent; $$('#ag-emojis button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); $('#ag-av-prev').innerHTML = avatarHtml(avatar, 'agent'); }; });
  $('#ag-up').onclick = function () { $('#ag-file').click(); };
  $('#ag-file').onchange = async function () { var f = this.files[0]; if (!f) return; avatar = await resizeImage(f, 96); $('#ag-av-prev').innerHTML = avatarHtml(avatar, 'agent'); };
  tierInfo(); fillModels(); $('#ag-prov').onchange.call($('#ag-prov'));
}
async function openAgentProfile(id) {
  var a = agentOf(id); if (!a) return;
  var u = await S.sb.from('usage_events').select('prompt_tokens,completion_tokens,ok,created_at,kind').eq('agent_id', id).order('created_at', { ascending: false }).limit(2000);
  var ev = u.data || [], tok = 0, okN = 0, last = ev[0] && ev[0].created_at;
  ev.forEach(function (e) { tok += (e.prompt_tokens || 0) + (e.completion_tokens || 0); if (e.ok) okN++; });
  var mine = a.owner_id === me();
  var m = modal(esc(a.name) + ' · agent profile',
    '<div class="row" style="margin:10px 0">' + avatarHtml(a.avatar, 'agent') + '<div class="grow"><b style="font-size:18px">' + esc(a.name) + '</b> <span class="dot ' + (agentOnline(a) ? 'on' : '') + '"></span><div class="muted small">' + esc(a.specialty || 'AI teammate') + '</div></div></div>' +
    '<div class="tabs" style="margin-bottom:10px"><button class="on">Profile</button></div>' +
    '<div class="kv"><div>Status</div><div>' + (agentOnline(a) ? '🟢 Online (owner\'s app is open)' : '⚪ Offline — runs when ' + esc(profileOf(a.owner_id).display_name) + ' opens Huddle') + '</div>' +
    '<div>Owner</div><div>' + esc(profileOf(a.owner_id).display_name) + '</div><div>Provider</div><div>' + esc(AI.PROVIDERS[a.provider] ? AI.PROVIDERS[a.provider].label : a.provider) + '</div>' +
    '<div>Model</div><div><code>' + esc(a.model || AI.modelFor(a.provider, a.effort)) + '</code>' + (a.model ? '' : ' <span class="muted small">(tier default)</span>') + '</div><div>Intelligence</div><div>' + esc(a.effort) + ' — ' + esc(AI.TIER_INFO[a.effort]) + '</div>' +
    '<div>Visibility</div><div>' + (a.is_private ? '🔒 Private (owner only)' : 'Everyone in the workspace') + '</div><div>Approval</div><div>' + (a.needs_approval ? 'Replies need approval' : 'Posts directly') + '</div>' +
    '<div>Usage</div><div><b>' + ev.length + '</b> requests (' + okN + ' ok) · <b>' + tok.toLocaleString() + '</b> tokens · last ' + ago(last) + '</div>' +
    '<div>Created</div><div>' + esc(new Date(a.created_at).toLocaleDateString()) + '</div></div>' +
    (mine ? '<label>System prompt</label><pre style="white-space:pre-wrap;background:var(--panel2);padding:10px;border-radius:10px;border:1px solid var(--line)">' + esc(a.system_prompt || '(none)') + '</pre>' : ''),
    (mine ? [{ label: '🗑️ Delete', danger: true, onClick: async function (close) { if (!confirm('Delete ' + a.name + '?')) return; var r = await S.sb.from('agents').delete().eq('id', a.id); if (r.error) toast(r.error.message, true); else { upsertList(S.agents, { eventType: 'DELETE', old: { id: a.id } }); close(); rerenderSoft(); } } },
      { label: '✏️ Edit', primary: true, onClick: function (close) { close(); openAgentDialog(a); } }] : (isAdmin() ? [{ label: '🗑️ Remove agent', danger: true, onClick: async function (close) { if (!confirm('Remove ' + a.name + '?')) return; var r = await S.sb.from('agents').delete().eq('id', a.id); if (r.error) toast(r.error.message, true); else { upsertList(S.agents, { eventType: 'DELETE', old: { id: a.id } }); close(); rerenderSoft(); } } }] : [])));
}

/* ---------------- usage ---------------- */
var usageTab = 'overview', usageDays = 30;
async function renderUsage() {
  var main = $('#main'); main.removeAttribute('data-key');
  main.innerHTML = '<div class="head stack">' + backBtn(wsPath('')) + '<div class="grow"><h2>📊 Usage</h2><div class="sub">From usage_events · tokens are provider-reported (or estimated ≈ chars/4 when the provider didn\'t say)</div></div>' +
    '<select id="u-days" style="width:auto"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select>' +
    '<div class="tabs" id="u-tabs">' + ['overview', 'people', 'rooms', 'agents', 'automations'].map(function (t) { return '<button data-t="' + t + '" class="' + (usageTab === t ? 'on' : '') + '">' + t.charAt(0).toUpperCase() + t.slice(1) + '</button>'; }).join('') + '</div></div><div class="body" id="u-body"><div class="empty">Loading…</div></div>';
  $('#u-days').value = String(usageDays);
  $('#u-days').onchange = function () { usageDays = +this.value; renderUsage(); };
  $$('#u-tabs button').forEach(function (b) { b.onclick = function () { usageTab = b.getAttribute('data-t'); renderUsage(); }; });
  var since = new Date(Date.now() - usageDays * 864e5).toISOString();
  var r = await S.sb.from('usage_events').select('*').eq('workspace_id', S.ws.id).gte('created_at', since).order('created_at', { ascending: false }).limit(10000);
  var ev = r.data || []; var body = $('#u-body'); if (!body) return;
  var tot = { n: ev.length, tok: 0, est: 0, fail: 0 };
  ev.forEach(function (e) { tot.tok += e.prompt_tokens + e.completion_tokens; if (e.estimated) tot.est++; if (!e.ok) tot.fail++; });
  function group(keyFn, labelFn) {
    var g = {}; ev.forEach(function (e) { var k = keyFn(e); if (k == null) return; var x = g[k] = g[k] || { k: k, n: 0, p: 0, c: 0, fail: 0 }; x.n++; x.p += e.prompt_tokens; x.c += e.completion_tokens; if (!e.ok) x.fail++; });
    var rows = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.n - a.n; });
    return '<table><tr><th>' + labelFn.title + '</th><th>Requests</th><th>Prompt tok</th><th>Output tok</th><th>Errors</th></tr>' + (rows.map(function (x) { return '<tr><td>' + labelFn(x.k) + '</td><td><b>' + x.n + '</b></td><td>' + x.p.toLocaleString() + '</td><td>' + x.c.toLocaleString() + '</td><td>' + (x.fail || '') + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="muted">No data yet</td></tr>') + '</table>';
  }
  var person = function (k) { return esc(profileOf(k).display_name); }; person.title = 'Person (key owner)';
  var roomL = function (k) { var r_ = roomOf(k); return r_ ? '#' + esc(r_.name) : '(deleted)'; }; roomL.title = 'Room';
  var agentL = function (k) { var a = agentOf(k); return a ? avatarHtml(a.avatar, 'sm agent').replace('class="av', 'style="display:inline-flex;vertical-align:middle;margin-right:6px" class="av') + esc(a.name) : '(private/deleted)'; }; agentL.title = 'Agent';
  var autoL = function (k) { var a = S.automations.find(function (x) { return x.id === k; }); return a ? '⏰ ' + esc(a.name) : '(deleted)'; }; autoL.title = 'Automation';
  var html = '';
  if (usageTab === 'overview') {
    var days = []; for (var i = Math.min(usageDays, 30) - 1; i >= 0; i--) { var d = new Date(Date.now() - i * 864e5); days.push({ key: d.toDateString(), label: d.getDate(), n: 0 }); }
    ev.forEach(function (e) { var k = new Date(e.created_at).toDateString(); var d = days.find(function (x) { return x.key === k; }); if (d) d.n++; });
    var mx = Math.max.apply(null, days.map(function (d) { return d.n; }).concat([1]));
    var kinds = {}; ev.forEach(function (e) { kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
    html = '<div class="grid"><div class="card"><div class="muted small">Requests</div><div class="stat">' + tot.n + '</div></div><div class="card"><div class="muted small">Tokens (est. + reported)</div><div class="stat">' + tot.tok.toLocaleString() + '</div></div>' +
      '<div class="card"><div class="muted small">Errors</div><div class="stat">' + tot.fail + '</div></div><div class="card"><div class="muted small">Cost on free tiers</div><div class="stat v420">$0</div><div class="tiny muted">bring-your-own free keys</div></div></div>' +
      '<div class="card" style="margin-top:12px"><b>Daily requests</b><div class="bars">' + days.map(function (d) { return '<div class="bar" title="' + d.key + ': ' + d.n + '" style="height:' + Math.round(d.n / mx * 100) + '%"></div>'; }).join('') + '</div><div class="row tiny muted" style="justify-content:space-between"><span>' + days[0].key + '</span><span>today</span></div></div>' +
      '<div class="card" style="margin-top:12px"><b>By kind</b><div class="row wrap" style="margin-top:8px">' + (Object.keys(kinds).map(function (k) { return '<span class="pill green">' + esc(k) + ': ' + kinds[k] + '</span>'; }).join('') || '<span class="muted">No AI calls yet</span>') + '</div><p class="tiny muted">' + tot.est + ' of ' + tot.n + ' events have estimated tokens.</p></div>';
  } else if (usageTab === 'people') html = '<div class="card">' + group(function (e) { return e.user_id; }, person) + '</div>';
  else if (usageTab === 'rooms') html = '<div class="card">' + group(function (e) { return e.room_id; }, roomL) + '</div>';
  else if (usageTab === 'agents') html = '<div class="card">' + group(function (e) { return e.agent_id; }, agentL) + '</div>';
  else html = '<div class="card">' + group(function (e) { return e.automation_id; }, autoL) + '</div>';
  body.innerHTML = '<div style="max-width:960px;margin:0 auto">' + html + '</div>';
}

/* ---------------- settings ---------------- */
function renderSettings() {
  var main = $('#main'); main.removeAttribute('data-key');
  var st = AI.getSettings();
  main.innerHTML = '<div class="head">' + backBtn(wsPath('')) + '<div class="grow"><h2>⚙️ Settings</h2><div class="sub">Bizzle Huddle <span class="v420">v4.20</span> · build ' + BUILD + '</div></div></div>' +
    '<div class="body"><div style="max-width:720px;margin:0 auto">' +
    '<div class="card"><b>Your profile</b><div class="row" style="margin-top:8px"><div id="s-av">' + avatarHtml(S.profile.avatar) + '</div><div class="grow"><label style="margin-top:0">Display name</label><input id="s-name" maxlength="40" value="' + esc(S.profile.display_name) + '"></div></div>' +
    '<label>Avatar emoji</label><div class="emoji-row" id="s-emojis">' + ['🙂', '😎', '🦄', '🐻', '🐼', '🦁', '🐯', '🐵', '👽', '🧙', '🧑‍🚀', '🥷', '🌈', '🍕'].map(function (e) { return '<button class="' + (e === S.profile.avatar ? 'on' : '') + '">' + e + '</button>'; }).join('') + '</div>' +
    '<div class="row" style="margin-top:12px"><button class="btn primary" id="s-save">Save profile</button></div></div>' +
    '<div class="card" style="margin-top:12px"><b>🧠 AI</b><p class="muted small">Provider keys, default model, temperature, max tokens, system prompt and color themes.</p><button class="btn primary" id="s-ai">🧠 Advanced AI Settings</button></div>' +
    '<div class="card" style="margin-top:12px"><b>🎨 Theme</b>' + themeRow(st.theme) + '</div>' +
    '<div class="card" style="margin-top:12px"><b>🎟️ Invite</b>' + inviteBox(inviteLink()) + '</div>' +
    '<div class="card" style="margin-top:12px"><b>🔌 Supabase connection</b><div class="kv" style="margin-top:8px"><div>Project URL</div><div style="word-break:break-all">' + esc(S.conn.url) + '</div><div>Key</div><div>anon public · ' + esc(S.conn.key.slice(0, 10)) + '… (public-safe, RLS-protected)</div><div>Signed in as</div><div>' + esc(S.user.email || '') + '</div><div>Workspace role</div><div>' + esc(S.role) + '</div></div>' +
    '<div class="row wrap" style="margin-top:10px"><button class="btn" id="s-conn">Change connection</button><button class="btn" id="s-notif">🔔 Enable notifications</button><button class="btn" id="s-update">🔄 Check for update</button><button class="btn danger" id="s-out">Sign out</button></div>' +
    (isAdmin() ? '<div class="row wrap" style="margin-top:10px"><label style="margin:0">Workspace name</label><input id="s-wsname" value="' + esc(S.ws.name) + '" style="max-width:260px"><button class="btn sm" id="s-wssave">Rename</button></div>' : '') + '</div>' +
    '<p class="tiny muted" style="text-align:center;margin:20px 0">Bizzle Huddle <span class="v420">v4.20</span> — free-first, nothing fake. Inspired by the multiplayer-agents idea; original code. Owner: Nunya Bizz.</p></div></div>';
  var av = S.profile.avatar;
  $$('#s-emojis button').forEach(function (b) { b.onclick = function () { av = b.textContent; $$('#s-emojis button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); $('#s-av').innerHTML = avatarHtml(av); }; });
  $('#s-save').onclick = async function () { var r = await S.sb.from('profiles').update({ display_name: $('#s-name').value.trim() || S.profile.display_name, avatar: av }).eq('id', me()).select().single(); if (r.error) toast(r.error.message, true); else { S.profile = r.data; S.profiles[me()] = r.data; toast('Saved ✓'); renderRail(); if (S.chan) S.chan.track({ user_id: me(), name: S.profile.display_name, agents: myAgents().map(function (x) { return x.id; }), at: new Date().toISOString() }); } };
  $('#s-ai').onclick = openAISettings;
  bindThemeRow(main); bindInviteBox();
  $('#s-conn').onclick = function () { if (confirm('Disconnect from this Supabase project on this device?')) { S.sb.auth.signOut().finally(function () { localStorage.removeItem(LS.conn); location.hash = '#/'; location.reload(); }); } };
  $('#s-out').onclick = function () { S.sb.auth.signOut(); };
  $('#s-notif').onclick = function () { if (!('Notification' in window)) { toast('Notifications not supported here', true); return; } Notification.requestPermission().then(function (p) { toast('Notifications: ' + p); }); };
  $('#s-update').onclick = checkForUpdate;
  if ($('#s-wssave')) $('#s-wssave').onclick = async function () { var n = $('#s-wsname').value.trim(); if (!n) return; var r = await S.sb.from('workspaces').update({ name: n }).eq('id', S.ws.id); if (r.error) toast(r.error.message, true); else { S.ws.name = n; toast('Renamed'); renderShell(S.route); } };
}
var THEMES = [['neon', '🟢 Neon Lime', '#39ff14'], ['grape', '🟣 Cyber Grape', '#b26bff'], ['ocean', '🔵 Ocean Pulse', '#22d3ee'], ['solar', '🟠 Solar Flare', '#ff9f1c'], ['rose', '🌸 Rose Quartz', '#ff4f8b'], ['daylight', '☀️ Daylight Sage', '#2f7d32']];
function themeRow(cur) { return '<div class="theme-row" style="margin-top:8px">' + THEMES.map(function (t) { return '<button data-theme-pick="' + t[0] + '" class="' + (cur === t[0] ? 'on' : '') + '" style="color:' + t[2] + '">' + t[1] + '</button>'; }).join('') + '</div>'; }
function bindThemeRow(root) { $$('[data-theme-pick]', root).forEach(function (b) { b.onclick = function () { var s = AI.getSettings(); s.theme = b.getAttribute('data-theme-pick'); AI.setSettings(s); applyTheme(); $$('[data-theme-pick]', root).forEach(function (x) { x.classList.toggle('on', x === b); }); }; }); }
function applyTheme() { var t = AI.getSettings().theme || 'neon'; document.documentElement.setAttribute('data-theme', t); var mc = document.querySelector('meta[name=theme-color]'); if (mc) mc.content = t === 'daylight' ? '#f4f6f1' : '#0b0f0c'; }

function openAISettings() {
  var st = AI.getSettings(), keys = AI.getKeys();
  var provs = Object.keys(AI.PROVIDERS);
  var m = modal('🧠 Advanced AI Settings',
    '<div class="note">🔒 Keys are saved <b>only on this device</b> (localStorage). They are never written to Supabase, chat, or code. Your agents use them when someone @mentions them while your app is open. All three providers have free tiers.</div>' +
    provs.map(function (p) { var P = AI.PROVIDERS[p]; return '<label>' + esc(P.label) + ' key <a href="' + P.keyUrl + '" target="_blank" rel="noopener">get a free key ↗</a></label><div class="row"><input type="password" id="k-' + p + '" autocomplete="off" value="' + esc(keys[p] || '') + '" placeholder="paste key"><button class="btn sm" data-show="' + p + '">👁️</button><button class="btn sm" data-test="' + p + '">Test</button></div><div class="tiny muted" id="kt-' + p + '"></div>'; }).join('') +
    '<label>Default provider (Bizzy Bot + new agents)</label><select id="s-prov">' + provs.map(function (p) { return '<option value="' + p + '"' + (st.provider === p ? ' selected' : '') + '>' + esc(AI.PROVIDERS[p].label) + '</option>'; }).join('') + '</select>' +
    '<label>Default model (blank = Pro tier default)</label><div class="row"><select id="s-model"></select><button class="btn sm" id="s-model-ref">↻</button></div>' +
    '<label>Temperature: <span id="s-temp-v">' + st.temperature + '</span></label><input type="range" id="s-temp" min="0" max="1.5" step="0.05" value="' + st.temperature + '" style="width:100%">' +
    '<label>Max output tokens</label><input type="number" id="s-max" min="64" max="65536" value="' + st.maxTokens + '">' +
    '<label>Global system prompt (added to all your agents + Bizzy)</label><textarea id="s-sys" rows="3" placeholder="Answer like a friendly senior engineer.">' + esc(st.systemPrompt || '') + '</textarea>' +
    '<label>AI color theme</label>' + themeRow(st.theme),
    [{ label: 'Clear keys', danger: true, onClick: function () { if (confirm('Remove all AI keys from this device?')) { AI.setKeys({}); provs.forEach(function (p) { $('#k-' + p).value = ''; }); toast('Keys removed'); } } },
     { label: 'Save', primary: true, onClick: function (close) {
      var k = {}; provs.forEach(function (p) { var v = $('#k-' + p).value.trim(); if (v) k[p] = v; }); AI.setKeys(k);
      var s = AI.getSettings(); s.provider = $('#s-prov').value; s.model = $('#s-model').value; s.temperature = parseFloat($('#s-temp').value); s.maxTokens = Math.max(64, parseInt($('#s-max').value, 10) || 1024); s.systemPrompt = $('#s-sys').value; AI.setSettings(s);
      close(); toast('AI settings saved ✓');
    } }]);
  bindThemeRow(m.el);
  function fill(list) { var p = $('#s-prov').value; $('#s-model').innerHTML = '<option value="">Tier default (' + esc(AI.modelFor(p, 'Pro')) + ')</option>' + (list || AI.PROVIDERS[p].models.map(function (id) { return { id: id }; })).map(function (x) { return '<option' + (x.id === st.model ? ' selected' : '') + '>' + esc(x.id) + '</option>'; }).join(''); }
  fill(); $('#s-prov').onchange = function () { fill(); };
  $('#s-model-ref').onclick = function () { AI.listModels($('#s-prov').value).then(fill).catch(function (e) { toast(e.message, true); }); };
  $('#s-temp').oninput = function () { $('#s-temp-v').textContent = this.value; };
  $$('[data-show]', m.el).forEach(function (b) { b.onclick = function () { var i = $('#k-' + b.getAttribute('data-show')); i.type = i.type === 'password' ? 'text' : 'password'; }; });
  $$('[data-test]', m.el).forEach(function (b) { b.onclick = async function () {
    var p = b.getAttribute('data-test'), key = $('#k-' + p).value.trim(), out = $('#kt-' + p);
    if (!key) { out.textContent = 'Paste a key first.'; return; }
    out.textContent = 'Testing…';
    try { var r = await AI.chat({ provider: p, key: key, effort: 'Fast', messages: [{ role: 'user', text: 'Reply with exactly: OK' }], maxTokens: 256, temperature: 0 }); out.innerHTML = '✅ Works — ' + esc(r.model) + ' said “' + esc((r.text || '').slice(0, 40)) + '”'; }
    catch (e) { out.textContent = '❌ ' + e.message; }
  }; });
}

/* ---------------- Bizzy Bot helper bubble (memory in localStorage) ---------------- */
var APP_GUIDE = 'Bizzle Huddle v4.20 how-to guide:\n' +
  '- Connect: first run asks for your Supabase Project URL + anon public key (Project Settings > API Keys). Run schema.sql in the SQL editor first. Or open a friend\'s invite link.\n' +
  '- Sign up with email+password (or magic link in the browser). Name your workspace; a #welcome room is created. Share the invite link (Home, Settings, or Members > Invite member).\n' +
  '- Layout: left icon rail (Chat, Members, Approvals, Usage, AI settings, your profile), room/thread list with Home/Recent/Unread/@me tabs and search, and the chat. On phones, use the bottom bar and the green ← back buttons.\n' +
  '- Rooms: ＋ next to the workspace name. Private rooms are visible to added members and admins; add people from the 👥 button in the room header.\n' +
  '- Threads: hover/tap a message and press 🧵 to reply in a thread.\n' +
  '- Mentions: type @ to pick a person or agent. @me tab lists mentions of you. Unread counts show as red badges.\n' +
  '- Agents: Members > New agent (name, emoji/upload avatar, provider Gemini/Groq/OpenRouter, Fast/Pro/Max tier, model, system prompt, private, needs-approval). An agent replies when @mentioned, using its OWNER\'s key, only while the owner\'s app is open (green dot = online). Agents can @mention each other up to 3 hops; each agent answers max 6 times/minute.\n' +
  '- Keys: 🧠 Advanced AI Settings. Keys stay on the device, never in the database. Free keys: aistudio.google.com, console.groq.com, openrouter.ai.\n' +
  '- Approvals: agents with needs-approval send drafts to ✅ Approvals; the owner or an admin approves (posts it) or rejects.\n' +
  '- Apps tab: describe an app and pick an agent; it builds a single-file HTML draft; an admin presses Approve & publish. Apps run sandboxed and save shared data with huddle.get/set.\n' +
  '- Automations tab: schedule (every N minutes/hours or daily at a time), prompt, agent. Runs while any admin has the app open; history shows each run.\n' +
  '- Files tab: upload/download room files (Supabase Storage). 📎 and 🖼️ in the composer attach files/screenshots; agents with vision models can see images.\n' +
  '- Usage page: requests and tokens by person, room, agent, automation.\n' +
  '- Themes: Settings or AI settings. Copy buttons are on every agent reply.';
function bizzyMem() { return lsGet(LS.bizzy, { history: [], notes: [] }); }
function toggleBizzy() {
  var root = $('#bizzy-root'); if (!root) return;
  S.bizzyOpen = !S.bizzyOpen;
  if (!S.bizzyOpen) { root.innerHTML = ''; return; }
  root.innerHTML = '<div class="bizzy" role="dialog" aria-label="Bizzy Bot"><div class="modal-h"><button class="back" id="bz-back" aria-label="Back">←</button><h3>🐝 Bizzy Bot</h3><span class="v420 small">v4.20</span><button class="btn sm" id="bz-clear" title="Clear memory">🧹</button></div>' +
    '<div class="msgs" id="bz-msgs"></div><div class="chips" id="bz-chips"></div><div class="pending" id="bz-pend"></div>' +
    '<div class="composer" style="padding:6px 8px 8px"><div class="cbox"><textarea id="bz-ta" rows="1" placeholder="How do I…? (\'remember: …\' saves a note)"></textarea><div class="cbar"><button class="ib" id="bz-img" title="Attach screenshot">🖼️</button><span class="grow"></span><button class="send" id="bz-send">➤</button></div><input type="file" id="bz-file" accept="image/*" class="hidden"></div></div></div>';
  var img = null;
  function draw() {
    var mem = bizzyMem();
    var html = '<div class="bm a">Hi ' + esc(S.profile ? S.profile.display_name : '') + '! I\'m <b>Bizzy Bot</b> 🐝. Ask me how to do anything in Huddle. I remember our chat on this device' + (mem.notes.length ? ' and ' + mem.notes.length + ' note(s)' : '') + '.</div>';
    mem.history.forEach(function (h, i) { html += '<div class="bm ' + (h.role === 'user' ? 'u' : 'a') + '">' + md(h.text) + (h.role !== 'user' ? '<div><button class="copybtn" data-bzcopy="' + i + '">📋 Copy</button></div>' : '') + '</div>'; });
    $('#bz-msgs').innerHTML = html; $('#bz-msgs').scrollTop = 1e9;
    $$('[data-bzcopy]').forEach(function (b) { b.onclick = function () { copyText(bizzyMem().history[+b.getAttribute('data-bzcopy')].text); }; });
    $('#bz-chips').innerHTML = mem.history.length ? '' : ['How do I add an agent?', 'How do invites work?', 'Why is my agent offline?', 'How do apps get published?'].map(function (q) { return '<button>' + q + '</button>'; }).join('');
    $$('#bz-chips button').forEach(function (b) { b.onclick = function () { $('#bz-ta').value = b.textContent; send(); }; });
  }
  async function send() {
    var ta = $('#bz-ta'), text = ta.value.trim(); if (!text && !img) return;
    ta.value = ''; var mem = bizzyMem();
    var rem = text.match(/^remember:?\s+(.+)/i);
    if (rem) { mem.notes.push(rem[1]); mem.notes = mem.notes.slice(-20); mem.history.push({ role: 'user', text: text }, { role: 'assistant', text: '📝 Saved to my memory on this device.' }); lsSet(LS.bizzy, mem); draw(); return; }
    mem.history.push({ role: 'user', text: text + (img ? ' [screenshot attached]' : '') }); lsSet(LS.bizzy, mem); draw();
    var st = AI.getSettings(); var think = document.createElement('div'); think.className = 'bm a'; think.textContent = '🐝 thinking…'; $('#bz-msgs').appendChild(think);
    try {
      var hist = mem.history.slice(-12).map(function (h) { return { role: h.role, text: h.text }; });
      if (img) hist[hist.length - 1].images = [img];
      var res = await AI.chat({ provider: st.provider, model: st.model || null, effort: 'Fast', system: 'You are Bizzy Bot, the friendly in-app helper for Bizzle Huddle v4.20. Answer how-to questions about the app briefly and concretely, using this guide. If unsure, say so.\n\n' + APP_GUIDE + (mem.notes.length ? '\n\nUser notes to remember:\n- ' + mem.notes.join('\n- ') : '') + (st.systemPrompt ? '\n\n' + st.systemPrompt : ''), messages: hist, temperature: 0.4, maxTokens: Math.min(1500, st.maxTokens) });
      mem = bizzyMem(); mem.history.push({ role: 'assistant', text: res.text || '(no answer)' }); mem.history = mem.history.slice(-40); lsSet(LS.bizzy, mem);
      if (S.ws) logUsage({ kind: 'helper', provider: res.provider, model: res.model, prompt_tokens: res.promptTokens, completion_tokens: res.completionTokens, estimated: !!res.estimated });
    } catch (e) { mem = bizzyMem(); mem.history.push({ role: 'assistant', text: '⚠️ ' + e.message }); lsSet(LS.bizzy, mem); }
    img = null; $('#bz-pend').innerHTML = ''; draw();
  }
  $('#bz-send').onclick = send;
  $('#bz-ta').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#bz-back').onclick = toggleBizzy;
  $('#bz-clear').onclick = function () { if (confirm('Clear Bizzy\'s memory on this device?')) { lsSet(LS.bizzy, { history: [], notes: [] }); draw(); } };
  $('#bz-img').onclick = function () { $('#bz-file').click(); };
  $('#bz-file').onchange = async function () { var f = this.files[0]; if (!f) return; var data = await resizeImage(f, 1280); img = { mime: 'image/jpeg', base64: data.split(',')[1] }; $('#bz-pend').innerHTML = '<div class="pf"><img src="' + data + '">screenshot<button id="bz-rm">✕</button></div>'; $('#bz-rm').onclick = function () { img = null; $('#bz-pend').innerHTML = ''; }; };
  draw(); if (!isPhone()) $('#bz-ta').focus();
}

/* ---------------- service worker + updates ---------------- */
var swReg = null;
function registerSW() {
  if (!('serviceWorker' in navigator) || window.Capacitor || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js?v=' + BUILD).then(function (reg) {
    swReg = reg;
    reg.addEventListener('updatefound', function () {
      var nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(); });
    });
  }).catch(function (e) { console.warn('SW', e); });
  var reloaded = false, hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', function () { if (!hadController) { hadController = true; return; } if (reloaded) return; reloaded = true; location.reload(); });
}
function showUpdateBanner() {
  if ($('#upd')) return;
  var d = document.createElement('div'); d.id = 'upd'; d.className = 'toast'; d.style.pointerEvents = 'auto';
  d.innerHTML = '✨ New version ready <button class="btn sm primary" style="margin-left:8px">Reload</button>';
  $('#toasts').appendChild(d);
  $('button', d).onclick = function () { if (swReg && swReg.waiting) swReg.waiting.postMessage('skipWaiting'); else location.reload(); };
}
function checkForUpdate() { if (swReg) { swReg.update().then(function () { toast(swReg.waiting ? 'Update found' : 'You\'re on the latest (' + BUILD + ')'); if (swReg.waiting) showUpdateBanner(); }); } else toast('Build ' + BUILD + (window.Capacitor ? ' (app updates come as new APKs)' : '')); }

/* ---------------- test hooks (read-only helpers used by the automated tests) ---------------- */
window.__huddle = { S: S, md: md, parseMentions: parseMentions, buildSrcdoc: buildSrcdoc, rateOk: rateOk, inviteLink: function () { return inviteLink(); }, appInviteLink: function () { return appInviteLink(); }, version: VERSION, build: BUILD };

window.addEventListener('resize', debounce(function () { if ($('#shell')) renderSidebarOnly(); }, 250));
registerSW();
boot().catch(function (e) { console.error(e); renderFatal(e); });
})();
