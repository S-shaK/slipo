/**
 * WhatsApp Flows - Flow Logic
 */

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

  // Client-side validation errors
  if (data?.error) {
    console.warn("Received client error:", data);

    return {
      data: {
        acknowledged: true,
      },
    };
  }

  // Initial request when the Flow opens
  if (action === "INIT") {
    return {
      screen: "HOME",
      data: {},
    };
  }

  // Requests from the Flow
  if (action === "data_exchange") {
    switch (screen) {
      case "HOME":
        switch (data?.action) {
          case "trip":
            return {
              screen: "TRIP_MENU",
              data: {},
            };

          case "receipt":
            return {
              screen: "UPLOAD_RECEIPT",
              data: {},
            };

          case "report":
            return {
              screen: "GENERATE_REPORT",
              data: {},
            };

          default:
            break;
        }
        break;

      case "TRIP_MENU":
        switch (data?.trip_action) {
          case "start":
            return {
              screen: "START_TRIP",
              data: {},
            };

          case "edit":
            return {
              screen: "EDIT_TRIP",
              data: {},
            };

          case "end":
            return {
              screen: "END_TRIP",
              data: {},
            };

          default:
            break;
        }
        break;

      case "START_TRIP":
      case "EDIT_TRIP":
      case "END_TRIP":
      case "UPLOAD_RECEIPT":
      case "GENERATE_REPORT":
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
  }

  console.error("Unhandled request:", decryptedBody);

  throw new Error("Unhandled Flow request.");
};
