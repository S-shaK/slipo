/**
 * Sends a WhatsApp Flow message to a recipient, triggering the Flow's
 * entry screen (SIGN_IN). Use mode: "draft" while testing an unpublished
 * flow — the recipient MUST be added as a tester in WhatsApp Manager ->
 * your app -> Flows -> this flow -> Preview -> testers, or the send will
 * fail / silently not deliver the Flow button.
 *
 * Required secrets:
 * - WHATSAPP_ACCESS_TOKEN   permanent system-user token
 * - WHATSAPP_PHONE_NUMBER_ID the ID shown under API Setup, NOT the phone number itself
 * - WHATSAPP_FLOW_ID         from WhatsApp Manager -> Flows -> your flow
 */

const GRAPH_API_VERSION = "v20.0";

type SendFlowMessageArgs = {
  /** E.164 recipient number, no leading "+", e.g. "27821234567" */
  to: string;
  /** "draft" while testing an unpublished flow, "published" once live */
  mode?: "draft" | "published";
  bodyText?: string;
  ctaLabel?: string;
};

export async function sendFlowMessage({
  to,
  mode = "draft",
  bodyText = "Sign in to Slipo to manage your trips.",
  ctaLabel = "Open Slipo",
}: SendFlowMessageArgs) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const flowId = process.env.WHATSAPP_FLOW_ID;

  if (!accessToken || !phoneNumberId || !flowId) {
    throw new Error(
      "Missing WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, or WHATSAPP_FLOW_ID.",
    );
  }

  // Generated here, not issued by Meta. This is the value your flow.ts
  // endpoint will receive back as `flow_token` on the first INIT request
  // for this session, so you can correlate the send with the session.
  const flowToken = crypto.randomUUID();

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      body: {
        text: bodyText,
      },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: ctaLabel,
          flow_action: "navigate",
          flow_action_payload: {
            screen: "SIGN_IN",
          },
          // Draft flows only deliver to numbers on the tester list.
          mode,
        },
      },
    },
  };

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const result = await response.json();

  if (!response.ok) {
    console.error({ msg: "Failed to send Flow message", to, mode, error: result });
    throw new Error(result?.error?.message ?? "Failed to send Flow message");
  }

  console.info({ msg: "Flow message sent", to, mode, flow_token: flowToken });

  return { flowToken, result };
}
