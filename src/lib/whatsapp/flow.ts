/**
 * WhatsApp Flows - Flow Logic
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

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
      await supabaseAdmin.auth.signInWithPassword({
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



    const { data: created, error } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm:true,
        user_metadata:{
          full_name:fullName,
          source:"whatsapp_flow"
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
            user_id:created.user.id
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



    await supabaseAdmin.auth.admin.generateLink({
      type:"recovery",
      email,
    });



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
