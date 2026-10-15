-- =====================================================================
--  Bizzle Huddle v4.20 — complete Supabase schema
--  Paste this whole file into Supabase Dashboard > SQL Editor > Run.
--  Safe to re-run: tables use IF NOT EXISTS, policies/functions are
--  dropped and recreated, publication + bucket inserts are guarded.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'New friend',
  avatar       text default '🙂',
  created_at   timestamptz not null default now()
);

create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique default encode(gen_random_bytes(9), 'hex'),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('admin','member')),
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  topic        text default '',
  is_private   boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id      uuid not null references public.rooms(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('admin','member')),
  last_read_at timestamptz not null default now(),
  joined_at    timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.agents (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  owner_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name           text not null check (char_length(name) between 1 and 40),
  avatar         text default '🤖',          -- emoji or small data: URL
  specialty      text default '',
  provider       text not null default 'gemini' check (provider in ('gemini','groq','openrouter')),
  model          text not null default '',
  effort         text not null default 'Pro' check (effort in ('Fast','Pro','Max')),
  system_prompt  text not null default '',
  is_private     boolean not null default false,
  needs_approval boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  room_id        uuid not null references public.rooms(id) on delete cascade,
  parent_id      uuid references public.messages(id) on delete cascade,   -- thread parent
  author_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  agent_id       uuid references public.agents(id) on delete set null,     -- set when an agent wrote it
  content        text not null default '' check (char_length(content) <= 60000),
  mention_users  uuid[] not null default '{}',
  mention_agents uuid[] not null default '{}',
  attachments    jsonb not null default '[]',   -- [{path,name,mime,size}]
  hop            int not null default 0 check (hop between 0 and 10),
  meta           jsonb not null default '{}',
  edited_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists messages_room_created on public.messages(room_id, created_at desc);
create index if not exists messages_parent on public.messages(parent_id);
create index if not exists messages_ws_created on public.messages(workspace_id, created_at desc);
create index if not exists messages_mention_users on public.messages using gin(mention_users);

-- one row per (message, agent): an atomic claim so only ONE device runs an agent reply
create table if not exists public.agent_jobs (
  message_id uuid not null references public.messages(id) on delete cascade,
  agent_id   uuid not null references public.agents(id) on delete cascade,
  claimed_by uuid not null default auth.uid(),
  claimed_at timestamptz not null default now(),
  primary key (message_id, agent_id)
);

create table if not exists public.approvals (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  room_id        uuid not null references public.rooms(id) on delete cascade,
  parent_id      uuid references public.messages(id) on delete set null,
  agent_id       uuid not null references public.agents(id) on delete cascade,
  owner_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  content        text not null,
  mention_users  uuid[] not null default '{}',
  mention_agents uuid[] not null default '{}',
  hop            int not null default 1,
  meta           jsonb not null default '{}',
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.apps (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id      uuid not null references public.rooms(id) on delete cascade,
  name         text not null default 'Untitled app',
  prompt       text default '',
  html         text not null default '',
  status       text not null default 'draft' check (status in ('building','draft','published','failed')),
  agent_id     uuid references public.agents(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  approved_by  uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- room-scoped key/value store for sandboxed mini-apps (postMessage bridge)
create table if not exists public.app_kv (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  app_id     uuid not null references public.apps(id) on delete cascade,
  key        text not null check (char_length(key) between 1 and 200),
  value      jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (app_id, key)
);

create table if not exists public.automations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  room_id       uuid not null references public.rooms(id) on delete cascade,
  agent_id      uuid references public.agents(id) on delete set null,
  name          text not null default 'Automation',
  prompt        text not null,
  schedule_kind text not null default 'interval' check (schedule_kind in ('interval','daily')),
  every_minutes int  check (every_minutes is null or every_minutes >= 1),
  daily_time    time,
  tz            text not null default 'UTC',
  enabled       boolean not null default true,
  last_run      timestamptz,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

create table if not exists public.automation_runs (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  room_id       uuid not null references public.rooms(id) on delete cascade,
  run_by        uuid references auth.users(id) on delete set null default auth.uid(),
  status        text not null default 'claimed' check (status in ('claimed','dispatched','ok','error')),
  output        text default '',
  message_id    uuid references public.messages(id) on delete set null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id      uuid not null references public.rooms(id) on delete cascade,
  path         text not null unique,     -- storage object path in bucket huddle-files
  name         text not null,
  mime         text default 'application/octet-stream',
  size         bigint default 0,
  uploaded_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.usage_events (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  room_id           uuid references public.rooms(id) on delete set null,
  agent_id          uuid references public.agents(id) on delete set null,
  automation_id     uuid references public.automations(id) on delete set null,
  user_id           uuid references auth.users(id) on delete set null default auth.uid(),
  kind              text not null default 'chat',   -- chat | app | automation | helper
  provider          text,
  model             text,
  prompt_tokens     int not null default 0,
  completion_tokens int not null default 0,
  estimated         boolean not null default false,
  ok                boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists usage_ws_created on public.usage_events(workspace_id, created_at desc);

-- ---------------------------------------------------------------------
-- HELPER FUNCTIONS (security definer => no RLS recursion)
-- ---------------------------------------------------------------------
create or replace function public.is_ws_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.is_ws_admin(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.can_access_room(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from rooms ro
    join workspace_members wm on wm.workspace_id = ro.workspace_id and wm.user_id = auth.uid()
    where ro.id = r
      and (not ro.is_private
           or wm.role = 'admin'
           or ro.created_by = auth.uid()
           or exists(select 1 from room_members rm where rm.room_id = ro.id and rm.user_id = auth.uid()))
  );
$$;

create or replace function public.shares_ws_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select other = auth.uid() or exists(
    select 1 from workspace_members a join workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other);
$$;

create or replace function public.safe_uuid(t text) returns uuid
language plpgsql immutable as $$
begin return t::uuid; exception when others then return null; end; $$;

-- ---------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1), 'friend'))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- only admins may publish apps; stamp who approved
create or replace function public.apps_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if not is_ws_admin(new.workspace_id) then
      raise exception 'Only a workspace admin can publish an app';
    end if;
    new.approved_by := auth.uid();
    new.published_at := now();
  end if;
  -- editing the HTML of a published app sends it back to draft (needs re-approval)
  if tg_op = 'UPDATE' and old.status = 'published' and new.html is distinct from old.html
     and new.status = 'published' then
    new.status := 'draft'; new.approved_by := null; new.published_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists apps_guard on public.apps;
create trigger apps_guard before insert or update on public.apps
  for each row execute function public.apps_guard();

-- protect role changes: cannot demote the last admin
create or replace function public.members_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin') or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    if (select count(*) from workspace_members where workspace_id = old.workspace_id and role = 'admin') <= 1
       and exists(select 1 from workspaces where id = old.workspace_id) then
      raise exception 'A workspace needs at least one admin';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
drop trigger if exists members_guard on public.workspace_members;
create trigger members_guard before update or delete on public.workspace_members
  for each row execute function public.members_guard();

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
-- create a workspace + admin membership + Welcome room + welcome message
create or replace function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; rm uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into workspaces(name, created_by) values (p_name, auth.uid()) returning id into ws;
  insert into workspace_members(workspace_id, user_id, role) values (ws, auth.uid(), 'admin');
  insert into rooms(workspace_id, name, topic, created_by)
    values (ws, 'welcome', 'Say hi! Start here.', auth.uid()) returning id into rm;
  insert into room_members(room_id, user_id, role) values (rm, auth.uid(), 'admin');
  insert into messages(workspace_id, room_id, author_id, content, meta)
    values (ws, rm, auth.uid(),
      '👋 Welcome to **' || p_name || '**! Invite your crew with the invite link, add an AI agent from Members → New agent, then @mention it here.',
      '{"system":true}');
  return ws;
end; $$;

-- join with an invite code
create or replace function public.join_workspace(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; rm uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into ws from workspaces where invite_code = p_code;
  if ws is null then raise exception 'Invite code not found'; end if;
  insert into workspace_members(workspace_id, user_id, role) values (ws, auth.uid(), 'member')
    on conflict do nothing;
  for rm in select id from rooms where workspace_id = ws and not is_private loop
    insert into room_members(room_id, user_id) values (rm, auth.uid()) on conflict do nothing;
  end loop;
  return ws;
end; $$;

-- admins can rotate the invite code
create or replace function public.rotate_invite(p_ws uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not is_ws_admin(p_ws) then raise exception 'admins only'; end if;
  update workspaces set invite_code = encode(gen_random_bytes(9),'hex') where id = p_ws returning invite_code into c;
  return c;
end; $$;

-- atomic claim so one device runs an agent reply (returns false if already claimed)
create or replace function public.claim_agent_job(p_message uuid, p_agent uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists(select 1 from agents where id = p_agent and owner_id = auth.uid()) then return false; end if;
  insert into agent_jobs(message_id, agent_id, claimed_by) values (p_message, p_agent, auth.uid())
    on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end; $$;

-- approve / reject an agent draft. Approve posts the message as the agent.
create or replace function public.decide_approval(p_id uuid, p_approve boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare a approvals; mid uuid;
begin
  select * into a from approvals where id = p_id for update;
  if a.id is null then raise exception 'approval not found'; end if;
  if a.status <> 'pending' then raise exception 'already decided'; end if;
  if not (a.owner_id = auth.uid() or is_ws_admin(a.workspace_id)) then
    raise exception 'only the agent owner or an admin can decide';
  end if;
  if p_approve then
    insert into messages(workspace_id, room_id, parent_id, author_id, agent_id, content,
                         mention_users, mention_agents, hop, meta)
    values (a.workspace_id, a.room_id, a.parent_id, a.owner_id, a.agent_id, a.content,
            a.mention_users, a.mention_agents, a.hop, a.meta || jsonb_build_object('approved_by', auth.uid()))
    returning id into mid;
  end if;
  update approvals set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now() where id = p_id;
  return mid;
end; $$;

-- atomically claim every automation that is due right now (admins only).
-- last_run is moved forward inside one UPDATE with SKIP LOCKED, so two admin
-- devices polling at the same moment can never both run the same automation.
create or replace function public.claim_due_automations(p_ws uuid)
returns setof public.automation_runs
language plpgsql security definer set search_path = public as $$
begin
  if not is_ws_admin(p_ws) then return; end if;
  return query
  with due as (
    select a.id from automations a
    where a.workspace_id = p_ws and a.enabled
      and (
        (a.schedule_kind = 'interval' and a.every_minutes is not null
          and (a.last_run is null or a.last_run <= now() - make_interval(mins => a.every_minutes)))
        or
        (a.schedule_kind = 'daily' and a.daily_time is not null
          and now() >= ((date_trunc('day', now() at time zone a.tz) + a.daily_time) at time zone a.tz)
          and (a.last_run is null or a.last_run < ((date_trunc('day', now() at time zone a.tz) + a.daily_time) at time zone a.tz)))
      )
    for update skip locked
  ), upd as (
    update automations a set last_run = now() from due where a.id = due.id
    returning a.id, a.workspace_id, a.room_id
  )
  insert into automation_runs(automation_id, workspace_id, room_id, run_by, status)
  select upd.id, upd.workspace_id, upd.room_id, auth.uid(), 'claimed' from upd
  returning *;
end; $$;

-- "Run now" button (room members who can see it). Same claim row, ignores schedule.
create or replace function public.run_automation_now(p_id uuid) returns public.automation_runs
language plpgsql security definer set search_path = public as $$
declare a automations; r automation_runs;
begin
  select * into a from automations where id = p_id for update;
  if a.id is null or not can_access_room(a.room_id) then raise exception 'not allowed'; end if;
  update automations set last_run = now() where id = p_id;
  insert into automation_runs(automation_id, workspace_id, room_id, run_by, status)
    values (a.id, a.workspace_id, a.room_id, auth.uid(), 'claimed') returning * into r;
  return r;
end; $$;

-- unread + @mention counts for every room I can see
create or replace function public.unread_counts(p_ws uuid)
returns table(room_id uuid, unread bigint, mentions bigint)
language sql stable security invoker set search_path = public as $$
  select r.id,
    (select count(*) from messages m where m.room_id = r.id and m.parent_id is null
       and m.author_id <> auth.uid()
       and m.created_at > coalesce(rm.last_read_at, '-infinity')),
    (select count(*) from messages m where m.room_id = r.id
       and auth.uid() = any(m.mention_users)
       and m.created_at > coalesce(rm.last_read_at, '-infinity'))
  from rooms r
  left join room_members rm on rm.room_id = r.id and rm.user_id = auth.uid()
  where r.workspace_id = p_ws;
$$;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.rooms             enable row level security;
alter table public.room_members      enable row level security;
alter table public.agents            enable row level security;
alter table public.messages          enable row level security;
alter table public.agent_jobs        enable row level security;
alter table public.approvals         enable row level security;
alter table public.apps              enable row level security;
alter table public.app_kv            enable row level security;
alter table public.automations       enable row level security;
alter table public.automation_runs   enable row level security;
alter table public.files             enable row level security;
alter table public.usage_events      enable row level security;

-- drop every existing policy on our tables so this script is re-runnable
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('profiles','workspaces','workspace_members','rooms','room_members','agents','messages',
                      'agent_jobs','approvals','apps','app_kv','automations','automation_runs','files','usage_events')
  loop execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename); end loop;
end $$;

-- profiles
create policy profiles_select on public.profiles for select to authenticated using (shares_ws_with(id));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- workspaces (creation goes through create_workspace RPC)
create policy ws_select on public.workspaces for select to authenticated using (is_ws_member(id));
create policy ws_update on public.workspaces for update to authenticated using (is_ws_admin(id)) with check (is_ws_admin(id));
create policy ws_delete on public.workspaces for delete to authenticated using (is_ws_admin(id));

-- workspace_members (joining goes through join_workspace RPC)
create policy wm_select on public.workspace_members for select to authenticated using (is_ws_member(workspace_id));
create policy wm_update on public.workspace_members for update to authenticated using (is_ws_admin(workspace_id)) with check (is_ws_admin(workspace_id));
create policy wm_delete on public.workspace_members for delete to authenticated using (is_ws_admin(workspace_id) or user_id = auth.uid());

-- rooms
-- uses the row's own columns (a lookup by id would not see a row inserted in the same statement)
create policy rooms_select on public.rooms for select to authenticated using (
  is_ws_member(workspace_id) and (not is_private or created_by = auth.uid() or is_ws_admin(workspace_id)
    or exists(select 1 from room_members rm where rm.room_id = rooms.id and rm.user_id = auth.uid())));
create policy rooms_insert on public.rooms for insert to authenticated with check (is_ws_member(workspace_id) and created_by = auth.uid());
create policy rooms_update on public.rooms for update to authenticated using (is_ws_admin(workspace_id) or created_by = auth.uid());
create policy rooms_delete on public.rooms for delete to authenticated using (is_ws_admin(workspace_id) or created_by = auth.uid());

-- room_members
create policy rm_select on public.room_members for select to authenticated using (can_access_room(room_id));
create policy rm_insert on public.room_members for insert to authenticated with check (
  -- join a public room yourself, or be added by someone who can access the room
  exists(select 1 from rooms r where r.id = room_id and is_ws_member(r.workspace_id)
         and is_ws_member(r.workspace_id) and (
           (user_id = auth.uid() and not r.is_private) or r.created_by = auth.uid()
           or (can_access_room(r.id) and exists(select 1 from workspace_members w where w.workspace_id = r.workspace_id and w.user_id = room_members.user_id))
         )));
create policy rm_update on public.room_members for update to authenticated using (
  user_id = auth.uid() or exists(select 1 from rooms r where r.id = room_id and is_ws_admin(r.workspace_id)));
create policy rm_delete on public.room_members for delete to authenticated using (
  user_id = auth.uid() or exists(select 1 from rooms r where r.id = room_id and (is_ws_admin(r.workspace_id) or r.created_by = auth.uid())));

-- agents: private agents are visible only to their owner
create policy agents_select on public.agents for select to authenticated using (is_ws_member(workspace_id) and (not is_private or owner_id = auth.uid()));
create policy agents_insert on public.agents for insert to authenticated with check (is_ws_member(workspace_id) and owner_id = auth.uid());
create policy agents_update on public.agents for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy agents_delete on public.agents for delete to authenticated using (owner_id = auth.uid() or is_ws_admin(workspace_id));

-- messages: agent messages may only be written by that agent's owner
create policy msg_select on public.messages for select to authenticated using (can_access_room(room_id));
create policy msg_insert on public.messages for insert to authenticated with check (
  author_id = auth.uid() and can_access_room(room_id)
  and exists(select 1 from rooms r where r.id = room_id and r.workspace_id = messages.workspace_id)
  and (agent_id is null or exists(select 1 from agents a where a.id = agent_id and a.owner_id = auth.uid()))
  and (hop = 0 or agent_id is not null));
create policy msg_update on public.messages for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy msg_delete on public.messages for delete to authenticated using (author_id = auth.uid() or is_ws_admin(workspace_id));

-- agent_jobs (written by claim_agent_job RPC)
create policy jobs_select on public.agent_jobs for select to authenticated using (claimed_by = auth.uid());

-- approvals
create policy appr_select on public.approvals for select to authenticated using (can_access_room(room_id));
create policy appr_insert on public.approvals for insert to authenticated with check (
  owner_id = auth.uid() and can_access_room(room_id)
  and exists(select 1 from agents a where a.id = agent_id and a.owner_id = auth.uid()));

-- apps (publish is enforced by apps_guard trigger)
create policy apps_select on public.apps for select to authenticated using (can_access_room(room_id));
create policy apps_insert on public.apps for insert to authenticated with check (can_access_room(room_id) and created_by = auth.uid()
  and exists(select 1 from rooms r where r.id = room_id and r.workspace_id = apps.workspace_id));
create policy apps_update on public.apps for update to authenticated using (can_access_room(room_id)) with check (can_access_room(room_id));
create policy apps_delete on public.apps for delete to authenticated using (created_by = auth.uid() or is_ws_admin(workspace_id));

-- app_kv
create policy kv_select on public.app_kv for select to authenticated using (can_access_room(room_id));
create policy kv_insert on public.app_kv for insert to authenticated with check (can_access_room(room_id)
  and exists(select 1 from apps a where a.id = app_id and a.room_id = app_kv.room_id));
create policy kv_update on public.app_kv for update to authenticated using (can_access_room(room_id)) with check (can_access_room(room_id)
  and exists(select 1 from apps a where a.id = app_id and a.room_id = app_kv.room_id));
create policy kv_delete on public.app_kv for delete to authenticated using (can_access_room(room_id));

-- automations
create policy auto_select on public.automations for select to authenticated using (can_access_room(room_id));
create policy auto_insert on public.automations for insert to authenticated with check (can_access_room(room_id) and created_by = auth.uid()
  and exists(select 1 from rooms r where r.id = room_id and r.workspace_id = automations.workspace_id));
create policy auto_update on public.automations for update to authenticated using (created_by = auth.uid() or is_ws_admin(workspace_id));
create policy auto_delete on public.automations for delete to authenticated using (created_by = auth.uid() or is_ws_admin(workspace_id));

-- automation_runs (rows are created by the claim RPCs)
create policy runs_select on public.automation_runs for select to authenticated using (can_access_room(room_id));
create policy runs_update on public.automation_runs for update to authenticated using (can_access_room(room_id)) with check (can_access_room(room_id));

-- files
create policy files_select on public.files for select to authenticated using (can_access_room(room_id));
create policy files_insert on public.files for insert to authenticated with check (can_access_room(room_id) and uploaded_by = auth.uid());
create policy files_delete on public.files for delete to authenticated using (uploaded_by = auth.uid() or is_ws_admin(workspace_id));

-- usage_events
create policy usage_select on public.usage_events for select to authenticated using (is_ws_member(workspace_id));
create policy usage_insert on public.usage_events for insert to authenticated with check (is_ws_member(workspace_id) and user_id = auth.uid());

-- ---------------------------------------------------------------------
-- GRANTS. Newer Supabase projects no longer expose public tables to the Data API automatically
-- ("secure by default", rolling out to all projects by Oct 30 2026), so the grants below are REQUIRED.
-- RLS policies above still decide which rows each user can see or change.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- anon (signed-out) only gets a harmless read on workspaces so the app's Connect screen can verify the
-- schema exists; RLS has no anon policy, so it always returns zero rows.
grant select on public.workspaces to anon;
revoke execute on function public.handle_new_user() from anon, authenticated;

-- ---------------------------------------------------------------------
-- REALTIME publication (postgres_changes respects RLS)
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['messages','rooms','room_members','workspace_members','agents','approvals',
                           'apps','app_kv','automations','automation_runs','files','profiles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- full old rows on UPDATE/DELETE so clients can react properly
alter table public.messages replica identity full;
alter table public.approvals replica identity full;
alter table public.apps replica identity full;

-- ---------------------------------------------------------------------
-- STORAGE: private bucket "huddle-files", path = <workspace_id>/<room_id>/<file>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('huddle-files', 'huddle-files', false, 52428800)
on conflict (id) do nothing;

drop policy if exists huddle_files_select on storage.objects;
drop policy if exists huddle_files_insert on storage.objects;
drop policy if exists huddle_files_delete on storage.objects;
create policy huddle_files_select on storage.objects for select to authenticated
  using (bucket_id = 'huddle-files' and public.can_access_room(public.safe_uuid(split_part(name, '/', 2))));
create policy huddle_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'huddle-files' and public.can_access_room(public.safe_uuid(split_part(name, '/', 2))));
create policy huddle_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'huddle-files' and (owner = auth.uid()
         or public.is_ws_admin(public.safe_uuid(split_part(name, '/', 1)))));

-- Done ✅  Bizzle Huddle v4.20 schema installed.
