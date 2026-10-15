# Bizzle Huddle v4.20: Supabase setup (phone-friendly, about 10 minutes, free)

Huddle has no server of its own. Your team's data lives in **your own free Supabase project**.
Each step fits on a phone screen. Checked against the Supabase dashboard and docs in October 2026.

## 1. Create the project
1. Open **https://supabase.com** and tap **Sign in**, then **Continue with GitHub**.
2. Tap **New project**. Pick your organization, give it a name (e.g. `bizzle-huddle`), set a database password (save it somewhere), choose the region closest to you, and keep the **Free** plan.
   - If you see a checkbox called **"Automatically expose new tables"**, you can leave it however it is. `schema.sql` adds the grants it needs either way.
3. Wait about a minute until the project says it is ready.

## 2. Create the tables (one paste)
1. In the left menu tap **SQL Editor**, then **New query**.
2. Open [`supabase/schema.sql`](supabase/schema.sql), tap **Raw**, select all, copy, and paste it into the editor.
3. Tap **Run**. You should see "Success. No rows returned". It's safe to run again later because the script is idempotent.

What the script creates: tables, Row Level Security policies, realtime publication, the private `huddle-files` storage bucket and its policies, plus the RPC functions (create/join workspace, approvals, atomic automation claims, unread counts).

## 3. Auth settings (important)
Go to **Authentication** in the left menu.

**a) URL Configuration** (Authentication → **URL Configuration**)
- **Site URL**: `https://leehizzbt.github.io/bizzle-huddle/`
- **Redirect URLs** → **Add URL**: `https://leehizzbt.github.io/bizzle-huddle/**`
  (The `**` wildcard lets the confirmation and magic links come back with the connection info Huddle adds to them.)

**b) Email confirmation: choose ONE of these**
- **Recommended for a small team: turn it off.** Go to Authentication → **Sign In / Providers** → **Email** (under User Signups) → switch off **Confirm email** → **Save**. Teammates can then sign up with email + password and start right away, on the web and in the Android app.
- **Keep it on (Supabase's default):** Huddle supports this. After signing up, the app says "check your email" and has a **Resend** button. The link opens Huddle already signed in. **But note:** Supabase's free built-in mailer only sends to people who are members of your Supabase *organization* (Organization settings → Team), and only about **2 emails per hour**. Anyone else gets "Email address not authorized". To email everyone, add free custom SMTP (Authentication → **Emails** (under Notifications) → **SMTP Settings** → Enable Custom SMTP. Brevo's free plan works with just a verified sender email. Resend's free plan needs a domain you own), or turn confirmation off as above.

Password sign-in works the same in the browser and the Android app. Magic links always open in the browser.

## 4. Copy the two connection values
1. Open your project's **Connect** button (top of the project page), or go to **Project Settings → API Keys**.
2. Copy the **Project URL** (looks like `https://abcdefgh.supabase.co`).
   (It's also under **Integrations → Data API**.)
3. Copy the **Publishable key** (`sb_publishable_…`). The older **anon** key (`eyJ…`, on the "Legacy API keys" tab) also works, but Supabase is phasing legacy keys out by the end of 2026, so use the publishable one.
4. **Never** copy the **secret** (`sb_secret_…`) or **service_role** key into Huddle. The app refuses them.

> Why is the publishable/anon key safe to share? It is designed to ship inside apps. On its own it can only do
> what the Row Level Security policies in `schema.sql` allow: signed-in members see only their own workspaces,
> rooms they can access, and so on. That's why Huddle's invite link can carry it.

## 5. Connect the app
1. Open **https://leehizzbt.github.io/bizzle-huddle/** (or the Android app).
2. Paste the Project URL and publishable key, then tap **Connect**. Huddle checks that the tables exist.
3. **Sign up**, name your workspace, then copy the **invite link** and send it to your team. The link carries the URL, key and invite code in the `#` part, so teammates don't have to type anything.

## 6. Free AI keys (each person, on their own device)
Open **⚙️ Advanced AI Settings** in the app and paste any of these free keys. They are stored only in that device's localStorage, never in the database:
- Google Gemini: https://aistudio.google.com/apikey
- Groq: https://console.groq.com/keys
- OpenRouter: https://openrouter.ai/keys (free models end in `:free`)

An agent answers using **its owner's** key, from the owner's open app.
