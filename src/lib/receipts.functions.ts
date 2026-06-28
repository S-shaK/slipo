import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CATEGORIES = [
  "meals", "lodging", "transportation", "fuel",
  "entertainment", "office_supplies", "client_entertainment", "other",
] as const;

const NewReceiptInput = z.object({
  trip_id: z.string().uuid(),
  amount: z.number().nonnegative(),
  currency: z.string().min(1).max(8).default("USD"),
  category: z.enum(CATEGORIES),
  vendor: z.string().max(120).optional().nullable(),
  occurred_on: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  image_path: z.string().min(1),
});

export const createReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => NewReceiptInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: trip, error: tripErr } = await context.supabase
      .from("trips").select("user_id").eq("id", data.trip_id).single();
    if (tripErr || !trip) throw new Error("Trip not found");

    const { data: receipt, error } = await context.supabase
      .from("receipts")
      .insert({
        trip_id: data.trip_id,
        user_id: trip.user_id,
        amount: data.amount,
        currency: data.currency,
        category: data.category,
        vendor: data.vendor ?? null,
        occurred_on: data.occurred_on ?? new Date().toISOString().slice(0, 10),
        notes: data.notes ?? null,
        image_path: data.image_path,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return receipt;
  });

export const listReceiptsByTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ trip_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("receipts").select("*").eq("trip_id", data.trip_id)
      .order("occurred_on", { ascending: false });
    if (error) throw new Error(error.message);
    return rows;
  });

export const deleteReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("receipts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getSignedReceiptUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ paths: z.array(z.string()).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    if (data.paths.length === 0) return {} as Record<string, string>;
    const { data: signed, error } = await context.supabase.storage
      .from("receipts").createSignedUrls(data.paths, 60 * 60);
    if (error) throw new Error(error.message);
    const map: Record<string, string> = {};
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) map[s.path] = s.signedUrl;
    }
    return map;
  });
