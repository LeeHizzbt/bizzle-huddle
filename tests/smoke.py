import os, re, sys, time, json
from playwright.sync_api import sync_playwright
ENV = {}
for line in open('/workspace/.huddle-local-sb.env'):
    k, _, v = line.strip().partition('='); ENV[k] = v.strip('"')
BASE = os.environ.get('BASE', 'http://127.0.0.1:8080/')
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.goto(BASE)
    pg.fill('#c-url', ENV['API_URL']); pg.fill('#c-key', ENV['ANON_KEY']); pg.click('#c-save')
    pg.wait_for_selector('#a-tabs', timeout=15000)
    pg.click('#a-tabs button[data-t=signup]')
    em = 'smoke%d@example.com' % int(time.time())
    pg.fill('#a-name', 'Smoky'); pg.fill('#a-email', em); pg.fill('#a-pass', 'password123'); pg.click('#a-go')
    pg.wait_for_selector('#o-name', timeout=15000)
    pg.fill('#o-name', 'Smoke HQ'); pg.click('#o-go')
    pg.wait_for_selector('#inv-link', timeout=15000)
    pg.screenshot(path='/tmp/s1.png')
    pg.click('#i-go'); pg.wait_for_selector('#ta-main', timeout=15000)
    time.sleep(1.5)
    pg.fill('#ta-main', 'hello world'); pg.keyboard.press('Enter'); time.sleep(1.5)
    pg.screenshot(path='/tmp/s2.png')
    print('\n'.join(errs[:30]))
    b.close()
