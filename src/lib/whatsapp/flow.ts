/**
 * WhatsApp Flows - Flow Logic
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const APP_URL = process.env.APP_PUBLIC_URL || "https://slipo.lovable.app";

// The generated `@/integrations/supabase/client` export is a browser-oriented
// singleton (persistSession + localStorage). Reusing that same instance here
// would mean every request on this server shares one auth/session state,
// which is unsafe with concurrent users. Instead we create a fresh,
// session-less client per invocation, scoped to this request only.
function getSupabaseClient() {
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

export const getNextScreen = async (decryptedBody: any) => {
  const { screen, data, action, flow_token } = decryptedBody;

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
    console.warn("Received client error:", data);

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


  const email = String(data?.email ?? "")
    .trim()
    .toLowerCase();



  // --------------------------------------------------
  // SIGN IN
  // --------------------------------------------------

  if (screen === "SIGN_IN") {

    const password = String(data?.password ?? "");

    if (!email || !password) {
      return {
        screen: "SUCCESS",
        data: {
          extension_message_response: {
            params: {
              flow_token,
              status: "error",
              message: "Email and password are required"
            }
          }
        }
      };
    }


    const { data: auth, error } =
      await getSupabaseClient().auth.signInWithPassword({
        email,
        password,
      });


    if (error || !auth.session) {

      return {
        screen: "SUCCESS",
        data: {
          extension_message_response: {
            params: {
              flow_token,
              status: "error",
              message: "Invalid email or password"
            }
          }
        }
      };
    }


    // Successful sign-in no longer ends the flow — it continues to the
    // Live Trips home screen instead of completing via extension_message_response.
    // Successful sign-in no longer ends the flow — it continues to the
    // Live Trips home screen. user_id has to be carried forward explicitly
    // in `data` from here on, since each Flow request is stateless (no
    // session/cookie between screens).
    return {
      screen: "HOME",
      data: {
        user_id: auth.user.id,
      }
    };

  }



  // --------------------------------------------------
  // HOME (Live Trips menu)
  // --------------------------------------------------

if (screen === "HOME") {
  const userId = String(data?.user_id ?? "");
  const homeAction = String(data?.menu_choice ?? "");

  console.log("HOME:", { userId, homeAction });

  switch (homeAction) {
    case "start":
      return {
        screen: "START_TRIP",
        data: {
          user_id: userId,
        },
      };

    case "receipt":
      return {
        screen: "UPLOAD_RECEIPT",
        data: {
          user_id: userId,
        },
      };

    case "end":
      return {
        screen: "END_TRIP",
        data: {
          user_id: userId,
        },
      };

    case "report":
      return {
        screen: "GENERATE_REPORT",
        data: {
          user_id: userId,
        },
      };

    default:
      console.log("Unknown menu choice:", homeAction);

      return {
        screen: "HOME",
        data: {
          user_id: userId,
        },
      };
  }
}

  // --------------------------------------------------
  // START TRIP
  // --------------------------------------------------

  if (screen === "START_TRIP") {

    const userId = String(data?.user_id ?? "");
    const tripName = String(data?.trip_name ?? "").trim();
    const startOdometer = data?.start_odometer
      ? Number(data.start_odometer)
      : null;

    if (!userId || !tripName) {
      return {
        screen: "SUCCESS",
        data: {
          status: "error",
          message: "Trip name is required.",
          extension_message_response: {
            params: { flow_token, status: "error", message: "Trip name is required" }
          }
        }
      };
    }

    // client/destination/purpose have no dedicated columns on `trips`,
    // so they're folded into `description` for now.
    const descriptionParts = [
      data?.client ? `Client: ${data.client}` : null,
      data?.destination ? `Destination: ${data.destination}` : null,
      data?.purpose ? `Purpose: ${data.purpose}` : null,
    ].filter(Boolean);

    const { data: trip, error } = await getSupabaseClient()
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
      console.error("Failed to insert trip:", error);
      return {
        screen: "SUCCESS",
        data: {
          status: "error",
          message: "Could not start trip. Please try again.",
          extension_message_response: {
            params: { flow_token, status: "error", message: error.message }
          }
        }
      };
    }

    return {
      screen: "SUCCESS",
      data: {
        status: "trip_started",
        message: `Trip "${tripName}" started.`,
        extension_message_response: {
          params: {
            flow_token,
            status: "trip_started",
            trip_id: trip?.id,
            trip_name: tripName,
          }
        }
      }
    };

  }



  // --------------------------------------------------
  // UPLOAD RECEIPT
  // --------------------------------------------------

  if (screen === "UPLOAD_RECEIPT") {

    return {
      screen: "EXPENSE_DETAILS",
      data: { user_id: data?.user_id ?? "" },
    };

  }



  // --------------------------------------------------
  // EXPENSE DETAILS
  // --------------------------------------------------
  // TODO: no `expenses` table confirmed yet — still a stub that echoes the
  // submission back on the SUCCESS screen without persisting it.

  if (screen === "EXPENSE_DETAILS") {

    return {
      screen: "SUCCESS",
      data: {
        status: "expense_submitted",
        message: "Expense submitted.",
        extension_message_response: {
          params: {
            flow_token,
            status: "expense_submitted",
            merchant: data?.merchant,
            date: data?.date,
            amount: data?.amount,
            vat: data?.vat,
            trip_project: data?.trip_project,
            description: data?.description,
          }
        }
      }
    };

  }



  // --------------------------------------------------
  // END TRIP
  // --------------------------------------------------

  if (screen === "END_TRIP") {

    const userId = String(data?.user_id ?? "");
    const tripId = String(data?.trip_project ?? "");
    const endOdometer = data?.end_odometer ? Number(data.end_odometer) : null;

    if (!userId || !tripId) {
      return {
        screen: "SUCCESS",
        data: {
          status: "error",
          message: "Select a trip to end.",
          extension_message_response: {
            params: { flow_token, status: "error", message: "Trip is required" }
          }
        }
      };
    }

    // NOTE: `notes` has no column on `trips` yet, so it isn't persisted —
    // only echoed back to the webhook response below.
    const { error } = await getSupabaseClient()
      .from("trips")
      .update({
        status: "completed",
        end_date: new Date().toISOString().slice(0, 10),
        end_odometer: endOdometer,
      })
      .eq("id", tripId)
      .eq("user_id", userId);

    if (error) {
      console.error("Failed to update trip:", error);
      return {
        screen: "SUCCESS",
        data: {
          status: "error",
          message: "Could not end trip. Please try again.",
          extension_message_response: {
            params: { flow_token, status: "error", message: error.message }
          }
        }
      };
    }

    return {
      screen: "SUCCESS",
      data: {
        status: "trip_ended",
        message: "Trip ended.",
        extension_message_response: {
          params: {
            flow_token,
            status: "trip_ended",
            trip_id: tripId,
            end_odometer: endOdometer,
            notes: data?.notes,
          }
        }
      }
    };

  }



  // --------------------------------------------------
  // GENERATE REPORT
  // --------------------------------------------------
  // TODO: generate/send the actual report. Currently a stub.

  if (screen === "GENERATE_REPORT") {

    return {
      screen: "SUCCESS",
      data: {
        status: "report_generated",
        message: "Report generated.",
        extension_message_response: {
          params: {
            flow_token,
            status: "report_generated",
            trip_project: data?.trip_project,
            report_type: data?.report_type,
          }
        }
      }
    };

  }



  // --------------------------------------------------
  // SIGN UP
  // --------------------------------------------------

  if (screen === "SIGN_UP") {

    const password = String(data?.password ?? "");
    const confirmPassword =
      String(data?.confirm_password ?? "");


    const fullName =
      [
        data?.first_name,
        data?.last_name
      ]
      .map((v)=>String(v ?? "").trim())
      .filter(Boolean)
      .join(" ");



    if (!email || !password) {

      return {
        screen:"SUCCESS",
        data:{
          extension_message_response:{
            params:{
              flow_token,
              status:"error",
              message:"Email and password required"
            }
          }
        }
      };

    }


    if(password !== confirmPassword){

      return {
        screen:"SUCCESS",
        data:{
          extension_message_response:{
            params:{
              flow_token,
              status:"error",
              message:"Passwords do not match"
            }
          }
        }
      };

    }


    // No admin client available here, so we use the public sign-up flow.
    // Supabase will send its own confirmation email (if email confirmations
    // are enabled on the project) rather than us marking the user
    // pre-confirmed the way admin.createUser({ email_confirm: true }) did.
    const { data: created, error } =
      await getSupabaseClient().auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            source: "whatsapp_flow"
          },
          emailRedirectTo: `${APP_URL}/auth`
        }
      });



    if(error){

      return {
        screen:"SUCCESS",
        data:{
          extension_message_response:{
            params:{
              flow_token,
              status:"error",
              message:error.message
            }
          }
        }
      };

    }



    return {
      screen:"SUCCESS",
      data:{
        extension_message_response:{
          params:{
            flow_token,
            status:"signed_up",
            user_id:created.user?.id
          }
        }
      }
    };

  }



  // --------------------------------------------------
  // FORGOT PASSWORD
  // --------------------------------------------------

  if(screen === "FORGOT_PASSWORD") {


    if(!email){

      return {
        screen:"SUCCESS",
        data:{
          extension_message_response:{
            params:{
              flow_token,
              status:"error",
              message:"Email required"
            }
          }
        }
      };

    }


    // Public reset-password call replaces admin.generateLink({ type: "recovery" }).
    // Errors are intentionally swallowed below so we never reveal whether an
    // account exists for a given email.
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${APP_URL}/auth`,
    });

    if (error) {
      console.error("resetPasswordForEmail error:", error);
    }



    return {
      screen:"SUCCESS",
      data:{
        extension_message_response:{
          params:{
            flow_token,
            status:"reset_sent"
          }
        }
      }
    };

  }



  console.error(
    "Unhandled Flow request:",
    decryptedBody
  );


  throw new Error(
    "Unhandled Flow request"
  );
};
