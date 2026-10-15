"""Bizzle Huddle v4.20 end-to-end tests against a LOCAL Supabase stack (supabase start).
Two/three browser contexts = different real users. Real Gemini calls if GEMINI_API_KEY is set (never printed).
Run: BASE=http://127.0.0.1:8080/ .venv/bin/python tests/e2e.py"""
import os, sys, time, json, subprocess, base64, traceback
from playwright.sync_api import sync_playwright

ENV = {}
for line in open('/workspace/.huddle-local-sb.env'):
    k, _, v = line.strip().partition('='); ENV[k] = v.strip('"')
BASE = os.environ.get('BASE', 'http://127.0.0.1:8080/')
SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'test-shots')
os.makedirs(SHOTS, exist_ok=True)
GEM = os.environ.get('GEMINI_API_KEY', '')
RESULTS = []
STAMP = str(int(time.time()))[-6:]

def check(area, name, ok, detail=''):
    RESULTS.append({'area': area, 'name': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS ' if ok else 'FAIL ') + area + ' :: ' + name + ((' — ' + str(detail)[:200]) if detail and not ok else ''), flush=True)

def sql(q):
    r = subprocess.run(['docker', 'exec', '-i', 'supabase_db_bizzle-huddle', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', q], capture_output=True, text=True)
    return r.stdout.strip()

def sql_wait(q, pred, timeout=12):
    t0 = time.time(); v = sql(q)
    while not pred(v) and time.time() - t0 < timeout:
        time.sleep(0.5); v = sql(q)
    return v

def shot(pg, name):
    pg.screenshot(path=os.path.join(SHOTS, name + '.png'))

def section(area):
    def deco(fn):
        def run(*a, **k):
            try: return fn(*a, **k)
            except Exception as e:
                check(area, 'section crashed', False, repr(e)[:250]); traceback.print_exc()
        return run
    return deco

def new_user_page(browser, w=1440, h=900, mobile=False):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile,
                              permissions=['clipboard-read', 'clipboard-write'])
    pg = ctx.new_page()
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('console', lambda m: pg.errs.append(m.text) if m.type == 'error' else None)
    return ctx, pg

def S(pg, expr):
    return pg.evaluate('() => { const S = window.__huddle.S; return ' + expr + '; }')

def goto_hash(pg, h):
    pg.evaluate('h => { location.hash = h; }', h); time.sleep(0.6)

def wait(pg, js, timeout=15000, arg=None):
    pg.wait_for_function(js, arg=arg, timeout=timeout)

def signup(pg, name, email, invite=None):
    pg.goto(invite or BASE)
    if not invite:
        pg.wait_for_selector('#c-url', timeout=15000)
        pg.fill('#c-url', ENV['API_URL']); pg.fill('#c-key', ENV['ANON_KEY']); pg.click('#c-save')
    pg.wait_for_selector('#a-tabs', timeout=20000)
    pg.click('#a-tabs button[data-t=signup]')
    pg.fill('#a-name', name); pg.fill('#a-email', email); pg.fill('#a-pass', 'password123'); pg.click('#a-go')

def room_id(pg, name):
    return pg.evaluate('n => (window.__huddle.S.rooms.find(r => r.name === n) || {}).id', name)

def agent_id(pg, name):
    return pg.evaluate('n => (window.__huddle.S.agents.find(a => a.name === n) || {}).id', name)

def send(pg, text, which='main'):
    pg.fill('#ta-' + which, text); pg.press('#ta-' + which, 'Enter')

def create_agent(pg, name, provider='gemini', tier='Fast', system='', private=False, approval=False, emoji='🧠'):
    goto_hash(pg, '#/w/%s/members' % S(pg, 'S.ws.id'))
    pg.click('#m-new-agent'); pg.wait_for_selector('#ag-name')
    pg.click('#ag-emojis button:has-text("%s")' % emoji)
    pg.fill('#ag-name', name); pg.fill('#ag-spec', 'Test agent')
    pg.select_option('#ag-prov', provider)
    pg.click('#ag-tier button[data-t=%s]' % tier)
    pg.fill('#ag-sys', system)
    if private: pg.check('#ag-priv')
    if approval: pg.check('#ag-appr')
    pg.click('.modal-f .btn.primary')
    wait(pg, 'n => window.__huddle.S.agents.some(a => a.name === n)', arg=name)

def msgs_text(pg, sel='#msgs'):
    return pg.evaluate('s => { const e = document.querySelector(s); return e ? e.innerText : ""; }', sel)

def main():
    # clean slate on the LOCAL test database only
    sql('truncate public.workspaces cascade'); sql('delete from auth.users'); sql("delete from storage.objects where bucket_id='huddle-files'")
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctxA, A = new_user_page(browser)
        ctxB, B = new_user_page(browser)
        emA, emB, emC = 'ace%s@test.local' % STAMP, 'bea%s@test.local' % STAMP, 'cy%s@test.local' % STAMP
        st = {}

        @section('connect')
        def t_connect():
            A.goto(BASE); A.wait_for_selector('#c-url', timeout=15000)
            check('connect', 'first-run Connect screen shows', A.is_visible('#c-key'))
            check('connect', 'explains anon key is public-safe/RLS', 'public-safe' in A.inner_text('.note') and 'Row Level Security' in A.inner_text('.note'))
            check('connect', 'back button on connect screen', A.is_visible('.back'))
            shot(A, '01_connect_1440')
            fake = 'x.' + base64.urlsafe_b64encode(json.dumps({'role': 'service_role'}).encode()).decode().rstrip('=') + '.y' + 'z' * 30
            A.fill('#c-url', ENV['API_URL']); A.fill('#c-key', fake); A.click('#c-save'); time.sleep(0.5)
            check('connect', 'rejects a service_role (secret) key', 'SECRET' in A.inner_text('#toasts'))
            A.fill('#c-key', 'not-a-real-key-but-long-enough-123'); A.click('#c-save'); time.sleep(1.5)
            check('connect', 'bad anon key is rejected with a message', A.is_visible('#c-save') and len(A.inner_text('#toasts')) > 0)
            A.fill('#c-key', ENV['ANON_KEY']); A.click('#c-save')
            A.wait_for_selector('#a-tabs', timeout=15000)
            conn = A.evaluate("() => JSON.parse(localStorage.getItem('bh.conn'))")
            check('connect', 'URL + anon key saved in localStorage only', conn and conn['url'] == ENV['API_URL'])
            check('auth', 'auth screen has back button + magic link tab', A.is_visible('.back') and A.is_visible('#a-tabs button[data-t=magic]'))
            shot(A, '02_auth_1440')
        t_connect()

        @section('onboarding')
        def t_onboard():
            A.click('#a-tabs button[data-t=signup]')
            A.fill('#a-name', 'Ace'); A.fill('#a-email', emA); A.fill('#a-pass', 'password123'); A.click('#a-go')
            A.wait_for_selector('#o-name', timeout=20000)
            check('onboarding', 'sign up -> "Name your workspace"', True)
            check('onboarding', 'onboard has back button', A.is_visible('.back'))
            shot(A, '03_onboard_name_1440')
            A.fill('#o-name', 'Bizzle HQ'); A.click('#o-go')
            A.wait_for_selector('#inv-link', timeout=20000)
            link = A.inner_text('#inv-link'); st['invite'] = link
            check('onboarding', 'invite link carries URL+key+code in #fragment', '#/join?' in link and 'u=' in link and 'k=' in link and '&i=' in link and link.index('#') < link.index('k='))
            shot(A, '04_onboard_invite_1440')
            A.click('#i-go'); A.wait_for_selector('#ta-main', timeout=15000); time.sleep(1)
            check('onboarding', 'auto #welcome room with welcome message', 'Welcome to' in msgs_text(A) and S(A, "S.rooms.some(r => r.name === 'welcome')"))
            check('onboarding', 'creator is admin', S(A, 'S.role') == 'admin')
        t_onboard()

        @section('invite')
        def t_invite():
            # B opens the invite link fresh (no prior connection) — one tap
            link = st['invite'].replace('https://leehizzbt.github.io/bizzle-huddle/', BASE)
            B.goto(link); B.wait_for_selector('#a-tabs', timeout=20000)
            check('invite', 'invite link auto-fills connection (no Connect screen)', B.is_visible('#a-tabs'))
            check('invite', 'shows "you were invited" note', 'invited' in B.inner_text('.card'))
            check('invite', 'fragment stripped from address bar', 'k=' not in B.url)
            B.click('#a-tabs button[data-t=signup]')
            B.fill('#a-name', 'Bea'); B.fill('#a-email', emB); B.fill('#a-pass', 'password123'); B.click('#a-go')
            B.wait_for_selector('#shell', timeout=20000); time.sleep(1.5)
            check('invite', 'B auto-joined the same workspace as member', S(B, 'S.ws && S.ws.name') == 'Bizzle HQ' and S(B, 'S.role') == 'member')
        t_invite()

        welcome = room_id(A, 'welcome')
        wsid = S(A, 'S.ws.id')
        goto_hash(A, '#/w/%s/r/%s' % (wsid, welcome)); goto_hash(B, '#/w/%s/r/%s' % (wsid, welcome))
        A.wait_for_selector('#ta-main'); B.wait_for_selector('#ta-main'); time.sleep(2)

        @section('presence')
        def t_presence():
            bid = S(B, 'S.user.id'); aid = S(A, 'S.user.id'); st['bid'] = bid; st['aid'] = aid
            wait(A, 'id => !!window.__huddle.S.online[id]', 20000, bid)
            check('presence', 'A sees B online (presence)', True)
            wait(B, 'id => !!window.__huddle.S.online[id]', 20000, aid)
            check('presence', 'B sees A online', True)
            check('presence', 'green presence dot rendered for B in A sidebar', A.locator('[data-online-for="%s"].on' % bid).count() > 0)
        t_presence()

        @section('realtime')
        def t_realtime():
            send(A, 'Hey Bea, realtime check ' + STAMP)
            t0 = time.time()
            wait(B, 's => document.querySelector("#msgs").innerText.includes(s)', 10000, 'realtime check ' + STAMP)
            check('realtime', 'A->B message arrives live (%.1fs)' % (time.time() - t0), True)
            send(B, 'Got it Ace ' + STAMP)
            wait(A, 's => document.querySelector("#msgs").innerText.includes(s)', 10000, 'Got it Ace ' + STAMP)
            check('realtime', 'B->A message arrives live', True)
            # typing indicator
            B.fill('#ta-main', 'typing...'); B.type('#ta-main', 'x')
            try:
                wait(A, '() => document.querySelector("#typing-main").innerText.includes("Bea is typing")', 6000)
                check('typing', 'A sees "Bea is typing…" (broadcast)', True); shot(A, '05_typing_1440')
            except Exception as e: check('typing', 'A sees "Bea is typing…"', False, e)
            B.fill('#ta-main', '')
        t_realtime()

        @section('unread')
        def t_unread():
            # A creates a second room and moves there; B posts in welcome -> unread badge for A
            A.click('#new-room'); A.fill('#nr-name', 'random'); A.click('.modal-f .btn.primary')
            A.wait_for_selector('#ta-main'); time.sleep(1)
            st['random'] = room_id(A, 'random')
            send(B, 'Unread ping for you ' + STAMP); time.sleep(0.3)
            send(B, '@Ace can you look at this? ' + STAMP)
            wait(A, 'r => (window.__huddle.S.unread[r] || {}).unread >= 2', 10000, welcome)
            check('unread', 'unread count increments live', True)
            wait(A, 'r => (window.__huddle.S.unread[r] || {}).mentions >= 1', 10000, welcome)
            check('mentions', '@mention of a person counted', A.locator('.item[data-room="%s"] .badge.at' % welcome).count() > 0)
            shot(A, '06_unread_badges_1440')
            A.click('#side-tabs button[data-t=unread]'); time.sleep(0.5)
            check('unread', 'Unread tab lists the room', 'welcome' in A.inner_text('#side-list'))
            A.click('#side-tabs button[data-t=me]'); time.sleep(1.5)
            check('mentions', '@me tab lists the mention', 'can you look at this' in A.inner_text('#side-list'))
            A.click('#side-tabs button[data-t=recent]'); time.sleep(0.3)
            check('sidebar', 'Recent tab renders', 'recent activity' in A.inner_text('#side-list').lower())
            A.click('#side-tabs button[data-t=home]')
            goto_hash(A, '#/w/%s/r/%s' % (wsid, welcome)); time.sleep(1.5)
            check('unread', 'opening the room clears unread', (S(A, 'S.unread["%s"].unread' % welcome) == 0))
            time.sleep(1)
            lr = sql("select count(*) from room_members where room_id='%s' and user_id='%s' and last_read_at > now() - interval '1 minute'" % (welcome, st['aid']))
            check('unread', 'last_read_at persisted in DB', lr == '1', lr)
        t_unread()

        @section('threads')
        def t_threads():
            mid = A.evaluate('s => (window.__huddle.S.msgs[Object.keys(window.__huddle.S.msgs).find(k => k)] || []).concat(...Object.values(window.__huddle.S.msgs)).find(m => m.content.includes(s)).id', 'Got it Ace ' + STAMP)
            goto_hash(A, '#/w/%s/r/%s/t/%s' % (wsid, welcome, mid))
            A.wait_for_selector('#ta-thread', timeout=10000); time.sleep(1)
            check('threads', 'thread pane opens with back button', A.is_visible('#thread .back'))
            send(A, 'Thread reply from Ace ' + STAMP, 'thread')
            wait(A, 's => document.querySelector("#tmsgs").innerText.includes(s)', 8000, 'Thread reply from Ace ' + STAMP)
            wait(B, 'id => (window.__huddle.S.replyCounts[id] || 0) >= 1', 10000, mid)
            time.sleep(0.5)
            check('threads', 'B sees "1 reply" live in channel', '1 reply' in msgs_text(B))
            goto_hash(B, '#/w/%s/r/%s/t/%s' % (wsid, welcome, mid)); B.wait_for_selector('#ta-thread'); time.sleep(1)
            check('threads', 'B sees thread reply', 'Thread reply from Ace' in B.inner_text('#tmsgs'))
            send(B, 'Bea answers in thread ' + STAMP, 'thread')
            wait(A, 's => document.querySelector("#tmsgs").innerText.includes(s)', 10000, 'Bea answers in thread ' + STAMP)
            check('threads', 'thread replies are realtime both ways', True)
            shot(A, '07_thread_1440')
            n = sql("select count(*) from messages where parent_id='%s'" % mid)
            check('threads', 'parent_id stored for replies', n == '2', n)
            A.click('#thread .back'); time.sleep(0.6)
            check('nav', 'thread back button closes thread', A.locator('#thread.hidden').count() == 1)
            goto_hash(B, '#/w/%s/r/%s' % (wsid, welcome))
        t_threads()

        @section('ai-keys')
        def t_keys():
            A.evaluate("k => localStorage.setItem('bh.aiKeys', JSON.stringify(k ? {gemini: k} : {}))", GEM)
            check('ai', 'Gemini key available for live tests', bool(GEM), 'no GEMINI_API_KEY env')
            A.click('#rail-ai'); A.wait_for_selector('#k-gemini')
            check('ai', 'Advanced AI Settings: keys/model/temp/max/system/themes', all(A.locator(s).count() for s in ['#k-gemini', '#k-groq', '#k-openrouter', '#s-model', '#s-temp', '#s-max', '#s-sys', '[data-theme-pick=grape]']))
            check('ai', 'key field is masked', A.get_attribute('#k-gemini', 'type') == 'password')
            if GEM:
                A.click('[data-test=gemini]')
                try:
                    wait(A, '() => /Works|❌/.test(document.querySelector("#kt-gemini").innerText)', 40000)
                    check('ai', 'live Gemini key test', 'Works' in A.inner_text('#kt-gemini'), A.inner_text('#kt-gemini'))
                except Exception as e: check('ai', 'live Gemini key test', False, e)
            shot(A, '08_ai_settings_1440')
            A.click('.modal-f .btn.primary'); time.sleep(0.3)
        t_keys()

        @section('agents')
        def t_agents():
            create_agent(A, 'Gem', system='You are Gem, a concise helpful teammate. Keep replies under 40 words.')
            shot(A, '09_members_agents_1440')
            gid = agent_id(A, 'Gem'); st['gem'] = gid
            row = sql("select provider||'|'||effort||'|'||is_private from agents where id='%s'" % gid)
            check('agents', 'agent row saved (provider/effort/private)', row in ('gemini|Fast|f', 'gemini|Fast|false'), row)
            goto_hash(A, '#/w/%s/r/%s' % (wsid, welcome)); goto_hash(B, '#/w/%s/r/%s' % (wsid, welcome)); time.sleep(1.5)
            wait(B, 'n => window.__huddle.S.agents.some(a => a.name === n)', 10000, 'Gem')
            check('agents', 'B sees A\'s new agent live', True)
            check('agents', 'agent shows online (owner app open)', B.evaluate('id => { const S = window.__huddle.S; const a = S.agents.find(x => x.id === id); return !!S.online[a.owner_id]; }', gid))
            send(B, '@Gem what is 2+2? Answer with just the number. ' + STAMP)
            try:
                wait(B, 'id => (window.__huddle.S.msgs[Object.keys(window.__huddle.S.msgs)[0]] || []).concat(...Object.values(window.__huddle.S.msgs)).some(m => m.agent_id === id)', 60000, gid)
                txt = B.evaluate('id => Object.values(window.__huddle.S.msgs).flat().filter(m => m.agent_id === id).pop().content', gid)
                check('agents', '@mention -> agent replies via owner\'s device (real Gemini)', not txt.startswith('⚠️'), txt[:120])
                check('agents', 'reply has AI tag + Copy button', B.locator('.msg.agentmsg .copybtn').count() > 0 and B.locator('.msg.agentmsg .pill.green').count() > 0)
                B.locator('.msg.agentmsg .copybtn').last.click(); time.sleep(0.4)
                clip = B.evaluate('() => navigator.clipboard.readText()')
                check('agents', 'Copy button copies the agent reply', clip.strip() == txt.strip(), clip[:60])
                shot(B, '10_agent_reply_1440')
            except Exception as e: check('agents', 'agent replied', False, e)
            ev = sql_wait("select count(*)||'|'||coalesce(sum(prompt_tokens+completion_tokens),0) from usage_events where agent_id='%s' and ok" % gid, lambda v: v.split('|')[0] != '0')
            check('usage', 'usage_event logged with tokens', ev.split('|')[0] != '0' and ev.split('|')[1] != '0', ev)
            jobs = sql("select count(*) from agent_jobs where agent_id='%s'" % gid)
            check('agents', 'atomic agent_jobs claim row exists', jobs != '0', jobs)
            # the key must never be in the DB
            if GEM:
                dump = subprocess.run(['docker', 'exec', 'supabase_db_bizzle-huddle', 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--data-only', '-n', 'public'], capture_output=True, text=True).stdout
                check('security', 'AI key not present anywhere in DB dump', GEM not in dump and len(dump) > 1000)
        t_agents()

        @section('agent-errors')
        def t_agent_errors():
            # B owns a Groq agent but has no Groq key -> real error path, posted by B's own runner
            create_agent(B, 'Rocket', provider='groq', tier='Fast', emoji='⚡')
            goto_hash(B, '#/w/%s/r/%s' % (wsid, welcome)); time.sleep(1)
            send(B, '@Rocket hello ' + STAMP)
            rid = agent_id(B, 'Rocket')
            wait(B, 'id => Object.values(window.__huddle.S.msgs).flat().some(m => m.agent_id === id)', 20000, rid)
            txt = B.evaluate('id => Object.values(window.__huddle.S.msgs).flat().filter(m => m.agent_id === id).pop().content', rid)
            check('ai', 'missing-key error is posted clearly (no crash)', 'No Groq key' in txt, txt[:100])
        t_agent_errors()

        @section('agent-chain')
        def t_chain():
            create_agent(A, 'Ping', system='You are Ping. Reply in ONE short sentence and ALWAYS end your reply with exactly "@Pong your turn".', emoji='🐸')
            create_agent(A, 'Pong', system='You are Pong. Reply in ONE short sentence and ALWAYS end your reply with exactly "@Ping your turn".', emoji='🐙')
            goto_hash(A, '#/w/%s/r/%s' % (wsid, st['random'])); A.wait_for_selector('#ta-main'); time.sleep(1)
            send(A, '@Ping start a ping-pong game ' + STAMP)
            time.sleep(45)
            rows = sql("select hop||':'||coalesce((select name from agents a where a.id=m.agent_id),'human') from messages m where room_id='%s' and created_at > now() - interval '3 minutes' order by created_at" % st['random']).splitlines()
            hops = [int(r.split(':')[0]) for r in rows if not r.endswith('human')]
            check('agent-chain', 'agent-to-agent @mentions work (Ping -> Pong)', len(hops) >= 2, rows)
            check('agent-chain', 'loop stops at max 3 hops', len(hops) > 0 and max(hops) <= 3 and len(hops) <= 3, rows)
            shot(A, '11_agent_chain_1440')
            # rate limiter unit (client-side, per agent per minute)
            res = A.evaluate("() => { const k = 'bh.rate'; const save = localStorage.getItem(k); localStorage.removeItem(k); const out = []; for (let i = 0; i < 8; i++) out.push(window.__huddle.rateOk('test-agent')); if (save) localStorage.setItem(k, save); else localStorage.removeItem(k); return out; }")
            check('agent-chain', 'per-minute rate limit: 6 allowed then blocked', res == [True] * 6 + [False, False], res)
        t_chain()

        @section('approvals')
        def t_approvals():
            create_agent(A, 'Careful', system='You are Careful. Reply in under 15 words.', approval=True, emoji='🦉')
            goto_hash(B, '#/w/%s/r/%s' % (wsid, welcome)); time.sleep(1)
            send(B, '@Careful say hello to the team ' + STAMP)
            cid = agent_id(A, 'Careful')
            wait(A, 'id => window.__huddle.S.approvals.some(a => a.agent_id === id && a.status === "pending")', 60000, cid)
            check('approvals', 'needs-approval reply goes to Approvals (not the room)', sql("select count(*) from messages where agent_id='%s'" % cid) == '0')
            wait(B, 'id => window.__huddle.S.approvals.some(a => a.agent_id === id && a.status === "pending")', 10000, cid)
            goto_hash(B, '#/w/%s/approvals' % wsid); time.sleep(0.8)
            check('approvals', 'non-owner member cannot approve (UI)', 'Only the agent owner or an admin' in B.inner_text('#main'))
            apid = A.evaluate('id => window.__huddle.S.approvals.find(a => a.agent_id === id && a.status === "pending").id', cid)
            err = B.evaluate('id => window.__huddle.S.sb.rpc("decide_approval", {p_id: id, p_approve: true}).then(r => r.error && r.error.message)', apid)
            check('approvals', 'non-owner member cannot approve (RLS/RPC)', bool(err), err)
            goto_hash(A, '#/w/%s/approvals' % wsid); time.sleep(0.8)
            check('approvals', 'rail badge shows pending count', A.locator('#rail .badge').count() > 0)
            shot(A, '12_approvals_1440')
            A.click('[data-approve="%s"]' % apid); time.sleep(1.5)
            goto_hash(B, '#/w/%s/r/%s' % (wsid, welcome))
            wait(B, 'id => Object.values(window.__huddle.S.msgs).flat().some(m => m.agent_id === id)', 10000, cid)
            time.sleep(0.5)
            check('approvals', 'approved draft is posted to the room for everyone', 'approved by Ace' in msgs_text(B))
            # reject path
            send(B, '@Careful another one ' + STAMP)
            wait(A, 'id => window.__huddle.S.approvals.filter(a => a.agent_id === id && a.status === "pending").length == 1', 60000, cid)
            apid2 = A.evaluate('id => window.__huddle.S.approvals.find(a => a.agent_id === id && a.status === "pending").id', cid)
            goto_hash(A, '#/w/%s/approvals' % wsid); time.sleep(0.5); A.click('[data-reject="%s"]' % apid2); time.sleep(1)
            check('approvals', 'reject marks rejected and posts nothing', sql("select status from approvals where id='%s'" % apid2) == 'rejected' and sql("select count(*) from messages where agent_id='%s'" % cid) == '1')
        t_approvals()

        @section('apps')
        def t_apps():
            goto_hash(B, '#/w/%s/r/%s/apps' % (wsid, welcome)); B.wait_for_selector('#app-form-name')
            B.fill('#app-form-name', 'Tap Counter'); B.select_option('#app-form-agent', st['gem'])
            B.fill('#app-form-prompt', 'A big button that counts taps, shared with the room using huddle.get/huddle.set with key "taps", and shows the total.')
            B.click('#app-form-go')
            try:
                wait(B, '() => window.__huddle.S.apps.some(a => a.name === "Tap Counter" && a.status === "draft")', 200000)
                check('apps', 'member asks agent -> single-file HTML draft built (real Gemini)', True)
                html_len = sql("select length(html) from apps where name='Tap Counter'")
                check('apps', 'draft HTML stored', int(html_len or 0) > 200, html_len)
            except Exception as e:
                check('apps', 'agent built the app draft', False, sql("select status from apps where name='Tap Counter'"))
            time.sleep(0.8)
            check('apps', 'member sees "Waiting for an admin" and no publish button', B.locator('[data-publish]').count() == 0)
            shot(B, '13_apps_draft_member_1440')
            # deterministic bridge app so the bridge test doesn't depend on the LLM
            bridge_html = '''<!doctype html><html><head><title>Bridge</title></head><body><h1 id=v>?</h1><button id=b>+1</button><p id=iso>?</p><p id=net>?</p>
<script>
async function show(){ var v = await huddle.get('count'); document.getElementById('v').textContent = v == null ? 0 : v; }
document.getElementById('b').onclick = async function(){ var v = (await huddle.get('count')) || 0; await huddle.set('count', v + 1); show(); };
huddle.onChange(function(k, v){ if (k === 'count') document.getElementById('v').textContent = v; });
try { parent.document.title; document.getElementById('iso').textContent = 'LEAK'; } catch (e) { document.getElementById('iso').textContent = 'isolated'; }
try { localStorage.getItem('x'); document.getElementById('net').textContent = 'ls-ok'; } catch (e) { document.getElementById('net').textContent = 'no-storage'; }
show();
</script></body></html>'''
            ins = B.evaluate('''([ws, room, html]) => window.__huddle.S.sb.from('apps').insert({workspace_id: ws, room_id: room, name: 'Bridge Test', html: html, status: 'draft', created_by: window.__huddle.S.user.id}).select('id').single().then(r => r.error ? 'ERR ' + r.error.message : r.data.id)''', [wsid, welcome, bridge_html])
            check('apps', 'member can create a draft app', not str(ins).startswith('ERR'), ins)
            perr = B.evaluate('''id => window.__huddle.S.sb.from('apps').update({status: 'published'}).eq('id', id).then(r => r.error && r.error.message)''', ins)
            check('apps', 'member CANNOT publish (DB trigger)', perr and 'admin' in perr, perr)
            goto_hash(A, '#/w/%s/r/%s/apps' % (wsid, welcome)); time.sleep(1.5)
            A.click('[data-publish="%s"]' % ins); time.sleep(1)
            check('apps', 'admin publishes -> status published + approved_by', sql_wait("select status||'|'||(approved_by is not null) from apps where id='%s'" % ins, lambda v: v == 'published|true') == 'published|true')
            if sql("select status from apps where name='Tap Counter'") == 'draft':
                tid = sql("select id from apps where name='Tap Counter'")
                A.click('[data-publish="%s"]' % tid); time.sleep(1)
                check('apps', 'agent-built app published by admin', sql("select status from apps where id='%s'" % tid) == 'published')
            shot(A, '14_apps_admin_1440')
            # open in B and A, use the bridge
            goto_hash(B, '#/w/%s/r/%s/apps' % (wsid, welcome)); time.sleep(1.2)
            B.click('[data-open-app="%s"]' % ins); B.wait_for_selector('#appframe'); time.sleep(1.5)
            check('apps', 'iframe sandbox="allow-scripts" (no same-origin)', B.get_attribute('#appframe', 'sandbox') == 'allow-scripts')
            fb = B.frame_locator('#appframe')
            check('apps', 'app cannot reach parent DOM', fb.locator('#iso').inner_text() == 'isolated')
            fb.locator('#b').click(); time.sleep(1.2); fb.locator('#b').click(); time.sleep(1.2)
            check('apps', 'postMessage bridge saves to room-scoped app_kv', sql("select value from app_kv where app_id='%s' and key='count'" % ins) == '2')
            goto_hash(A, '#/w/%s/r/%s/apps' % (wsid, welcome)); time.sleep(0.8)
            A.click('[data-open-app="%s"]' % ins); A.wait_for_selector('#appframe'); time.sleep(1.5)
            fa = A.frame_locator('#appframe')
            check('apps', 'other user reads the same data', fa.locator('#v').inner_text() == '2')
            fb.locator('#b').click(); time.sleep(2)
            check('apps', 'realtime onChange pushes updates into open app', fa.locator('#v').inner_text() == '3', fa.locator('#v').inner_text())
            shot(A, '15_app_running_1440')
            A.keyboard.press('Escape'); B.keyboard.press('Escape')
            # the agent-built one: open & screenshot
            tid = sql("select id from apps where name='Tap Counter' and status='published'")
            if tid:
                A.click('[data-open-app="%s"]' % tid); time.sleep(2); shot(A, '16_agent_built_app_1440'); A.keyboard.press('Escape')
        t_apps()

        @section('automations')
        def t_automations():
            goto_hash(A, '#/w/%s/r/%s/automations' % (wsid, st['random'])); A.wait_for_selector('#au-name')
            A.fill('#au-name', 'Fun fact'); A.select_option('#au-agent', st['gem'])
            A.fill('#au-prompt', 'Share one short fun fact (max 20 words).')
            A.fill('#au-n', '1'); A.select_option('#au-unit', '1'); A.click('#au-go'); time.sleep(1.5)
            auid = sql("select id from automations where name='Fun fact'")
            check('automations', 'automation saved (every 1 minute)', sql("select every_minutes from automations where id='%s'" % auid) == '1')
            # double-run guard: make it due, then claim twice concurrently
            sql("update automations set last_run = now() - interval '5 minutes' where id='%s'" % auid)
            n = A.evaluate('ws => Promise.all([1,2,3].map(() => window.__huddle.S.sb.rpc("claim_due_automations", {p_ws: ws}))).then(rs => rs.map(r => (r.data || []).length))', wsid)
            check('automations', 'atomic claim: 3 concurrent claims -> exactly 1 run', sum(n) == 1, n)
            nb = B.evaluate('ws => window.__huddle.S.sb.rpc("claim_due_automations", {p_ws: ws}).then(r => (r.data || []).length)', wsid)
            check('automations', 'non-admin cannot claim automations', nb == 0, nb)
            sql("delete from automation_runs where automation_id='%s'" % auid)
            # scheduled run via the app's own 30s loop
            sql("update automations set last_run = now() - interval '5 minutes' where id='%s'" % auid)
            try:
                A.wait_for_function('() => true')
                t0 = time.time()
                while time.time() - t0 < 100:
                    s = sql("select status from automation_runs where automation_id='%s' order by started_at desc limit 1" % auid)
                    if s == 'ok' or s == 'error': break
                    time.sleep(3)
                check('automations', 'scheduled run claimed by admin app + executed by agent', s == 'ok', s)
            except Exception as e: check('automations', 'scheduled run', False, e)
            A.click('[data-run="%s"]' % auid)
            t0 = time.time()
            while time.time() - t0 < 60:
                c = sql("select count(*) from automation_runs where automation_id='%s' and status='ok'" % auid)
                if int(c or 0) >= 2: break
                time.sleep(3)
            check('automations', '"Run now" works and records history', int(c or 0) >= 2, c)
            goto_hash(A, '#/w/%s/r/%s' % (wsid, st['random'])); time.sleep(0.5)
            goto_hash(A, '#/w/%s/r/%s/automations' % (wsid, st['random'])); time.sleep(2)
            check('automations', 'history table shows runs', A.locator('#au-list td .pill.green').count() >= 1)
            shot(A, '17_automations_1440')
            sql("update automations set enabled=false where id='%s'" % auid)
            ue = sql("select count(*) from usage_events where automation_id='%s'" % auid)
            check('usage', 'automation usage attributed', int(ue or 0) >= 1, ue)
        t_automations()

        @section('files')
        def t_files():
            path = '/tmp/huddle-test-%s.txt' % STAMP
            open(path, 'w').write('hello from Bea ' + STAMP)
            goto_hash(B, '#/w/%s/r/%s/files' % (wsid, welcome)); B.wait_for_selector('#f-in', state='attached')
            B.set_input_files('#f-in', path); time.sleep(2.5)
            check('files', 'upload to Supabase Storage + files row', sql("select count(*) from files where name='huddle-test-%s.txt'" % STAMP) == '1')
            goto_hash(A, '#/w/%s/r/%s/files' % (wsid, welcome)); time.sleep(1.5)
            check('files', 'other member sees the file', ('huddle-test-%s.txt' % STAMP) in A.inner_text('#f-list'))
            fpath = sql("select path from files where name='huddle-test-%s.txt'" % STAMP)
            content = A.evaluate('p => window.__huddle.S.sb.storage.from("huddle-files").download(p).then(r => r.data ? r.data.text() : "ERR " + (r.error && r.error.message))', fpath)
            check('files', 'download returns the same bytes', content == 'hello from Bea ' + STAMP, content[:60])
            shot(A, '18_files_1440')
            # image attachment in chat (screenshot for AI help)
            goto_hash(B, '#/w/%s/r/%s' % (wsid, welcome)); B.wait_for_selector('#ta-main')
            B.set_input_files('#ii-main', os.path.join(SHOTS, '..', 'docs', 'icons', 'icon-192.png'))
            B.fill('#ta-main', '@Gem what text do you see in this image? ' + STAMP); B.press('#ta-main', 'Enter')
            goto_hash(A, '#/w/%s/r/%s' % (wsid, welcome))
            wait(A, '() => document.querySelectorAll("#msgs .att img[src]").length > 0', 15000)
            check('files', 'image attachment renders for others (signed URL)', True)
            try:
                FIND = '''st => { const all = Object.values(window.__huddle.S.msgs).flat(); const q = all.find(m => !m.agent_id && (m.content || '').includes('what text do you see') && (m.content || '').includes(st));
                  if (!q) return null; const r = all.find(m => m.agent_id && m.meta && m.meta.reply_to === q.id); return r ? r.content : null; }'''
                wait(A, FIND, 90000, STAMP)
                vis = A.evaluate(FIND, STAMP)
                check('ai', 'vision: Gemini reads the uploaded screenshot', ('BH' in vis or '4.20' in vis or 'v4' in vis.lower()), vis[:120])
            except Exception as e: check('ai', 'vision reply', False, e)
            shot(A, '19_vision_reply_1440')
            # storage RLS: a non-member can't read
        t_files()

        @section('privacy')
        def t_privacy():
            goto_hash(A, '#/w/%s' % wsid)
            A.click('#new-room'); A.fill('#nr-name', 'secret'); A.check('#nr-priv'); A.click('.modal-f .btn.primary'); time.sleep(1.5)
            sec = room_id(A, 'secret')
            send(A, 'top secret ' + STAMP); time.sleep(1)
            n = B.evaluate('id => window.__huddle.S.sb.from("messages").select("id").eq("room_id", id).then(r => (r.data || []).length)', sec)
            check('security', 'private room messages hidden from non-members (RLS)', n == 0, n)
            check('security', 'private room not in B room list', not B.evaluate('id => window.__huddle.S.rooms.some(r => r.id === id)', sec))
            create_agent(A, 'Diary', private=True, emoji='🦊')
            time.sleep(1.5)
            vis = B.evaluate('() => window.__huddle.S.sb.from("agents").select("name").then(r => r.data.map(a => a.name))')
            check('security', 'private agent invisible to others', 'Diary' not in vis, vis)
            forge = B.evaluate('([ws, room, ag]) => window.__huddle.S.sb.from("messages").insert({workspace_id: ws, room_id: room, author_id: window.__huddle.S.user.id, agent_id: ag, content: "forged"}).then(r => r.error ? r.error.message : "INSERTED")', [wsid, welcome, st['gem']])
            check('security', 'cannot post as someone else\'s agent (RLS)', forge != 'INSERTED', forge)
            hop = B.evaluate('([ws, room]) => window.__huddle.S.sb.from("messages").insert({workspace_id: ws, room_id: room, author_id: window.__huddle.S.user.id, content: "x", hop: 3}).then(r => r.error ? "blocked" : "INSERTED")', [wsid, welcome])
            check('security', 'humans cannot fake agent hop counts', hop == 'blocked', hop)
            # add B to private room via room members modal
            goto_hash(A, '#/w/%s/r/%s' % (wsid, sec)); time.sleep(1)
            A.click('#room-members'); A.wait_for_selector('#rm-add'); A.select_option('#rm-add', st['bid']); A.click('#rm-add-go'); time.sleep(1.5)
            n2 = B.evaluate('id => window.__huddle.S.sb.from("messages").select("id").eq("room_id", id).then(r => (r.data || []).length)', sec)
            check('rooms', 'added member can now read private room', n2 >= 1, n2)
            shot(A, '20_room_members_modal_1440'); A.keyboard.press('Escape')
        t_privacy()

        @section('members')
        def t_members():
            goto_hash(A, '#/w/%s/members' % wsid); time.sleep(1)
            check('members', 'members page lists humans + agents', 'Bea' in A.inner_text('#main') and 'Gem' in A.inner_text('#main'))
            A.select_option('[data-role="%s"]' % st['bid'], 'admin'); time.sleep(1.5)
            check('members', 'admin can promote member to admin', sql("select role from workspace_members where user_id='%s'" % st['bid']) == 'admin')
            wait(B, '() => window.__huddle.S.role === "admin"', 10000)
            check('members', 'role change reaches B live', True)
            A.select_option('[data-role="%s"]' % st['bid'], 'member'); time.sleep(1.5)
            check('members', 'admin can demote', sql("select role from workspace_members where user_id='%s'" % st['bid']) == 'member')
            A.click('[data-agent-profile="%s"]' % st['gem']); A.wait_for_selector('.kv')
            kv = A.inner_text('.kv')
            check('members', 'agent profile: provider, model, tier, usage', 'Google Gemini' in kv and 'gemini-flash-lite-latest' in kv and 'Fast' in kv and 'requests' in kv)
            shot(A, '21_agent_profile_1440'); A.keyboard.press('Escape')
            # third user joins then gets removed
            ctxC, C = new_user_page(browser)
            link = A.evaluate('() => window.__huddle.inviteLink()').replace('https://leehizzbt.github.io/bizzle-huddle/', BASE)
            signup(C, 'Cy', emC, invite=link); C.wait_for_selector('#shell', timeout=20000); time.sleep(1.5)
            cid = S(C, 'S.user.id')
            goto_hash(A, '#/w/%s/members' % wsid); time.sleep(1.5)
            A.once('dialog', lambda d: d.accept())
            A.click('[data-kick="%s"]' % cid); time.sleep(1.5)
            check('members', 'admin can remove a member', sql("select count(*) from workspace_members where user_id='%s'" % cid) == '0')
            n = C.evaluate('() => window.__huddle.S.sb.from("messages").select("id").limit(5).then(r => (r.data || []).length)')
            check('security', 'removed member loses access to messages', n == 0, n)
            nd = B.evaluate('ws => window.__huddle.S.sb.from("workspace_members").delete().eq("workspace_id", ws).eq("user_id", window.__huddle.S.ws.created_by).select().then(r => (r.data || []).length)', wsid)
            check('security', 'member cannot remove the admin', nd == 0, nd)
            ctxC.close()
        t_members()

        @section('usage')
        def t_usage():
            goto_hash(A, '#/w/%s/usage' % wsid); A.wait_for_selector('.bars', timeout=10000)
            check('usage', 'usage overview shows requests + tokens', int(A.inner_text('.stat').replace(',', '')) > 0)
            shot(A, '22_usage_1440')
            for t in ['people', 'rooms', 'agents', 'automations']:
                A.click('#u-tabs button[data-t=%s]' % t); time.sleep(1)
                check('usage', 'usage by %s table' % t, A.locator('#u-body table tr').count() >= 2)
        t_usage()

        @section('ai-requests')
        def t_ai_requests():
            r = A.evaluate('''() => { const AI = window.HuddleAI; const img = {mime: 'image/png', base64: 'AAAA'};
              const g = AI.buildRequest({provider: 'groq', model: 'qwen/qwen3.8-27b', key: 'K', messages: [{role: 'user', text: 'hi', images: [img]}], system: 'S', temperature: 0.3, maxTokens: 99});
              const g2 = AI.buildRequest({provider: 'groq', model: 'openai/gpt-oss-20b', key: 'K', messages: [{role: 'user', text: 'hi', images: [img]}], effort: 'Max'});
              const o = AI.buildRequest({provider: 'openrouter', model: 'openrouter/free', key: 'K', messages: [{role: 'user', text: 'hi', images: [img]}]});
              const ge = AI.buildRequest({provider: 'gemini', model: 'gemini-flash-latest', key: 'K', messages: [{role: 'assistant', text: 'a'}, {role: 'user', text: 'b', images: [img]}], system: 'S'});
              return {g: [g.url, g.init.headers.Authorization, JSON.parse(g.init.body)], g2: JSON.parse(g2.init.body), o: [o.url, o.init.headers, JSON.parse(o.init.body)], ge: [ge.url, ge.init.headers, JSON.parse(ge.init.body)],
                tiers: {gemini: AI.PROVIDERS.gemini.tiers, groq: AI.PROVIDERS.groq.tiers, openrouter: AI.PROVIDERS.openrouter.tiers}}; }''')
            gb = r['g'][2]
            check('ai', 'Groq request: URL, bearer, model, system, temp, max_tokens', r['g'][0] == 'https://api.groq.com/openai/v1/chat/completions' and r['g'][1] == 'Bearer K' and gb['model'] == 'qwen/qwen3.8-27b' and gb['messages'][0]['role'] == 'system' and gb['temperature'] == 0.3 and gb['max_tokens'] == 99)
            check('ai', 'Groq vision model gets image_url parts', gb['messages'][1]['content'][1]['type'] == 'image_url')
            check('ai', 'Groq non-vision model gets text note + reasoning_effort', isinstance(r['g2']['messages'][0]['content'], str) and r['g2'].get('reasoning_effort') == 'high')
            ob = r['o'][2]
            check('ai', 'OpenRouter request: URL, headers, image parts', r['o'][0] == 'https://openrouter.ai/api/v1/chat/completions' and r['o'][1]['Authorization'] == 'Bearer K' and 'X-Title' in r['o'][1] and ob['messages'][0]['content'][1]['type'] == 'image_url')
            gem = r['ge'][2]
            check('ai', 'Gemini request: header key (not URL), systemInstruction, inline_data, role order', 'key=' not in r['ge'][0] and r['ge'][1]['x-goog-api-key'] == 'K' and gem['systemInstruction'] and gem['contents'][0]['role'] == 'user' and any('inline_data' in p for c in gem['contents'] for p in c['parts']))
            check('ai', 'free-model tier mapping for all providers', all(r['tiers'][p].get(t) for p in r['tiers'] for t in ['Fast', 'Pro', 'Max']) and all(v.endswith(':free') or v == 'openrouter/free' for v in r['tiers']['openrouter'].values()))
            errs = A.evaluate('''async () => { const AI = window.HuddleAI; const out = {};
              for (const p of ['groq', 'openrouter', 'gemini']) { try { await AI.chat({provider: p, key: 'bad-key-123', effort: 'Fast', messages: [{role: 'user', text: 'hi'}]}); out[p] = 'NOERR'; } catch (e) { out[p] = (e.status || 0) + ' ' + e.message; } }
              try { await AI.chat({provider: 'groq', key: '', messages: []}); } catch (e) { out.nokey = e.message; }
              return out; }''')
            check('ai', 'Groq bad key -> friendly 401 error', errs['groq'].startswith('401') and 'rejected' in errs['groq'], errs['groq'][:120])
            check('ai', 'OpenRouter bad key -> friendly 401 error', errs['openrouter'].startswith('401'), errs['openrouter'][:120])
            check('ai', 'Gemini bad key -> friendly error', errs['gemini'][:3] in ('400', '401', '403') and 'key' in errs['gemini'].lower(), errs['gemini'][:120])
            check('ai', 'no key -> clear message', 'No ' in errs.get('nokey', ''), errs.get('nokey'))
            lm = A.evaluate('() => window.HuddleAI.listModels("openrouter").then(l => l.length)')
            check('ai', 'live OpenRouter free model list loads (public)', lm > 3, lm)
        t_ai_requests()

        @section('bizzy')
        def t_bizzy():
            A.click('#bizzy-fab'); A.wait_for_selector('#bz-ta')
            check('bizzy', 'Bizzy Bot bubble opens with back button', A.is_visible('.bizzy .back'))
            A.fill('#bz-ta', 'remember: my favourite room is #random'); A.press('#bz-ta', 'Enter'); time.sleep(0.5)
            A.fill('#bz-ta', 'In one sentence: how do I make an agent reply?'); A.press('#bz-ta', 'Enter')
            try:
                wait(A, '() => { const m = JSON.parse(localStorage.getItem("bh.bizzy") || "{}"); return (m.history || []).length >= 4; }', 60000)
                ans = A.evaluate('() => JSON.parse(localStorage.getItem("bh.bizzy")).history.pop().text')
                check('bizzy', 'answers a how-to question with the user key', not ans.startswith('⚠️') and len(ans) > 10, ans[:120])
            except Exception as e: check('bizzy', 'answer', False, e)
            check('bizzy', 'copy button on Bizzy replies', A.locator('.bizzy .copybtn').count() >= 1)
            shot(A, '23_bizzy_1440')
            A.reload(); A.wait_for_selector('#shell', timeout=20000); A.click('#bizzy-fab'); time.sleep(0.5)
            check('bizzy', 'memory persists after reload (localStorage)', 'favourite room' in A.inner_text('#bz-msgs'))
            A.click('#bz-back')
        t_bizzy()

        @section('themes')
        def t_themes():
            goto_hash(A, '#/w/%s/settings' % wsid); time.sleep(0.8)
            names = []
            for t in ['grape', 'ocean', 'solar', 'rose', 'daylight', 'neon']:
                A.click('#main [data-theme-pick=%s]' % t); time.sleep(0.2)
                names.append(A.evaluate('() => document.documentElement.getAttribute("data-theme")'))
                if t in ('grape', 'daylight'): shot(A, '24_theme_%s_1440' % t)
            check('themes', 'six AI color themes switch', names == ['grape', 'ocean', 'solar', 'rose', 'daylight', 'neon'], names)
            col = A.evaluate('() => getComputedStyle(document.querySelector(".v420")).color')
            check('branding', 'neon green v4.20 badge', col == 'rgb(57, 255, 20)', col)
        t_themes()

        @section('back-buttons')
        def t_back():
            views = ['', 'r/%s' % welcome, 'r/%s/apps' % welcome, 'r/%s/automations' % welcome, 'r/%s/files' % welcome, 'members', 'usage', 'approvals', 'settings', 'mentions']
            missing = []
            for v in views:
                goto_hash(A, '#/w/%s/%s' % (wsid, v)); time.sleep(0.5)
                if A.locator('#main .back').count() == 0: missing.append(v)
            check('nav', 'themed back button on every view (%d views)' % len(views), not missing, missing)
            goto_hash(A, '#/w/%s/r/%s' % (wsid, welcome)); time.sleep(0.4); goto_hash(A, '#/w/%s/members' % wsid); time.sleep(0.4)
            A.click('#main .back'); time.sleep(0.8)
            check('nav', 'back returns to previous view', '/r/' in A.url, A.url)
        t_back()

        @section('pwa')
        def t_pwa():
            reg = A.evaluate('() => navigator.serviceWorker.getRegistration().then(r => !!r)')
            check('pwa', 'service worker registered', reg)
            keys = A.evaluate('() => caches.keys()')
            build = A.evaluate('() => window.__huddle.build')
            check('pwa', 'cache name carries build id (cache-busting)', any(build in k for k in keys), keys)
            man = A.evaluate('() => fetch("manifest.webmanifest").then(r => r.json())')
            check('pwa', 'manifest + icons present', len(man['icons']) == 3 and man['name'].startswith('Bizzle Huddle'))
        t_pwa()

        @section('responsive')
        def t_responsive():
            for w, h in [(360, 780), (390, 844), (768, 1024), (1024, 768), (1440, 900)]:
                mob = w < 768
                ctx, P = new_user_page(browser, w, h, mobile=mob)
                P.goto(BASE); P.evaluate('c => localStorage.setItem("bh.conn", JSON.stringify(c))', {'url': ENV['API_URL'], 'key': ENV['ANON_KEY']})
                P.goto(BASE); P.wait_for_selector('#a-tabs', timeout=20000)
                P.fill('#a-email', emA); P.fill('#a-pass', 'password123'); P.click('#a-go')
                P.wait_for_selector('#shell', timeout=20000); time.sleep(2)
                goto_hash(P, '#/w/%s' % wsid); time.sleep(1)
                shot(P, 'w%d_1_home' % w)
                side_vis = P.is_visible('#side'); main_vis = P.is_visible('#main')
                if mob:
                    check('responsive', '%dpx: home shows list only (single pane)' % w, side_vis and not main_vis)
                    check('responsive', '%dpx: bottom navigation visible' % w, P.is_visible('#bottomnav'))
                else:
                    check('responsive', '%dpx: multi-pane (list + chat)' % w, side_vis and main_vis)
                P.click('.item[data-room="%s"]' % welcome); P.wait_for_selector('#ta-main'); time.sleep(1.5)
                shot(P, 'w%d_2_room' % w)
                if mob:
                    check('responsive', '%dpx: room opens full-screen, list hidden' % w, not P.is_visible('#side') and P.is_visible('#ta-main'))
                over = P.evaluate('() => document.documentElement.scrollWidth > window.innerWidth + 1')
                check('responsive', '%dpx: no horizontal overflow' % w, not over)
                tid = P.evaluate('() => Object.values(window.__huddle.S.replyCounts).length ? Object.keys(window.__huddle.S.replyCounts)[0] : null')
                if tid:
                    goto_hash(P, '#/w/%s/r/%s/t/%s' % (wsid, welcome, tid)); time.sleep(1.5); shot(P, 'w%d_3_thread' % w)
                    if mob:
                        P.click('#thread .back'); time.sleep(0.8)
                        check('responsive', '%dpx: thread back -> room' % w, P.is_visible('#ta-main'))
                if mob:
                    P.click('#main .back'); time.sleep(0.8)
                    check('responsive', '%dpx: room back -> list' % w, P.is_visible('#side'))
                goto_hash(P, '#/w/%s/members' % wsid); time.sleep(1); shot(P, 'w%d_4_members' % w)
                goto_hash(P, '#/w/%s/r/%s/apps' % (wsid, welcome)); time.sleep(1.2); shot(P, 'w%d_5_apps' % w)
                goto_hash(P, '#/w/%s/usage' % wsid); time.sleep(1.5); shot(P, 'w%d_6_usage' % w)
                P.click('#bizzy-fab'); time.sleep(0.5); shot(P, 'w%d_7_bizzy' % w)
                errs = [e for e in P.errs if 'favicon' not in e]
                check('responsive', '%dpx: no JS errors' % w, not errs, errs[:3])
                ctx.close()
        t_responsive()

        check('console', 'no uncaught JS errors in user A', not [e for e in A.errs if 'Failed to load resource' not in e], [e for e in A.errs][:5])
        check('console', 'no uncaught JS errors in user B', not [e for e in B.errs if 'Failed to load resource' not in e], [e for e in B.errs][:5])
        browser.close()
    passed = sum(1 for r in RESULTS if r['ok']); failed = len(RESULTS) - passed
    json.dump(RESULTS, open(os.path.join(SHOTS, 'results.json'), 'w'), indent=1)
    print('\nTOTAL %d  PASS %d  FAIL %d' % (len(RESULTS), passed, failed))

if __name__ == '__main__':
    main()
