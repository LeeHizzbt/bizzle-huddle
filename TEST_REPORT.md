# Bizzle Huddle v4.20.1: Test report (2026-10-15, build 2026-10-15.9)

## Summary
| Suite | Backend | Result |
|---|---|---|
| `tests/e2e.py`: full two-user Playwright e2e (Chrome) | **Local Supabase** (Supabase CLI v2.121 in Docker) with `schema.sql` applied after all default Data-API grants were revoked (simulates "secure by default" projects) | **148 / 148 PASS** |
| `tests/real_supabase.py` against the **live GitHub Pages app** | **Nunya's real hosted Supabase project** (Confirm email OFF; publishable key and Gemini key from env, never printed) | **39 / 39 PASS**, and all test users and workspaces were deleted afterwards (project left with 0 users, 0 workspaces, 0 storage objects) |
| Android release APK on the API 30 emulator against the **real project** | real hosted Supabase | Invite deep link (`bizzlehuddle://join#/join?…`, sent with `adb am start`, nothing typed) pre-fills the connection and shows "You were invited". Sign-up on the device auto-joins the workspace. Presence works device ↔ desktop, and messages arrive live both ways |

### Real-project coverage (39 checks)
Auth settings reachable · schema visible · Connect screen accepts the publishable key · password sign-up → onboarding → workspace + auto Welcome room + step-2 invite screen · invite link carries url+key+code in `#` · fresh browser opening the link is pre-connected · invited user signs up and auto-joins · **already-signed-in user opening an invite link joins** (the bug found in the first real run) · presence both ways · messages A→B and B→A live · typing indicator · thread reply live · @mention counted live · agent created (no key in the row) · B @mentions A's agent → **live Gemini reply via A's device** · usage_event with tokens · needs-approval reply goes to Approvals, not the room · non-owner can't approve (RPC) · owner approves → posted · member creates a draft app · member can't publish (trigger) · admin publishes · `sandbox="allow-scripts"` · app isolated from parent DOM · KV bridge write by B shows live in A · automation saved · non-admin can't claim · **scheduled run claimed by the admin app and answered by the agent** · "Run now" adds a second ok run · file upload to real Storage + files row · other member downloads identical bytes · file listed · uploader deletes the object · no uncaught JS errors.

### Bugs found by the real-project runs (fixed in 4.20.1)
1. An invite link opened inside an already-running, signed-in app was ignored, so user B never joined. It's now processed on `hashchange`.
2. After sign-in, the app could override a navigation the user had already made. It now keeps it.
3. A session cached for an account deleted on the server crashed into "violates foreign key constraint profiles_id_fkey". The app now verifies the session, signs out locally, and shows sign-in (verified locally after deleting a user).
4. Added an Android invite deep link (`bizzlehuddle://`) so phones can join without typing a URL or key.

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
- `android_02_invite_deeplink_auth.png`, `android_03_joined_real_workspace.png`, `android_04_realtime_from_desktop.png`: deep-link invite → joined real workspace → live message from desktop (cropped so no project URL shows).
- `results.json` / `results-real.json`: machine-readable results.

## What was NOT tested (honest list)
- **Some checks ran only locally, not on the real project**: rate limit, 3-hop agent-loop cap, members/role changes and removal, private rooms and agents, Bizzy Bot, themes, responsive widths, vision. They passed on local Supabase, which runs the same services.
- **Confirm email ON**: the real project now has it OFF, so the confirmation-email path was only checked for UI messaging, not delivery.
- **Hosted email delivery**: confirmation emails, magic links, Resend button, and redirect back to Pages. The confirmation-required UI path is implemented, but delivery depends on Supabase's built-in mailer (team-only, about 2 per hour).
- **Groq and OpenRouter live replies**: no keys in env. Request format and error handling were verified, but no real responses. Gemini was tested live; Gemini Pro/Max tiers depend on free quota (fallback to Flash-Lite is implemented and tested).
- **Android**: on the emulator: deep-link invite, sign-up, auto-join, presence, and send/receive against the real project, plus hardware back. Not tested: file picker, camera, agents running on the phone, or a physical device. The soft-keyboard Enter key inserts a newline on Android, so you send with the ➤ button. The device run used build .7; .8 and .9 only change post-login navigation and deleted-account handling, and the .9 APK was relaunched on the emulator, where it recovered from the deleted test account to the sign-in screen (`android_05_deleted_account_recovers.png`).
- **Safari/iOS and Firefox**: not tested (Chrome only).
- **Long-running behaviour**: automations only run while an admin's app is open, and agents only answer while their owner's app is open. Background execution with every app closed is impossible by design (no server).
