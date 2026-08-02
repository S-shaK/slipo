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


    return {
      screen: "SUCCESS",
      data: {
        extension_message_response: {
          params: {
            flow_token,
            status: "signed_in",
            user_id: auth.user.id
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
