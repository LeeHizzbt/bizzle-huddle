# Bizzle Huddle v4.20: Test report (2026-10-15, build 2026-10-15.6)

## Summary
| Suite | Backend | Result |
|---|---|---|
| `tests/e2e.py`: full two-user Playwright e2e (Chrome) | **Local Supabase** (Supabase CLI v2.121 in Docker: Postgres, GoTrue auth, Realtime, Storage, PostgREST) with `schema.sql` applied after **revoking all default Data-API grants** (simulates the new "secure by default" projects) | **148 / 148 PASS** |
| `tests/real_supabase.py` against the **live GitHub Pages app** | **Nunya's real hosted Supabase project** (publishable key from env, never printed) | **4 / 4 PASS** (schema not applied yet, so only connectivity, auth settings, and the "tables missing" path) |
| Android release APK on emulator (API 30, `kief30`, software rendering) | none | App installs and launches, and the neon Connect screen renders in the API 30 WebView (supabase-js lowered to Chrome 80 syntax) with no console errors |

Earlier full runs found real bugs, all fixed: room creation blocked by RLS (`INSERT … RETURNING` visibility), first-visit reload loop from the service worker, back button ignoring non-`go()` navigation, missed member events after a realtime reconnect (now self-healing), no retry on Gemini 503s, and the Bizzy button overlapping the composer on phones.

## Coverage by area (e2e, 148 checks)
connect 6 · auth 1 · onboarding 5 · invite 4 · presence 3 · realtime 2 · typing 1 · unread 4 · mentions 2 · sidebar 1 · threads 5 · nav 3 · ai 17 · agents 7 · usage 7 · security 8 · agent-chain 3 · approvals 6 · apps 12 · automations 6 · files 4 · rooms 1 · members 6 · bizzy 4 · themes 1 · branding 1 · pwa 3 · responsive 23 · console 2

What these checks exercise:
- **Connect screen**: shows on first run; explains why the anon/publishable key is public-safe; rejects `service_role` keys; rejects bad keys with a message; detects a missing schema.
- **Onboarding**: sign-up, naming the workspace, auto Welcome room, invite link with URL+key+code in the `#` fragment. User B joins through that link.
- **Two users (A and B in separate browser contexts)**: realtime messages both ways, presence dots, typing indicator, live unread counts, @mention counts, Unread and @me tabs, threads with live replies, last_read persisted.
- **Agents (real Gemini, key from env)**: New Agent dialog saves the row; @mention gets a reply from the owner's device; copy button copies the reply; usage_events logged with tokens; atomic job claim; key never present in a DB dump; missing-key error posted clearly.
- **Agent safety**: agent-to-agent chain (Ping → Pong); loop stops at 3 hops; per-minute rate limit (6 then blocked); forged agent messages and fake hop counts blocked by RLS.
- **Approvals**: a needs-approval reply goes to the Approvals list; a non-owner can't approve (UI and RLS); rail badge; approve posts the reply, reject posts nothing.
- **Apps**: agent builds a single-file HTML draft (real Gemini); a member can't publish (DB trigger); admin publishes. The iframe is `sandbox="allow-scripts"` and can't reach the parent DOM. Bridge KV saves are room-scoped, the other user reads the same data, and realtime `onChange` reaches the open app.
- **Automations**: saved as every 1 minute; 3 concurrent claims give exactly 1 run; a non-admin claims nothing; the scheduled run executes through the agent; "Run now" works; history recorded.
- **Files**: upload/download round trip; an image attachment renders for the other user; **vision**: Gemini reads the text in an uploaded image.
- **Privacy**: private room and private agent are hidden from non-members; add member through the room members modal.
- **Members**: promote/demote (reaches B live), agent profile, admin removes a member, a removed member loses message access, a member can't remove the admin.
- **Other**: Usage tabs (people/rooms/agents/automations); AI request formation for Groq / OpenRouter / Gemini (URLs, auth headers, models, system prompt, temperature, max tokens, image parts vs text fallback, reasoning effort); bad-key 401 handling; OpenRouter model list; Bizzy Bot memory persisting across reloads; themes; neon v4.20 badge; back button on 10 views and back returning to the previous view; manifest, SW, icons.
- **Responsive**: 7 views at 360 / 390 / 768 / 1024 / 1440 px; no horizontal overflow; single-pane with bottom nav on phones; no uncaught JS errors for either user.

## Screenshots (`test-shots/`)
- `01_connect_1440.png` … `24_theme_*.png`: the feature walkthrough.
- `w360_* w390_* w768_* w1024_* w1440_*` (`1_home 2_room 3_thread 4_members 5_apps 6_usage 7_bizzy`).
- `android_01_connect.png`: release APK on the API 30 emulator.
- `results.json` / `results-real.json`: machine-readable results.

## What was NOT tested (honest list)
- **Multi-user flows on the real hosted Supabase**: `schema.sql` isn't applied there yet (publishable key only, no DB access). Every multi-user, realtime, RLS, storage, and automation result above comes from the **local** Supabase stack, which runs the same open-source services. Once the schema is pasted, `python tests/real_supabase.py` signs up two users and checks workspace, invite, presence, realtime both ways, and typing. That needs **Confirm email OFF**, because test addresses can't receive mail.
- **Hosted email delivery**: confirmation emails, magic links, Resend button, and redirect back to Pages. The confirmation-required UI path is implemented, but delivery depends on Supabase's built-in mailer (team-only, about 2 per hour).
- **Groq and OpenRouter live replies**: no keys in env. Request format and error handling were verified, but no real responses. Gemini was tested live; Gemini Pro/Max tiers depend on free quota (fallback to Flash-Lite is implemented and tested).
- **Android**: launch and render only. One on-device attempt to connect to the real project (typing the URL and key with `adb input text` on the very slow emulator) showed "Key rejected (401)". The same key gets a normal response from the server when sent with the WebView's User-Agent and Origin, and works in Chrome against the live site, so mangled emulator text input is the likely cause. That is unconfirmed, so on-device connect remains untested. No sign-in, chat, file picker, or camera on-device (the emulator is software-rendered and very slow; it crashed once mid-test). Not tested on a physical phone.
- **Safari/iOS and Firefox**: not tested (Chrome only).
- **Long-running behaviour**: automations only run while an admin's app is open, and agents only answer while their owner's app is open. Background execution with every app closed is impossible by design (no server).
