// ════════════════════════════════════════════════════════════════════════════
// HANAMI READS — Edge Function: notify-updates
// Pega este código en: Supabase Dashboard → Edge Functions → Create a new function
// Nombre de la función: notify-updates
// ════════════════════════════════════════════════════════════════════════════
//
// Antes de desplegar, configura estos SECRETS en:
// Edge Functions → notify-updates → Settings → Secrets (o Manage secrets)
//
//   VAPID_PUBLIC_KEY    = BLGwCtdINQSQhXTIhLSTzzbnUrI-TQH6bzOeWcaPDw8xGQIA3T5XQRKWiP8ctxq7XR6bckqPflNeGmP0hGI4cIY
//   VAPID_PRIVATE_KEY   = Hh-BEICtS_qgJkPD9E42_NZwsUFbgWKG7zhwJ9afLmc
//   VAPID_EMAIL         = mailto:saturno.h23@gmail.com
//
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen automáticamente
// como secretos del proyecto, no hace falta configurarlos a mano.
// ════════════════════════════════════════════════════════════════════════════

// @ts-ignore
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_EMAIL = Deno.env.get("VAPID_EMAIL") || "mailto:example@example.com";

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

const WEEK_DAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

function updatesToday(sched: any, localDate: Date): boolean {
  if (!sched.update_days || !sched.update_days.length) return false;
  if (sched.status !== "reading") return false;
  if (sched.emission !== "ongoing") return false;
  const weekday = localDate.getDay(); // 0 = Domingo
  const todayWeekday = WEEK_DAYS[weekday === 0 ? 6 : weekday - 1];
  const todayDate = localDate.getDate();
  if (sched.freq === "week") {
    return sched.update_days.includes(todayWeekday);
  }
  return sched.update_days.map(Number).includes(todayDate);
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
  if (error) {
    return new Response(JSON.stringify({ error }), { status: 500 });
  }

  const nowUtc = new Date();
  let sent = 0;
  let checked = 0;

  for (const sub of subs || []) {
    checked++;

    // Hora local del usuario = UTC - su offset (getTimezoneOffset usa convención invertida)
    const localMs = nowUtc.getTime() - (sub.tz_offset_minutes || 0) * 60000;
    const localDate = new Date(localMs);
    const localDateStr = localDate.toISOString().slice(0, 10);
    const localHHMM = localDate.toISOString().slice(11, 16);

    // Ya se le notificó hoy (en su hora local) → saltar
    if (sub.last_notified_date === localDateStr) continue;

    // ¿Estamos dentro de la ventana de su hora preferida? (±7 min, cron cada 15min)
    const [prefH, prefM] = (sub.notif_time || "09:00").split(":").map(Number);
    const prefTotalMin = prefH * 60 + prefM;
    const [curH, curM] = localHHMM.split(":").map(Number);
    const curTotalMin = curH * 60 + curM;
    if (Math.abs(curTotalMin - prefTotalMin) > 7) continue;

    // Buscar sus manga con capítulo nuevo hoy
    const { data: scheds } = await supabase
      .from("manga_notify_schedules")
      .select("*")
      .eq("device_id", sub.device_id);

    const updates = (scheds || []).filter((s: any) => updatesToday(s, localDate));

    if (!updates.length) {
      // Marcar como revisado hoy aunque no haya nada que avisar
      await supabase
        .from("push_subscriptions")
        .update({ last_notified_date: localDateStr })
        .eq("device_id", sub.device_id);
      continue;
    }

    const titles = updates.slice(0, 3).map((u: any) => u.title).join(", ");
    const extra = updates.length > 3 ? ` y ${updates.length - 3} más` : "";

    try {
      await webpush.sendNotification(
        sub.subscription,
        JSON.stringify({
          title: `🌸 ${updates.length} manga${updates.length !== 1 ? "s" : ""} actualizan hoy`,
          body: titles + extra,
          icon: "icon-192.png",
          badge: "icon-192.png",
          url: "/",
        })
      );
      sent++;
    } catch (err: any) {
      console.error("Push error for", sub.device_id, err);
      // Suscripción expirada o inválida → eliminarla para no reintentar
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await supabase.from("push_subscriptions").delete().eq("device_id", sub.device_id);
        continue;
      }
    }

    await supabase
      .from("push_subscriptions")
      .update({ last_notified_date: localDateStr })
      .eq("device_id", sub.device_id);
  }

  return new Response(JSON.stringify({ checked, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
