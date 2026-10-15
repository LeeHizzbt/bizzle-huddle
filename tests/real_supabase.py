"""Real hosted-Supabase checks. Reads HUDDLE_SUPABASE_URL / HUDDLE_SUPABASE_ANON_KEY from env.
Never prints them and takes no screenshots (the UI shows the project host).
Usage: python tests/real_supabase.py [base_url]   (default http://127.0.0.1:8080/)"""
import os, sys, json, time, random, string, urllib.request
from playwright.sync_api import sync_playwright

URL = os.environ.get('HUDDLE_SUPABASE_URL', '').rstrip('/'); KEY = os.environ.get('HUDDLE_SUPABASE_ANON_KEY', '')
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8080/'
res = []
def check(area, name, ok, detail=''):
    d = str(detail).replace(URL, '<url>').replace(KEY, '<key>') if URL and KEY else str(detail)
    res.append((area, name, bool(ok), d)); print(('PASS' if ok else 'FAIL'), area, '::', name, ('— ' + d[:160]) if (d and not ok) else '', flush=True)
def http(path, method='GET', body=None, token=None):
    req = urllib.request.Request(URL + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'apikey': KEY, 'Authorization': 'Bearer ' + (token or KEY), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()

if not URL or not KEY: print('env vars missing'); sys.exit(2)
st, body = http('/auth/v1/settings'); s = json.loads(body) if st == 200 else {}
check('real', 'auth settings reachable with publishable key', st == 200, st)
autoconfirm = s.get('mailer_autoconfirm'); check('real', 'email provider enabled', s.get('external', {}).get('email'))
print('INFO mailer_autoconfirm (Confirm email OFF) =', autoconfirm, flush=True)
st, body = http('/rest/v1/workspaces?select=id&limit=1')
schema = st == 200
print('INFO schema applied =', schema, '(rest status %s)' % st, flush=True)

with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = br.new_context(); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE + '#/'); pg.wait_for_selector('#c-url')
    pg.fill('#c-url', URL); pg.fill('#c-key', KEY); pg.click('#c-save')
    if not schema:
        pg.wait_for_function('() => /tables are missing/.test(document.querySelector("#toasts").innerText)', timeout=20000)
        check('real', 'connect screen detects missing schema with a clear message', True)
    else:
        pg.wait_for_selector('#a-tabs', timeout=20000); check('real', 'connect accepted, auth screen shown', True)
        stamp = ''.join(random.choice(string.ascii_lowercase) for _ in range(6))
        users = []
        for n in ('ann', 'bob'):
            c = br.new_context(); q = c.new_page(); q.on('pageerror', lambda e: errs.append(str(e)))
            q.goto(BASE + '#/'); q.wait_for_selector('#c-url'); q.fill('#c-url', URL); q.fill('#c-key', KEY); q.click('#c-save')
            q.wait_for_selector('#a-tabs'); q.click('#a-tabs button[data-t=signup]')
            q.fill('#a-name', n.title()); q.fill('#a-email', 'huddle.test.%s.%s@example.com' % (n, stamp)); q.fill('#a-pass', 'Test-' + stamp + '-pw!'); q.click('#a-go')
            time.sleep(4); users.append(q)
        msg = users[0].inner_text('#a-msg') if users[0].locator('#a-msg').count() else ''
        if not autoconfirm:
            check('real', 'signup with Confirm email ON shows the clear check-your-email / not-authorized message', ('Almost there' in msg) or ('not authorized' in msg.lower()) or ('mailer' in msg.lower()) or ('rate limit' in msg.lower()) or ('emails per hour' in msg.lower()), msg[:200])
            print('INFO multi-user realtime test needs Confirm email OFF; skipped', flush=True)
        else:
            A, B = users
            A.wait_for_selector('#o-name', timeout=20000); A.fill('#o-name', 'Real Test ' + stamp); A.click('#o-go')
            A.wait_for_function('() => window.__huddle && window.__huddle.S.ws', timeout=30000)
            check('real', 'workspace created on hosted Supabase', True)
            link = A.evaluate('() => window.__huddle.inviteLink()')
            B.goto(link.replace('https://leehizzbt.github.io/bizzle-huddle/', BASE)); time.sleep(1); B.reload()
            B.wait_for_function('() => window.__huddle && window.__huddle.S.ws', timeout=30000)
            check('real', 'second user joined via invite link', True)
            A.wait_for_function('() => !!document.querySelector("#ta-main")', timeout=20000)
            B.wait_for_function('() => !!document.querySelector("#ta-main")', timeout=20000)
            B.wait_for_function('() => window.__huddle.S.online && Object.keys(window.__huddle.S.online).length >= 2', timeout=20000)
            check('real', 'presence shows both users', True)
            A.fill('#ta-main', 'hello from Ann ' + stamp); A.press('#ta-main', 'Enter')
            B.wait_for_function('s => document.querySelector("#msgs").innerText.includes(s)', arg='hello from Ann ' + stamp, timeout=20000)
            check('real', 'realtime message delivered A -> B', True)
            B.fill('#ta-main', 'typing...'); 
            try: A.wait_for_function('() => /typing/i.test(document.body.innerText)', timeout=8000); check('real', 'typing indicator', True)
            except Exception as e: check('real', 'typing indicator', False, e)
            B.fill('#ta-main', 'hi Ann ' + stamp); B.press('#ta-main', 'Enter')
            A.wait_for_function('s => document.querySelector("#msgs").innerText.includes(s)', arg='hi Ann ' + stamp, timeout=20000)
            check('real', 'realtime message delivered B -> A', True)
    check('real', 'no uncaught JS errors', not errs, errs[:2])
    br.close()
p_ = sum(1 for r in res if r[2]); print('\nTOTAL %d  PASS %d  FAIL %d' % (len(res), p_, len(res) - p_))
json.dump([dict(area=a, name=n, ok=o, detail=d) for a, n, o, d in res], open(os.path.join(os.path.dirname(__file__), '..', 'test-shots', 'results-real.json'), 'w'), indent=1)
