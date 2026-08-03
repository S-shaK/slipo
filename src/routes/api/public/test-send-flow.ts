import { createFileRoute } from "@tanstack/react-router";
import { sendFlowMessage } from "@/lib/whatsapp/send-flow";

// TEMPORARY test route — delete once you've confirmed the draft Flow send
// works. Protected by a shared secret in the URL so randoms can't trigger
// WhatsApp sends against your account.
export const Route = createFileRoute("/api/public/test-send-flow")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("key");
        const to = url.searchParams.get("to");

        if (!process.env.TEST_SEND_FLOW_SECRET || key !== process.env.TEST_SEND_FLOW_SECRET) {
          return new Response("Forbidden", { status: 403 });
        }
        if (!to) {
          return new Response("Missing ?to=", { status: 400 });
        }

        try {
          const { flowToken } = await sendFlowMessage({ to, mode: "draft" });
          return new Response(`Sent. flow_token: ${flowToken}`, { status: 200 });
        } catch (err) {
          console.error("Test send failed:", err);
          return new Response(String(err), { status: 500 });
        }
      },
    },
  },
});
