"""Real hosted-Supabase end-to-end checks (two users, real project).
Env: HUDDLE_SUPABASE_URL, HUDDLE_SUPABASE_ANON_KEY (required); GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY
(optional, enables live agent replies); SUPABASE_ACCESS_TOKEN (optional, used ONLY for --cleanup).
Never prints secrets and takes no screenshots (the UI shows the project host).
Usage: python tests/real_supabase.py [base_url] [--cleanup]
Test users are huddle.rt.<stamp>.<name>@example.com; --cleanup removes only rows those test users created."""
import os, sys, json, time, random, string, urllib.request
from playwright.sync_api import sync_playwright

URL = os.environ.get('HUDDLE_SUPABASE_URL', '').rstrip('/'); KEY = os.environ.get('HUDDLE_SUPABASE_ANON_KEY', '')
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
BASE = ARGS[0] if ARGS else 'http://127.0.0.1:8080/'
CLEANUP = '--cleanup' in sys.argv
AIKEYS = {k: os.environ[e] for k, e in (('gemini', 'GEMINI_API_KEY'), ('groq', 'GROQ_API_KEY'), ('openrouter', 'OPENROUTER_API_KEY')) if os.environ.get(e)}
PROVIDER = next(iter(AIKEYS), None)
SECRETS = [s for s in [URL, KEY, os.environ.get('SUPABASE_ACCESS_TOKEN', '')] + list(AIKEYS.values()) if s]
res = []
def red(x):
    x = str(x)
    for s in SECRETS: x = x.replace(s, '<redacted>')
    return x
def check(area, name, ok, detail=''):
    d = red(detail); res.append((area, name, bool(ok), d))
    print(('PASS' if ok else 'FAIL'), area, '::', name, ('— ' + d[:200]) if (d and not ok) else '', flush=True)
def http(path, method='GET', body=None):
    req = urllib.request.Request(URL + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
def mgmt_sql(q):
    tok = os.environ['SUPABASE_ACCESS_TOKEN']; ref = URL.split('//')[1].split('.')[0]
    req = urllib.request.Request('https://api.supabase.com/v1/projects/%s/database/query' % ref, method='POST',
                                 data=json.dumps({'query': q}).encode(), headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'bizzle-huddle-tests'})
    with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read().decode())
ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
def section(area):
    def deco(fn):
        def run(*a, **k):
            if ONLY and area not in ONLY: return
            try: return fn(*a, **k)
            except Exception as e: check(area, 'section crashed', False, repr(e)[:300])
        return run
    return deco

if not URL or not KEY: print('env vars missing'); sys.exit(2)
STAMP = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
st, body = http('/auth/v1/settings'); s = json.loads(body) if st == 200 else {}
check('real', 'auth settings reachable with publishable key', st == 200, st)
autoconfirm = bool(s.get('mailer_autoconfirm'))
st, _ = http('/rest/v1/workspaces?select=id&limit=1'); schema = st == 200
check('real', 'schema applied (REST sees public.workspaces)', schema, st)
print('INFO Confirm email OFF =', autoconfirm, '| live AI provider:', PROVIDER or 'none', '| stamp', STAMP, flush=True)

def js(pg, expr, arg=None): return pg.evaluate(expr, arg)
def S(pg, expr): return pg.evaluate('() => { const S = window.__huddle.S; return ' + expr + '; }')
def goto_hash(pg, h): pg.evaluate('h => { location.hash = h; }', h); time.sleep(0.8)
def wait(pg, f, timeout=20000, arg=None): pg.wait_for_function(f, arg=arg, timeout=timeout)
def send(pg, text): pg.fill('#ta-main', text); pg.press('#ta-main', 'Enter')
def q1(pg, table, sel, filt):  # RLS-respecting read as that user
    return pg.evaluate('([t, s, f]) => { let q = window.__huddle.S.sb.from(t).select(s); for (const k in f) q = q.eq(k, f[k]); return q.then(r => r.error ? {error: r.error.message} : r.data); }', [table, sel, filt])

with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    errs = []
    def newpage():
        c = br.new_context(viewport={'width': 1280, 'height': 860}, permissions=['clipboard-read', 'clipboard-write'])
        q = c.new_page(); q.on('pageerror', lambda e: errs.append(str(e))); return q
    # connect screen (typed like a real user)
    A = newpage(); A.goto(BASE + '#/'); A.wait_for_selector('#c-url')
    A.fill('#c-url', URL); A.fill('#c-key', KEY); A.click('#c-save')
    if not schema:
        wait(A, '() => /tables are missing/.test(document.querySelector("#toasts").innerText)'); check('real', 'missing-schema message', True)
    else:
        A.wait_for_selector('#a-tabs', timeout=30000); check('connect', 'Connect screen accepts the real project (publishable key)', True)
        A.click('#a-tabs button[data-t=signup]'); A.fill('#a-name', 'Ann'); A.fill('#a-email', 'huddle.rt.%s.ann@example.com' % STAMP); A.fill('#a-pass', 'Rt-%s-pw!' % STAMP); A.click('#a-go')
        if not autoconfirm:
            time.sleep(5); check('auth', 'Confirm email ON: clear check-your-email message', 'Almost there' in A.inner_text('#a-msg') or 'authorized' in A.inner_text('#a-msg'))
        else:
            A.wait_for_selector('#o-name', timeout=30000); check('auth', 'sign-up (password) on real project -> onboarding', True)
            A.fill('#o-name', 'RT ' + STAMP); A.click('#o-go')
            wait(A, '() => window.__huddle && window.__huddle.S.ws', 30000); check('onboarding', 'workspace created', True)
            wait(A, '() => location.hash === "#/invite-team"', 30000); check('onboarding', 'step 2: invite-team screen', True)
            wsid = S(A, 'S.ws.id')
            wait(A, '() => window.__huddle.S.rooms.some(r => r.name === "welcome")', 15000); check('onboarding', 'auto Welcome room', True)
            welcome = S(A, 'S.rooms.find(r => r.name === "welcome").id')
            link = js(A, '() => window.__huddle.inviteLink()')
            check('invite', 'invite link carries url+key+code in the # fragment', '#/join?u=' in link and '&k=' in link and '&i=' in link)
            # B: fresh browser, opens the invite link first (the normal teammate path)
            B = newpage(); B.goto(link.replace('https://leehizzbt.github.io/bizzle-huddle/', BASE))
            B.wait_for_selector('#a-tabs', timeout=30000)
            check('invite', 'invite link pre-fills the connection (no typing)', 'You were invited' in B.inner_text('body'))
            B.click('#a-tabs button[data-t=signup]'); B.fill('#a-name', 'Bob'); B.fill('#a-email', 'huddle.rt.%s.bob@example.com' % STAMP); B.fill('#a-pass', 'Rt-%s-pw!' % STAMP); B.click('#a-go')
            wait(B, '() => window.__huddle && window.__huddle.S.ws', 30000)
            check('invite', 'B signs up and auto-joins the workspace', S(B, 'S.ws.id') == wsid)
            # C: already signed-in user opens an invite link inside the running app (the bug that was fixed)
            C = newpage(); C.goto(BASE + '#/'); C.wait_for_selector('#c-url'); C.fill('#c-url', URL); C.fill('#c-key', KEY); C.click('#c-save')
            C.wait_for_selector('#a-tabs', timeout=30000); C.click('#a-tabs button[data-t=signup]'); C.fill('#a-name', 'Cat'); C.fill('#a-email', 'huddle.rt.%s.cat@example.com' % STAMP); C.fill('#a-pass', 'Rt-%s-pw!' % STAMP); C.click('#a-go')
            C.wait_for_selector('#o-name', timeout=30000)
            C.goto(link.replace('https://leehizzbt.github.io/bizzle-huddle/', BASE))
            try: wait(C, 'ws => window.__huddle.S.ws && window.__huddle.S.ws.id === ws', 30000, wsid); check('invite', 'signed-in user opening the link joins too', True)
            except Exception as e: check('invite', 'signed-in user opening the link joins too', False, e)
            C.context.close()

            @section('realtime')
            def t_rt():
                goto_hash(A, '#/w/%s/r/%s' % (wsid, welcome)); goto_hash(B, '#/w/%s/r/%s' % (wsid, welcome))
                for nm, pg in (('A', A), ('B', B)):
                    try: pg.wait_for_selector('#ta-main', timeout=20000)
                    except Exception: print('DIAG', nm, red(pg.url), red(pg.inner_text('body'))[:400].replace('\n', ' | ')); raise
                bid, aid = S(B, 'S.user.id'), S(A, 'S.user.id')
                wait(A, 'id => !!window.__huddle.S.online[id]', 30000, bid); wait(B, 'id => !!window.__huddle.S.online[id]', 30000, aid)
                check('presence', 'both users see each other online', True)
                send(A, 'hello from Ann ' + STAMP)
                wait(B, 's => document.querySelector("#msgs").innerText.includes(s)', 20000, 'hello from Ann ' + STAMP); check('realtime', 'message A -> B live', True)
                B.fill('#ta-main', 'typing...')
                try: wait(A, '() => /typing/i.test(document.querySelector("#main").innerText)', 10000); check('typing', 'typing indicator reaches A', True)
                except Exception as e: check('typing', 'typing indicator reaches A', False, e)
                B.fill('#ta-main', ''); send(B, 'hi Ann ' + STAMP)
                wait(A, 's => document.querySelector("#msgs").innerText.includes(s)', 20000, 'hi Ann ' + STAMP); check('realtime', 'message B -> A live', True)
                # thread reply
                mid = js(A, 's => Object.values(window.__huddle.S.msgs).flat().find(m => (m.content||"").includes(s)).id', 'hi Ann ' + STAMP)
                goto_hash(A, '#/w/%s/r/%s/t/%s' % (wsid, welcome, mid)); A.wait_for_selector('#ta-thread')
                A.fill('#ta-thread', 'thread reply ' + STAMP); A.press('#ta-thread', 'Enter')
                wait(B, 'm => Object.values(window.__huddle.S.threadsByRoom).some(t => t && t[m])', 20000, mid); check('threads', 'thread reply delivered live (B thread index)', True)
                # @mention person -> unread/mention for B in another room
                goto_hash(A, '#/w/%s/r/%s' % (wsid, welcome)); goto_hash(B, '#/w/%s/members' % wsid)
                send(A, '@Bob ping ' + STAMP)
                wait(B, 'r => (window.__huddle.S.unread[r] || {}).mentions > 0', 20000, welcome); check('mentions', '@mention counted for B live', True)
            t_rt()

            gid = None
            @section('agents')
            def t_agents():
                nonlocal_ = {}
                if not PROVIDER: check('agents', 'live agent reply (no free AI key in env)', False, 'skipped: no key'); return
                A.evaluate('k => localStorage.setItem("bh.aiKeys", JSON.stringify(k))', AIKEYS)
                goto_hash(A, '#/w/%s/members' % wsid); A.click('#m-new-agent'); A.wait_for_selector('#ag-name')
                A.fill('#ag-name', 'Gem'); A.fill('#ag-spec', 'Real test agent'); A.select_option('#ag-prov', PROVIDER); A.click('#ag-tier button[data-t=Fast]')
                A.fill('#ag-sys', 'You are Gem. Reply in under 20 words.'); A.click('.modal-f .btn.primary')
                wait(A, '() => window.__huddle.S.agents.some(a => a.name === "Gem")'); g = S(A, 'S.agents.find(a => a.name === "Gem").id'); globals()['GID'] = g
                check('agents', 'agent created (row saved, no key in it)', True)
                goto_hash(A, '#/w/%s/r/%s' % (wsid, welcome)); goto_hash(B, '#/w/%s/r/%s' % (wsid, welcome))
                wait(B, '() => window.__huddle.S.agents.some(a => a.name === "Gem")', 15000)
                send(B, '@Gem what is 2+2? Just the number. ' + STAMP)
                FIND = '''st => { const all = Object.values(window.__huddle.S.msgs).flat(); const q = all.find(m => !m.agent_id && (m.content||'').includes('what is 2+2') && (m.content||'').includes(st));
                  if (!q) return null; const r = all.find(m => m.agent_id && m.meta && m.meta.reply_to === q.id); return r ? r.content : null; }'''
                wait(B, FIND, 90000, STAMP); txt = B.evaluate(FIND, STAMP)
                check('agents', "B @mentions A's agent -> live reply via A's key (%s)" % PROVIDER, not txt.startswith('⚠️') and '4' in txt, txt[:120])
                ag = q1(B, 'agents', '*', {'id': g})
                check('security', 'AI key not stored in the agents row', all(v not in json.dumps(ag) for v in AIKEYS.values()))
                ue = q1(A, 'usage_events', 'id,prompt_tokens,completion_tokens', {'agent_id': g})
                check('usage', 'usage_event recorded with tokens', isinstance(ue, list) and len(ue) >= 1 and (ue[0]['prompt_tokens'] or 0) > 0, ue)
            t_agents()
            GID = globals().get('GID')

            @section('approvals')
            def t_appr():
                if not PROVIDER: check('approvals', 'approval flow (needs AI key)', False, 'skipped: no key'); return
                goto_hash(A, '#/w/%s/members' % wsid); A.click('#m-new-agent'); A.wait_for_selector('#ag-name')
                A.fill('#ag-name', 'Careful'); A.select_option('#ag-prov', PROVIDER); A.click('#ag-tier button[data-t=Fast]'); A.fill('#ag-sys', 'You are Careful. Reply in under 12 words.'); A.check('#ag-appr'); A.click('.modal-f .btn.primary')
                wait(A, '() => window.__huddle.S.agents.some(a => a.name === "Careful")'); cid = S(A, 'S.agents.find(a => a.name === "Careful").id')
                goto_hash(B, '#/w/%s/r/%s' % (wsid, welcome)); send(B, '@Careful greet the team ' + STAMP)
                wait(A, 'id => window.__huddle.S.approvals.some(a => a.agent_id === id && a.status === "pending")', 90000, cid)
                check('approvals', 'needs-approval reply lands in Approvals, not the room', not any(m.get('agent_id') == cid for m in q1(B, 'messages', 'agent_id', {'room_id': welcome})))
                apid = js(A, 'id => window.__huddle.S.approvals.find(a => a.agent_id === id && a.status === "pending").id', cid)
                err = js(B, 'id => window.__huddle.S.sb.rpc("decide_approval", {p_id: id, p_approve: true}).then(r => r.error && r.error.message)', apid)
                check('approvals', 'non-owner cannot approve (RPC/RLS)', bool(err), err)
                goto_hash(A, '#/w/%s/approvals' % wsid); A.click('[data-approve="%s"]' % apid)
                wait(B, 'id => Object.values(window.__huddle.S.msgs).flat().some(m => m.agent_id === id)', 30000, cid)
                check('approvals', 'owner approves -> posted to room for everyone', True)
            t_appr()

            @section('apps')
            def t_apps():
                html = '''<!doctype html><html><body><h1 id=v>?</h1><button id=b>+1</button><p id=iso>?</p><script>
async function show(){ var v = await huddle.get('count'); document.getElementById('v').textContent = v == null ? 0 : v; }
document.getElementById('b').onclick = async function(){ var v = (await huddle.get('count')) || 0; await huddle.set('count', v + 1); show(); };
huddle.onChange(function(k, v){ if (k === 'count') document.getElementById('v').textContent = v; });
try { parent.document.title; document.getElementById('iso').textContent = 'LEAK'; } catch (e) { document.getElementById('iso').textContent = 'isolated'; }
show();</script></body></html>'''
                ins = js(B, '([ws, room, html]) => window.__huddle.S.sb.from("apps").insert({workspace_id: ws, room_id: room, name: "RT Counter", html: html, status: "draft", created_by: window.__huddle.S.user.id}).select("id").single().then(r => r.error ? "ERR " + r.error.message : r.data.id)', [wsid, welcome, html])
                check('apps', 'member creates a draft app', not str(ins).startswith('ERR'), ins)
                perr = js(B, 'id => window.__huddle.S.sb.from("apps").update({status: "published"}).eq("id", id).then(r => r.error && r.error.message)', ins)
                check('apps', 'member cannot publish (DB trigger)', bool(perr), perr)
                goto_hash(A, '#/w/%s/r/%s/apps' % (wsid, welcome)); A.wait_for_selector('[data-publish="%s"]' % ins, timeout=20000); A.click('[data-publish="%s"]' % ins)
                t0 = time.time(); row = None
                while time.time() - t0 < 15:
                    row = q1(A, 'apps', 'status,approved_by', {'id': ins})
                    if row and row[0]['status'] == 'published': break
                    time.sleep(1)
                check('apps', 'admin publishes the app', row and row[0]['status'] == 'published' and row[0]['approved_by'], row)
                goto_hash(B, '#/w/%s/r/%s/apps' % (wsid, welcome)); B.wait_for_selector('[data-open-app="%s"]' % ins, timeout=20000)
                B.click('[data-open-app="%s"]' % ins); B.wait_for_selector('#appframe'); time.sleep(2)
                check('apps', 'sandbox="allow-scripts" only', B.get_attribute('#appframe', 'sandbox') == 'allow-scripts')
                fb = B.frame_locator('#appframe'); check('apps', 'app isolated from parent DOM', fb.locator('#iso').inner_text() == 'isolated')
                goto_hash(A, '#/w/%s/r/%s/apps' % (wsid, welcome)); A.click('[data-open-app="%s"]' % ins); A.wait_for_selector('#appframe'); time.sleep(2)
                fa = A.frame_locator('#appframe')
                fb.locator('#b').click(); time.sleep(1.5); fb.locator('#b').click()
                try: A.wait_for_function('() => document.querySelector("#appframe") && true', timeout=1000)
                except Exception: pass
                t0 = time.time()
                while time.time() - t0 < 15 and fa.locator('#v').inner_text() != '2': time.sleep(0.5)
                check('apps', 'KV bridge write by B shows live in A (realtime)', fa.locator('#v').inner_text() == '2', fa.locator('#v').inner_text())
                A.keyboard.press('Escape'); B.keyboard.press('Escape')
            t_apps()

            @section('automations')
            def t_auto():
                if not GID: check('automations', 'automation run (needs AI agent)', False, 'skipped: no key'); return
                goto_hash(A, '#/w/%s/r/%s/automations' % (wsid, welcome)); A.wait_for_selector('#au-name')
                A.fill('#au-name', 'RT fact'); A.select_option('#au-agent', GID); A.fill('#au-prompt', 'Say one fun fact in under 15 words.')
                A.fill('#au-n', '1'); A.select_option('#au-unit', '1'); A.click('#au-go')
                wait(A, '() => window.__huddle.S.automations.some(a => a.name === "RT fact")'); auid = S(A, 'S.automations.find(a => a.name === "RT fact").id')
                check('automations', 'automation saved', True)
                nb = js(B, 'ws => window.__huddle.S.sb.rpc("claim_due_automations", {p_ws: ws}).then(r => (r.data || []).length)', wsid)
                check('automations', 'non-admin cannot claim', nb == 0, nb)
                t0 = time.time(); runs = []
                while time.time() - t0 < 120:
                    runs = q1(A, 'automation_runs', 'status', {'automation_id': auid})
                    if isinstance(runs, list) and any(r['status'] == 'ok' for r in runs): break
                    time.sleep(4)
                check('automations', 'scheduled run claimed by admin app and answered by agent', isinstance(runs, list) and any(r['status'] == 'ok' for r in runs), runs)
                A.click('[data-run="%s"]' % auid) if A.locator('[data-run="%s"]' % auid).count() else None
                t0 = time.time()
                while time.time() - t0 < 90:
                    runs = q1(A, 'automation_runs', 'status', {'automation_id': auid})
                    if sum(1 for r in runs if r['status'] == 'ok') >= 2: break
                    time.sleep(4)
                check('automations', '"Run now" adds a second ok run (history)', sum(1 for r in runs if r['status'] == 'ok') >= 2, runs)
                js(A, 'id => window.__huddle.S.sb.from("automations").update({enabled: false}).eq("id", id)', auid)
            t_auto()

            @section('files')
            def t_files():
                path = '/tmp/huddle-rt-%s.txt' % STAMP; open(path, 'w').write('hello from Bob ' + STAMP)
                goto_hash(B, '#/w/%s/r/%s/files' % (wsid, welcome)); B.wait_for_selector('#f-in', state='attached'); B.set_input_files('#f-in', path)
                t0 = time.time(); rows = []
                while time.time() - t0 < 20:
                    rows = q1(A, 'files', 'name,path', {'room_id': welcome})
                    if isinstance(rows, list) and any(r['name'] == os.path.basename(path) for r in rows): break
                    time.sleep(1)
                f = [r for r in rows if r['name'] == os.path.basename(path)] if isinstance(rows, list) else []
                check('files', 'upload to real Storage + files row', bool(f), rows)
                if f:
                    content = js(A, 'p => window.__huddle.S.sb.storage.from("huddle-files").download(p).then(r => r.data ? r.data.text() : "ERR " + (r.error && r.error.message))', f[0]['path'])
                    check('files', 'other member downloads identical bytes', content == 'hello from Bob ' + STAMP, content[:80])
                    goto_hash(A, '#/w/%s/r/%s/files' % (wsid, welcome)); time.sleep(2)
                    check('files', 'file listed for the other member', os.path.basename(path) in A.inner_text('#main'))
                    rm = js(B, 'p => window.__huddle.S.sb.storage.from("huddle-files").remove([p]).then(r => r.error ? "ERR " + r.error.message : (r.data || []).length)', f[0]['path'])
                    check('files', 'uploader can delete the stored object (cleanup)', rm == 1, rm)
            t_files()
    check('console', 'no uncaught JS errors', not errs, errs[:3])
    br.close()

p_ = sum(1 for r in res if r[2]); print('\nTOTAL %d  PASS %d  FAIL %d' % (len(res), p_, len(res) - p_), flush=True)
os.makedirs(os.path.join(os.path.dirname(__file__), '..', 'test-shots'), exist_ok=True)
json.dump({'stamp': STAMP, 'results': [dict(area=a, name=n, ok=o, detail=d) for a, n, o, d in res]}, open(os.path.join(os.path.dirname(__file__), '..', 'test-shots', 'results-real.json'), 'w'), indent=1)

if CLEANUP and os.environ.get('SUPABASE_ACCESS_TOKEN'):
    # only rows created by this suite's test users (emails huddle.rt.* / huddle.test.* / huddle.dbg.* @example.com)
    who = "select id from auth.users where email ~ '^huddle\\.(rt|test|dbg)\\.[a-z0-9.]+@example\\.com$'"
    out = mgmt_sql("with u as (%s) select (select count(*) from u) users, (select count(*) from public.workspaces where created_by in (select id from u)) workspaces" % who)
    print('CLEANUP before:', out, flush=True)
    mgmt_sql("delete from public.workspaces where created_by in (%s)" % who)
    mgmt_sql("delete from auth.users where id in (%s)" % who)
    out = mgmt_sql("with u as (%s) select (select count(*) from u) users, (select count(*) from public.workspaces where created_by in (select id from u)) workspaces, (select count(*) from public.profiles where id not in (select id from auth.users)) orphan_profiles" % who)
    print('CLEANUP after:', out, flush=True)
