import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const NewTripInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  track_mileage: z.boolean().default(false),
  start_odometer: z.number().nonnegative().optional().nullable(),
  start_odometer_path: z.string().optional().nullable(),
  user_id: z.string().uuid().optional(),
});

export const createTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => NewTripInput.parse(input))
  .handler(async ({ data, context }) => {
    const ownerId = data.user_id ?? context.userId;
    const { data: trip, error } = await context.supabase
      .from("trips")
      .insert({
        user_id: ownerId,
        created_by: context.userId,
        name: data.name,
        description: data.description ?? null,
        start_date: data.start_date ?? null,
        end_date: data.end_date ?? null,
        track_mileage: data.track_mileage,
        start_odometer: data.start_odometer ?? null,
        start_odometer_path: data.start_odometer_path ?? null,
        status: "active",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return trip;
  });

export const listMyTrips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trips")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const getTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: trip, error } = await context.supabase
      .from("trips").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    return trip;
  });

const EndTripInput = z.object({
  id: z.string().uuid(),
  end_odometer: z.number().nonnegative().optional().nullable(),
  end_odometer_path: z.string().optional().nullable(),
});

export const endTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EndTripInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: trip, error } = await context.supabase
      .from("trips")
      .update({
        status: "completed",
        end_date: new Date().toISOString().slice(0, 10),
        end_odometer: data.end_odometer ?? null,
        end_odometer_path: data.end_odometer_path ?? null,
      })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return trip;
  });

export const deleteTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("trips").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
