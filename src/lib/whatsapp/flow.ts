/**
 * WhatsApp Flows - Flow Logic (Production-Ready)
 *
 * Fixes applied:
 * - session_token used consistently (no typos)
 * - user_id fallback removed from resolveUserFromSession
 * - TRIP_STARTED screen fully integrated
 * - amount sent as number (not string) to match EXPENSE_DETAILS's
 *   TextInput input-type: "number" and the data schema in flow.json
 * - removed VITE_-prefixed fallback for the service-role key: Vite bundles
 *   VITE_* vars into client-side JS at build time, so a service-role key
 *   under that name would ship to every browser and bypass RLS entirely.
 *   This key must only ever exist as a server-only Secret.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  downloadFlowMedia,
  extractReceiptFromBytes,
  RECEIPT_CATEGORIES,
  type FlowMediaItem,
} from "./media";

const APP_URL = process.env.APP_PUBLIC_URL || "https://slipo.lovable.app";

// ---------- Supabase clients (created once per request) ----------

function createPublicClient() {
  const SUPABASE_URL =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY environment variable(s).",
    );
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createAdminClient() {
  const SUPABASE_URL =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // Server-only. Deliberately no VITE_ fallback here — see file header.
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable(s).",
    );
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// ---------- Helpers: Responses ----------

function successResponse(flow_token: string, params: Record<string, any> = {}) {
  return {
    screen: "SUCCESS",
    data: {
      status: params.status ?? "ok",
      message: params.message ?? "Your request has been submitted.",
      extension_message_response: {
        params: {
          flow_token,
          status: params.status ?? "ok",
          ...params,
        },
      },
    },
  };
}

function errorResponse(flow_token: string, message: string, extraParams: Record<string, any> = {}) {
  return {
    screen: "SUCCESS",
    data: {
      status: "error",
      extension_message_response: {
        params: {
          flow_token,
          status: "error",
          message,
          ...extraParams,
        },
      },
    },
  };
}

// ---------- Session / Flow Session Helpers ----------

/**
 * Create a flow session record and return a session token.
 * This token is passed between screens instead of user_id.
 */
async function createFlowSession(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  const { error } = await adminClient
    .from("flow_sessions")
    .insert({
      session_token: token,
      user_id: userId,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    });

  if (error) {
    console.error({
      msg: "Failed to create flow session",
      user_id: userId,
      error: error.message,
    });
    throw new Error("Failed to create flow session");
  }

  return token;
}

/**
 * Resolve a session token to a user_id.
 * Returns null if not found or expired.
 */
async function resolveFlowSession(
  adminClient: ReturnType<typeof createAdminClient>,
  sessionToken: string,
): Promise<string | null> {
  const { data, error } = await adminClient
    .from("flow_sessions")
    .select("user_id")
    .eq("session_token", sessionToken)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (error || !data) {
    return null;
  }

  return data.user_id;
}

/**
 * Get user_id from session_token only.
 * No fallback to user_id from the client.
 */
async function resolveUserFromSession(
  adminClient: ReturnType<typeof createAdminClient>,
  data: any,
): Promise<string | null> {
  const sessionToken = data?.session_token as string | undefined;
  if (!sessionToken) {
    return null;
  }

  const userId = await resolveFlowSession(adminClient, sessionToken);
  return userId; // null if invalid/expired
}

// ---------- Repository: Trips ----------

async function createTrip(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  tripName: string,
  startOdometer: number | null,
  extra: {
    client?: string;
    destination?: string;
    purpose?: string;
  },
) {
  const descriptionParts = [
    extra.client ? `Client: ${extra.client}` : null,
    extra.destination ? `Destination: ${extra.destination}` : null,
    extra.purpose ? `Purpose: ${extra.purpose}` : null,
  ].filter(Boolean);

  const { data: trip, error } = await adminClient
    .from("trips")
    .insert({
      user_id: userId,
      created_by: userId,
      name: tripName,
      description: descriptionParts.join(" | ") || null,
      start_date: new Date().toISOString().slice(0, 10),
      status: "active",
      track_mileage: startOdometer !== null,
      start_odometer: startOdometer,
    })
    .select("id")
    .single();

  if (error) {
    console.error({
      msg: "Failed to insert trip",
      user_id: userId,
      trip_name: tripName,
      error: error.message,
    });
    throw error;
  }

  return trip;
}

async function endTrip(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  tripId: string,
  endOdometer: number | null,
) {
  const { error } = await adminClient
    .from("trips")
    .update({
      status: "completed",
      end_date: new Date().toISOString().slice(0, 10),
      end_odometer: endOdometer,
    })
    .eq("id", tripId)
    .eq("user_id", userId);

  if (error) {
    console.error({
      msg: "Failed to update trip",
      user_id: userId,
      trip_id: tripId,
      error: error.message,
    });
    throw error;
  }
}

/** Trips the user can still attach receipts to / end, newest first. */
async function listOpenTrips(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const { data, error } = await adminClient
    .from("trips")
    .select("id, name, status")
    .eq("user_id", userId)
    .in("status", ["active", "planned"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error({ msg: "Failed to list trips", user_id: userId, error: error.message });
    return [];
  }

  return (data ?? []).map((t) => ({ id: t.id, title: t.name }));
}

/** Decrypt the uploaded photo, store it, and run AI extraction. */
async function ingestReceiptImage(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  item: FlowMediaItem,
) {
  const bytes = await downloadFlowMedia(item);
  const name = item.file_name ?? "receipt.jpg";
  const ext = (name.split(".").pop() || "jpg").toLowerCase();
  const mime =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await adminClient.storage
    .from("receipts")
    .upload(path, bytes, { contentType: mime, upsert: false });

  if (error) {
    console.error({ msg: "Receipt upload failed", user_id: userId, error: error.message });
    throw new Error("upload_failed");
  }

  const extracted = await extractReceiptFromBytes(bytes, mime);
  return { path, extracted };
}


// ---------- Validation Helpers ----------

function validateTripName(tripName: string): string | null {
  const trimmed = tripName.trim();
  if (!trimmed) return "Trip name is required.";
  if (trimmed.length < 3) return "Trip name must be at least 3 characters.";
  if (trimmed.length > 100) return "Trip name is too long.";
  return null;
}

function validateOdometer(value: unknown, fieldName: string): number | null | "error" {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return "error";
  }
  return num;
}

// ---------- Main Flow Router ----------

export const getNextScreen = async (decryptedBody: any) => {
  const { screen, data, action, flow_token } = decryptedBody;

  // Create clients once per request
  const publicClient = createPublicClient();
  const adminClient = createAdminClient();

  // Health check
  if (action === "ping") {
    return {
      data: {
        status: "active",
      },
    };
  }

  // Client validation errors
  if (data?.error) {
    console.warn({
      msg: "Received client error",
      data: data.error,
    });

    return {
      data: {
        acknowledged: true,
      },
    };
  }

  // Flow opens
  if (action === "INIT") {
    return {
      screen: "SIGN_IN",
      data: {},
    };
  }

  // Back button
  if (action === "BACK") {
    return {
      screen: "SIGN_IN",
      data: {},
    };
  }

  if (action !== "data_exchange") {
    return {
      data: {},
    };
  }

  const email = String(data?.email ?? "").trim().toLowerCase();

  // Route by screen
  switch (screen) {
    case "SIGN_IN": {
      const password = String(data?.password ?? "");

      if (!email || !password) {
        return errorResponse(flow_token, "Email and password are required");
      }

      const { data: auth, error } = await publicClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !auth.session) {
        console.info({
          msg: "Sign-in failed",
          email,
          error: error?.message ?? "No session",
        });
        return errorResponse(flow_token, "Invalid email or password");
      }

      // Create a server-side flow session
      const sessionToken = await createFlowSession(adminClient, auth.user.id);

      console.info({
        msg: "Sign-in successful, flow session created",
        user_id: auth.user.id,
      });

      return {
        screen: "HOME",
        data: {
          session_token: sessionToken,
          user_id: auth.user.id, // kept for backward compatibility if needed
        },
      };
    }

    case "HOME": {
      const userId = await resolveUserFromSession(adminClient, data);
      const homeAction = String(data?.menu_choice ?? "");

      console.info({
        msg: "HOME screen",
        user_id: userId,
        menu_choice: homeAction,
      });

      if (!userId) {
        return errorResponse(flow_token, "Session expired. Please sign in again.");
      }

      // Route lookup for menu choices
      const routeMap: Record<string, string> = {
        start: "START_TRIP",
        receipt: "UPLOAD_RECEIPT",
        end: "END_TRIP",
        report: "GENERATE_REPORT",
      };

      const nextScreen = routeMap[homeAction];

      if (!nextScreen) {
        console.info({
          msg: "Unknown menu choice",
          menu_choice: homeAction,
        });
        return {
          screen: "HOME",
          data: {
            session_token: data?.session_token,
            user_id: userId,
          },
        };
      }

      // The report screen can target live *and* completed trips; the other
      // screens only make sense for open trips.
      const trips =
        nextScreen === "START_TRIP"
          ? null
          : nextScreen === "GENERATE_REPORT"
            ? await listAllTrips(adminClient, userId)
            : await listOpenTrips(adminClient, userId);

      return {
        screen: nextScreen,
        data: {
          session_token: data?.session_token,
          user_id: userId,
          ...(trips ? { trips } : {}),
        },
      };

    }

    case "START_TRIP": {
      const userId = await resolveUserFromSession(adminClient, data);

      if (!userId) {
        return errorResponse(flow_token, "Session expired. Please sign in again.");
      }

      const tripName = String(data?.trip_name ?? "");
      const nameError = validateTripName(tripName);
      if (nameError) {
        return errorResponse(flow_token, nameError);
      }

      const startOdometerRaw = data?.start_odometer;
      const startOdometer = validateOdometer(startOdometerRaw, "start_odometer");
      if (startOdometer === "error") {
        return errorResponse(flow_token, "Start odometer must be a non-negative number.");
      }

      try {
        const trip = await createTrip(adminClient, userId, tripName, startOdometer, {
          client: data?.client,
          destination: data?.destination,
          purpose: data?.purpose,
        });

        console.info({
          msg: "Trip created",
          user_id: userId,
          trip_id: trip.id,
          trip_name: tripName,
        });

        // Navigate to a dedicated TRIP_STARTED screen instead of SUCCESS
        return {
          screen: "TRIP_STARTED",
          data: {
            session_token: data?.session_token,
            user_id: userId,
            trip_id: trip.id,
            trip_name: tripName,
          },
        };
      } catch {
        return errorResponse(flow_token, "Could not start trip. Please try again.");
      }
    }

    case "TRIP_STARTED": {
      // Post-action screen that returns to HOME with trip context
      const userId = await resolveUserFromSession(adminClient, data);

      return {
        screen: "HOME",
        data: {
          session_token: data?.session_token,
          user_id: userId,
          last_trip_id: data?.trip_id,
          last_trip_name: data?.trip_name,
        },
      };
    }

    case "UPLOAD_RECEIPT": {
      const userId = await resolveUserFromSession(adminClient, data);

      if (!userId) {
        return errorResponse(flow_token, "Session expired. Please sign in again.");
      }

      const media = (data?.receipt_image ?? data?.receipt ?? []) as FlowMediaItem[];
      const item = Array.isArray(media) ? media[0] : undefined;

      if (!item?.cdn_url) {
        return errorResponse(flow_token, "Please attach a photo of the receipt.");
      }

      const trips = await listOpenTrips(adminClient, userId);

      try {
        const { path, extracted } = await ingestReceiptImage(adminClient, userId, item);

        console.info({
          msg: "Receipt uploaded and extracted",
          user_id: userId,
          image_path: path,
        });

        return {
          screen: "EXPENSE_DETAILS",
          data: {
            session_token: data?.session_token,
            user_id: userId,
            image_path: path,
            trips,
            categories: RECEIPT_CATEGORIES.map((c) => ({
              id: c,
              title: c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
            })),
            merchant: extracted.vendor ?? "",
            date: extracted.occurred_on ?? new Date().toISOString().slice(0, 10),
            // Sent as a number (not String()) to match EXPENSE_DETAILS's
            // "amount" TextInput (input-type: "number") and the data
            // schema in flow.json, which declares amount: type "number".
            amount: extracted.amount !== null ? extracted.amount : null,
            currency: extracted.currency,
            category: extracted.category,
          },
        };
      } catch (err) {
        console.error({ msg: "Receipt ingest failed", user_id: userId, error: String(err) });
        return errorResponse(flow_token, "Could not read that receipt. Please try again.");
      }
    }

    case "EXPENSE_DETAILS": {
      const userId = await resolveUserFromSession(adminClient, data);

      if (!userId) {
        return errorResponse(flow_token, "Session expired. Please sign in again.");
      }

      const imagePath = String(data?.image_path ?? "");
      const tripId = String(data?.trip_id ?? data?.trip_project ?? "");

      if (!imagePath) {
        return errorResponse(flow_token, "Receipt image is missing. Please upload it again.");
      }
      if (!tripId) {
        return errorResponse(flow_token, "Select the trip this receipt belongs to.");
      }

      const amount = Number(String(data?.amount ?? "").replace(/[^0-9.\-]/g, ""));
      if (!Number.isFinite(amount) || amount < 0) {
        return errorResponse(flow_token, "Amount must be a non-negative number.");
      }

      const rawCategory = String(data?.category ?? "other");
      const category = (RECEIPT_CATEGORIES as readonly string[]).includes(rawCategory)
        ? rawCategory
        : "other";

      const rawDate = String(data?.date ?? "");
      const occurredOn = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : new Date().toISOString().slice(0, 10);

      const { error } = await adminClient.from("receipts").insert({
        trip_id: tripId,
        user_id: userId,
        category: category as Database["public"]["Enums"]["expense_category"],
        amount,
        currency: String(data?.currency ?? "USD").slice(0, 8) || "USD",
        vendor: data?.merchant ? String(data.merchant) : null,
        occurred_on: occurredOn,
        notes: data?.description ? String(data.description) : null,
        image_path: imagePath,
      });

      if (error) {
        console.error({
          msg: "Failed to insert receipt",
          user_id: userId,
          trip_id: tripId,
          error: error.message,
        });
        return errorResponse(flow_token, "Could not save the receipt. Please try again.");
      }

      console.info({ msg: "Receipt saved", user_id: userId, trip_id: tripId });

      return successResponse(flow_token, {
        status: "expense_submitted",
        message: `Receipt saved${data?.merchant ? ` for ${data.merchant}` : ""} — ${amount.toFixed(2)} added to your trip.`,
        trip_id: tripId,
        amount,
      });
    }


    case "END_TRIP": {
      const userId = await resolveUserFromSession(adminClient, data);

      if (!userId) {
        return errorResponse(flow_token, "Session expired. Please sign in again.");
      }

      // Use trip_id (trip_project kept for backward compatibility)
      const tripId = String(data?.trip_id ?? data?.trip_project ?? "");

      const endOdometerRaw = data?.end_odometer;
      const endOdometer = validateOdometer(endOdometerRaw, "end_odometer");
      if (endOdometer === "error") {
        return errorResponse(flow_token, "End odometer must be a non-negative number.");
      }

      if (!tripId) {
        return errorResponse(flow_token, "Select a trip to end.");
      }

      try {
        await endTrip(adminClient, userId, tripId, endOdometer);

        console.info({
          msg: "Trip ended",
          user_id: userId,
          trip_id: tripId,
        });

        return successResponse(flow_token, {
          status: "trip_ended",
          trip_id: tripId,
          end_odometer: endOdometer,
          notes: data?.notes,
        });
      } catch {
        return errorResponse(flow_token, "Could not end trip. Please try again.");
      }
    }

    case "GENERATE_REPORT": {
      const userId = await resolveUserFromSession(adminClient, data);

      if (!userId) {
        return errorResponse(flow_token, "Session expired. Please sign in again.");
      }

      const tripId = String(data?.trip_id ?? data?.trip_project ?? "");
      if (!tripId) {
        return errorResponse(flow_token, "Select a trip to report on.");
      }

      const rawType = String(data?.report_type ?? "pdf").toLowerCase();
      const format: "csv" | "pdf" = rawType.includes("csv") ? "csv" : "pdf";

      const rawDelivery = String(data?.delivery ?? "whatsapp").toLowerCase();
      const wantsEmail = rawDelivery.includes("email");

      let report;
      try {
        report = await generateTripReport(adminClient, userId, tripId, format);
      } catch (err) {
        console.error({ msg: "Report generation failed", user_id: userId, trip_id: tripId, error: String(err) });
        return errorResponse(flow_token, "Could not generate that report. Please try again.");
      }

      const summary = `${report.receiptCount} receipts · Total ${report.currency} ${report.total.toFixed(2)}`;

      if (wantsEmail) {
        const toEmail =
          String(data?.email ?? "").trim() ||
          (
            await adminClient.from("profiles").select("email").eq("id", userId).single()
          ).data?.email ||
          "";

        const sent = await emailReport(toEmail, report);
        if (sent) {
          return successResponse(flow_token, {
            status: "report_generated",
            trip_id: tripId,
            report_type: format,
            report_url: report.url,
            message: `${format.toUpperCase()} report for "${report.tripName}" emailed to ${toEmail}. ${summary}`,
          });
        }
        return successResponse(flow_token, {
          status: "report_generated",
          trip_id: tripId,
          report_type: format,
          report_url: report.url,
          message: `Email delivery isn't set up yet, so here's your ${format.toUpperCase()} report for "${report.tripName}": ${report.url} (link valid 7 days). ${summary}`,
        });
      }

      return successResponse(flow_token, {
        status: "report_generated",
        trip_id: tripId,
        report_type: format,
        report_url: report.url,
        message: `Your ${format.toUpperCase()} report for "${report.tripName}" is ready: ${report.url} (link valid 7 days). ${summary}`,
      });
    }


    case "SIGN_UP": {
      const password = String(data?.password ?? "");
      const confirmPassword = String(data?.confirm_password ?? "");

      const fullName = [data?.first_name, data?.last_name]
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
        .join(" ");

      if (!email || !password) {
        return errorResponse(flow_token, "Email and password required");
      }

      if (password !== confirmPassword) {
        return errorResponse(flow_token, "Passwords do not match");
      }

      const { data: created, error } = await publicClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            source: "whatsapp_flow",
          },
          emailRedirectTo: `${APP_URL}/auth`,
        },
      });

      if (error) {
        console.info({
          msg: "Sign-up failed",
          email,
          error: error.message,
        });
        return errorResponse(flow_token, error.message);
      }

      console.info({
        msg: "Sign-up successful",
        email,
        user_id: created.user?.id,
      });

      return successResponse(flow_token, {
        status: "signed_up",
        user_id: created.user?.id,
      });
    }

    case "FORGOT_PASSWORD": {
      if (!email) {
        return errorResponse(flow_token, "Email required");
      }

      const { error } = await publicClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${APP_URL}/auth`,
      });

      if (error) {
        console.error({
          msg: "resetPasswordForEmail error",
          email,
          error: error.message,
        });
      }

      // Always return success-like response to avoid revealing account existence
      return successResponse(flow_token, {
        status: "reset_sent",
      });
    }

    default:
      console.error({
        msg: "Unhandled Flow request",
        screen,
        action,
        decryptedBody,
      });
      throw new Error("Unhandled Flow request");
  }
};
