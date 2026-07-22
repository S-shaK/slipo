import { createFileRoute } from "@tanstack/react-router";
import {
  createDecipheriv,
  createCipheriv,
  privateDecrypt,
  constants,
  createPrivateKey,
} from "node:crypto";

// WhatsApp Flow Data Endpoint
// Meta docs: https://developers.facebook.com/docs/whatsapp/flows/reference/implementingyourflowendpoint

type FlowRequest = {
  version: string;
  action: "ping" | "INIT" | "data_exchange" | "BACK";
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
};

function loadPrivateKey() {
  const pem = process.env.WHATSAPP_FLOW_PRIVATE_KEY;
  if (!pem) throw new Error("WHATSAPP_FLOW_PRIVATE_KEY is not set");
  const passphrase = process.env.WHATSAPP_FLOW_PASSPHRASE || undefined;
  return createPrivateKey({ key: pem, passphrase });
}

function decryptRequest(body: {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}) {
  const privateKey = loadPrivateKey();

  const aesKey = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(body.encrypted_aes_key, "base64"),
  );

  const flowDataBuffer = Buffer.from(body.encrypted_flow_data, "base64");
  const iv = Buffer.from(body.initial_vector, "base64");

  // Last 16 bytes are the GCM auth tag
  const TAG_LEN = 16;
  const encrypted = flowDataBuffer.subarray(0, flowDataBuffer.length - TAG_LEN);
  const tag = flowDataBuffer.subarray(flowDataBuffer.length - TAG_LEN);

  const decipher = createDecipheriv("aes-128-gcm", aesKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return { decrypted: JSON.parse(decrypted.toString("utf8")) as FlowRequest, aesKey, iv };
}

function encryptResponse(payload: unknown, aesKey: Buffer, iv: Buffer) {
  // Flip every bit of the IV per Meta spec
  const flippedIv = Buffer.from(iv.map((b) => b ^ 0xff));
  const cipher = createCipheriv("aes-128-gcm", aesKey, flippedIv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]).toString("base64");
}

async function handleAction(req: FlowRequest): Promise<unknown> {
  // Health check
  if (req.action === "ping") {
    return { data: { status: "active" } };
  }

  // Error notifications from the client — just acknowledge
  if (req.data && "error" in req.data) {
    console.error("WhatsApp Flow client error:", req.data);
    return { data: { acknowledged: true } };
  }

  // Sign-in flow stub. Replace screen names + payloads with what your Flow JSON expects.
  if (req.action === "INIT") {
    return {
      screen: "SIGN_IN",
      data: {},
    };
  }

  if (req.action === "data_exchange") {
    const screen = req.screen ?? "";
    const data = req.data ?? {};

    if (screen === "SIGN_IN") {
      const email = String(data.email ?? "").trim().toLowerCase();
      const password = String(data.password ?? "");

      if (!email || !password) {
        return {
          screen: "SIGN_IN",
          data: { error_message: "Email and password are required." },
        };
      }

      // Verify credentials against Supabase (server-side).
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false } },
      );
      const { data: auth, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error || !auth.session) {
        return {
          screen: "SIGN_IN",
          data: { error_message: "Invalid email or password." },
        };
      }

      // Terminal success — closes the Flow and returns this payload to your webhook.
      return {
        screen: "SUCCESS",
        data: {
          extension_message_response: {
            params: {
              flow_token: req.flow_token,
              user_id: auth.user?.id,
            },
          },
        },
      };
    }

    return { screen, data: {} };
  }

  if (req.action === "BACK") {
    return { screen: req.screen ?? "SIGN_IN", data: {} };
  }

  return { data: {} };
}

export const Route = createFileRoute("/api/public/whatsapp-flow")({
  server: {
    handlers: {
      GET: async () => new Response("ok", { status: 200 }),
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            encrypted_flow_data: string;
            encrypted_aes_key: string;
            initial_vector: string;
          };

          let decryptedReq;
          try {
            decryptedReq = decryptRequest(body);
          } catch (err) {
            // Meta expects HTTP 421 when the public key needs to be refreshed.
            console.error("Flow decrypt failed:", err);
            return new Response("Failed to decrypt. Refresh the public key.", { status: 421 });
          }

          const { decrypted, aesKey, iv } = decryptedReq;
          const responsePayload = await handleAction(decrypted);
          const encrypted = encryptResponse(responsePayload, aesKey, iv);

          return new Response(encrypted, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        } catch (err) {
          console.error("Flow endpoint error:", err);
          return new Response("Internal error", { status: 500 });
        }
      },
    },
  },
});
