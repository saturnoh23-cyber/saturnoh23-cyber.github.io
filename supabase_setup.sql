-- ════════════════════════════════════════════════════════════════════════════
-- HANAMI READS — Esquema de notificaciones push
-- Pega TODO este archivo en: Supabase Dashboard → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Tabla: una fila por dispositivo suscrito a push ───────────────────────────
create table if not exists push_subscriptions (
  device_id text primary key,
  subscription jsonb not null,
  notif_time text default '09:00',        -- "HH:MM" hora local preferida
  tz_offset_minutes int default 0,         -- new Date().getTimezoneOffset() del navegador
  last_notified_date text,                 -- "YYYY-MM-DD" (hora local), evita duplicados
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Tabla: solo los datos mínimos necesarios para calcular notificaciones ────
-- (NO es un respaldo completo de tu lista, solo lo que activa un aviso)
create table if not exists manga_notify_schedules (
  device_id text not null references push_subscriptions(device_id) on delete cascade,
  manga_id text not null,
  title text not null,
  update_days jsonb default '[]',     -- ['Lu','Ma',...] o [5,12,...] según freq
  freq text default 'week',           -- 'week' | 'month'
  emission text default '',           -- 'ongoing' | 'hiatus' | ...
  status text default 'unread',       -- solo se notifica si status = 'reading'
  chap_cur int default 0,
  updated_at timestamptz default now(),
  primary key (device_id, manga_id)
);

create index if not exists idx_schedules_device on manga_notify_schedules(device_id);

-- ── Seguridad: sin login, cada dispositivo gestiona su propia fila ────────────
-- (El device_id es un UUID aleatorio generado en el navegador, difícil de adivinar)
alter table push_subscriptions enable row level security;
alter table manga_notify_schedules enable row level security;

drop policy if exists "anon full access subscriptions" on push_subscriptions;
create policy "anon full access subscriptions" on push_subscriptions
  for all using (true) with check (true);

drop policy if exists "anon full access schedules" on manga_notify_schedules;
create policy "anon full access schedules" on manga_notify_schedules
  for all using (true) with check (true);

-- ════════════════════════════════════════════════════════════════════════════
-- PASO 2 (después de crear la Edge Function "notify-updates"):
-- Configura el Cron Job para que la revise automáticamente cada 15 minutos.
-- Reemplaza TU_SERVICE_ROLE_KEY con la clave "service_role" de
-- Settings → API → Project API keys (NO la publishable/anon, esa es secreta).
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'notify-manga-updates-job',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://cggmkitgegrnaaohlpux.supabase.co/functions/v1/notify-updates',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer TU_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Para revisar que el cron quedó creado:
-- select * from cron.job;

-- Para eliminarlo si algo sale mal:
-- select cron.unschedule('notify-manga-updates-job');
