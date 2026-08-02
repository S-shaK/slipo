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

  // Flow opened
  if (action === "INIT") {
    return {
      screen: "HOME",
      data: {},
    };
  }


  if (action === "data_exchange") {

    switch (screen) {

      // HOME MENU
      case "HOME":

        switch(data?.action) {

          case "start":
            return {
              screen: "START_TRIP",
              data: {},
            };


          case "receipt":
            return {
              screen: "UPLOAD_RECEIPT",
              data: {},
            };


          case "end":
            return {
              screen: "END_TRIP",
              data: {},
            };


          case "report":
            return {
              screen: "GENERATE_REPORT",
              data: {},
            };
        }

        break;


      // START TRIP SUBMISSION
      case "START_TRIP":

        if(data?.action === "start_trip") {

          /*
          Here we will:
          1. Get WhatsApp phone
          2. Find profiles.id
          3. Insert trip
          */

          return {
            screen: "SUCCESS",
            data: {
              extension_message_response: {
                params: {
                  flow_token,
                },
              },
            },
          };
        }

        break;



      // RECEIPT UPLOAD
      case "UPLOAD_RECEIPT":

        if(data?.action === "receipt_upload") {

          return {
            screen:"EXPENSE_DETAILS",
            data:{}
          };

        }

        break;



      // EXPENSE SAVE
      case "EXPENSE_DETAILS":

        if(data?.action === "create_expense") {

          return {
            screen:"SUCCESS",
            data:{
              extension_message_response:{
                params:{
                  flow_token
                }
              }
            }
          };

        }

        break;



      // END TRIP
      case "END_TRIP":

        if(data?.action === "end_trip") {

          return {
            screen:"SUCCESS",
            data:{
              extension_message_response:{
                params:{
                  flow_token
                }
              }
            }
          };

        }

        break;



      // REPORT
      case "GENERATE_REPORT":

        if(data?.action === "generate_report") {

          return {
            screen:"SUCCESS",
            data:{
              extension_message_response:{
                params:{
                  flow_token
                }
              }
            }
          };

        }

        break;
    }
  }


  console.error(
    "Unhandled Flow request:",
    decryptedBody
  );

  throw new Error("Unhandled Flow request");
};
