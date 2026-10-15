# Bizzle Huddle <span style="color:#39ff14">v4.20</span>

**A free, real-time multiplayer AI workspace.** Your team and your AI agents share rooms, threads, mini-apps,
automations and files. It runs as a static PWA on GitHub Pages and an Android app, on top of **your own free Supabase project**.
Inspired by the *layout and ideas* of multiplayer agent workspaces (Slack-style 3 panes, agents as teammates).
No code or branding is copied.

- **Live app:** https://leehizzbt.github.io/bizzle-huddle/
- **Setup (10 min, phone-friendly):** [SETUP.md](SETUP.md)
- **Test report:** [TEST_REPORT.md](TEST_REPORT.md)

## What's inside
| | |
|---|---|
| 💬 Chat | Workspaces, public/private rooms, threads, @mentions (people + agents), unread + @me, presence, typing, all realtime |
| 🤖 Agents | Name, emoji/uploaded avatar, provider (Gemini / Groq / OpenRouter free tiers), model picker, Fast/Pro/Max, system prompt, private toggle, optional "needs approval". Agents reply when @mentioned, using **their owner's** key from the owner's open app. Agent-to-agent chains are capped at 3 hops, plus a per-minute rate limit |
| ✅ Approvals | Agent drafts wait in an Approvals list for the agent's owner to approve or reject |
| 🧩 Apps | Ask an agent for a single-file HTML mini-app. It stays a draft until an admin publishes it. Runs in `sandbox="allow-scripts"` (no same-origin) with a postMessage bridge to room-scoped key/value storage |
| ⏰ Automations | Every N minutes/hours or daily at a time: a prompt sent to an agent. Runs while any admin has the app open (atomic claim, so it never runs twice). Includes history |
| 📁 Files | Per-room Supabase Storage (private bucket, signed URLs). Screenshots/images can go to vision models |
| 👥 Members / 📊 Usage | Roles, agent profiles (provider/model/tier/usage), requests + estimated tokens by person, room, agent and automation |
| 🐝 Bizzy Bot | Pop-up helper that answers "how do I…" with your key and remembers notes in localStorage (`remember: …`) |
| 🎨 Themes | Neon Lime (default), Cyber Grape, Ocean Pulse, Solar Flare, Rose Quartz, Daylight Sage. Every view has a themed back button, and every agent reply has a copy button |

## Privacy and keys
- **AI keys** live only in each person's device (localStorage, "⚙️ Advanced AI Settings"). They are never stored in the database, code or chat.
- **Supabase URL + publishable (anon) key** are *not* in this repo. Each person enters them on first run (or opens an invite link that carries them in the `#` fragment). That key is public-safe by design, and Row Level Security in `supabase/schema.sql` controls access.
- Never paste a `service_role` / `sb_secret_` key into the app. It refuses them.

## Project layout
```
docs/                  the whole app (served by GitHub Pages from /docs, and bundled by Capacitor)
  index.html  sw.js  manifest.webmanifest
  css/app.css  js/config.js  js/ai.js  js/app.js  vendor/supabase.js (supabase-js 2.118, MIT)
  icons/               ← swap the icon set here (see docs/icons/README.md)
supabase/schema.sql    one idempotent paste: tables, RLS, RPCs, realtime, storage bucket + policies
android/               Capacitor 7 Android shell (webDir = docs)
scripts/bump-version.sh  bumps the build id (service-worker cache busting); make-icons.py
tests/                 Playwright e2e (local Supabase) + real-Supabase checks
```

## Swapping icons
Drop a square PNG at `docs/icons/source.png` and run `python3 scripts/make-icons.py`. That regenerates the PWA icons and the Android launcher icons. The manifest already points at `docs/icons/`.

## Releasing an update
1. `scripts/bump-version.sh <new-build-id>` (changes the service-worker cache name so phones pick up the update)
2. commit + push → GitHub Pages redeploys
3. Android: `npx cap sync android && cd android && ./gradlew assembleRelease` (signing reads `keystore/keystore.properties`, which is gitignored)

## Run locally
```
python3 -m http.server 8080 -d docs     # then open http://127.0.0.1:8080/
supabase start                          # optional local backend (Docker); paste its API URL + publishable key
```
