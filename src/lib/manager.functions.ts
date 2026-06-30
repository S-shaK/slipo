import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getMyProfileAndRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: profile }, { data: roles }] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
    ]);
    return {
      profile,
      roles: (roles ?? []).map((r) => r.role as string),
    };
  });

export const listMyReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: reports, error } = await context.supabase
      .from("profiles").select("id, full_name, email")
      .eq("manager_id", context.userId)
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);
    if (!reports || reports.length === 0) return [];

    const ids = reports.map((r) => r.id);
    const [{ data: trips }, { data: receipts }] = await Promise.all([
      context.supabase.from("trips").select("id, user_id, name, status, start_date, end_date").in("user_id", ids),
      context.supabase.from("receipts").select("user_id, amount, trip_id").in("user_id", ids),
    ]);

    return reports.map((r) => {
      const userTrips = (trips ?? []).filter((t) => t.user_id === r.id);
      const userReceipts = (receipts ?? []).filter((x) => x.user_id === r.id);
      const activeTrips = userTrips.filter((t) => t.status === "active");
      const liveSpend = userReceipts
        .filter((x) => activeTrips.some((t) => t.id === x.trip_id))
        .reduce((sum, x) => sum + Number(x.amount), 0);
      const totalSpend = userReceipts.reduce((sum, x) => sum + Number(x.amount), 0);
      return {
        ...r,
        trips: userTrips,
        active_trip_count: activeTrips.length,
        total_trip_count: userTrips.length,
        live_spend: liveSpend,
        total_spend: totalSpend,
      };
    });
  });

export const addReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ email: z.string().email() }).parse(i))
  .handler(async ({ data, context }) => {
    const email = data.email.trim().toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // If they already have an account, link immediately
    const { data: target } = await context.supabase
      .from("profiles").select("id").ilike("email", email).maybeSingle();

    if (target) {
      const { error: upErr } = await context.supabase
        .from("profiles").update({ manager_id: context.userId }).eq("id", target.id);
      if (upErr) throw new Error(upErr.message);
      await supabaseAdmin.from("user_roles")
        .upsert({ user_id: target.id, role: "employee" }, { onConflict: "user_id,role" });
      return { status: "linked" as const, email };
    }

    // Otherwise create a pending invite (auto-links when they sign up with this email)
    const { data: invite, error } = await context.supabase
      .from("team_invites")
      .upsert(
        { manager_id: context.userId, email, status: "pending" },
        { onConflict: "manager_id,email" },
      )
      .select("token")
      .single();
    if (error) throw new Error(error.message);
    return { status: "invited" as const, email, token: invite.token };
  });

export const listPendingInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("team_invites")
      .select("id, email, token, created_at, status")
      .eq("manager_id", context.userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("team_invites")
      .update({ status: "revoked" })
      .eq("id", data.id)
      .eq("manager_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const lookupInvite = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(1) }).parse(i))
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: invite } = await sb
      .from("team_invites")
      .select("email, manager_id, status")
      .eq("token", data.token)
      .maybeSingle();
    if (!invite || invite.status !== "pending") return null;
    const { data: mgr } = await sb
      .from("profiles").select("full_name, email").eq("id", invite.manager_id).maybeSingle();
    return {
      email: invite.email,
      manager_name: mgr?.full_name ?? mgr?.email ?? "your manager",
    };
  });

export const becomeManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_roles")
      .upsert({ user_id: context.userId, role: "manager" }, { onConflict: "user_id,role" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getReportTrips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ user_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: trips, error } = await context.supabase
      .from("trips").select("*").eq("user_id", data.user_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return trips ?? [];
  });
