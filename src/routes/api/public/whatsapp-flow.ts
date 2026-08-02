import { createFileRoute } from "@tanstack/react-router";
import {
  createDecipheriv,
  createCipheriv,
  createHmac,
  timingSafeEqual,
  privateDecrypt,
  constants,
} from "node:crypto";
import { createPublicKey } from "node:crypto";

// WhatsApp Flow Data Endpoint
// Meta docs: https://developers.facebook.com/docs/whatsapp/flows/reference/implementingyourflowendpoint

type FlowRequest = {
  version: string;
  action: "ping" | "INIT" | "data_exchange" | "BACK";
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
};
try {
  const { pem, passphrase } = loadPrivateKey();

  const pub = createPublicKey({
    key: pem,
    passphrase,
  }).export({
    type: "spki",
    format: "pem",
  });

  console.log("========== SERVER PUBLIC KEY ==========");
  console.log(pub.toString());
} catch (e) {
  console.error("FAILED TO LOAD PRIVATE KEY");
  console.error(e);
}
function loadPrivateKey() {
  const pem = process.env.WHATSAPP_FLOW_PRIVATE_KEY;
  if (!pem) throw new Error("WHATSAPP_FLOW_PRIVATE_KEY is not set");
  const passphrase = process.env.WHATSAPP_FLOW_PASSPHRASE || undefined;
  return { pem, passphrase };
}
function decryptRequest(body: {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}) {
  const { pem, passphrase } = loadPrivateKey();

  console.log("========== FLOW DECRYPT ==========");
  console.log("Encrypted AES key length:", body.encrypted_aes_key.length);
  console.log("Encrypted flow length:", body.encrypted_flow_data.length);
  console.log("IV length:", body.initial_vector.length);

  let aesKey: Buffer;

  try {
    aesKey = privateDecrypt(
      {
        key: pem,
        passphrase,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(body.encrypted_aes_key, "base64"),
    );

    console.log("RSA decrypt successful");
    console.log("AES key length:", aesKey.length);
  } catch (err) {
    console.error("========== RSA DECRYPT FAILED ==========");
    console.error(err);
    throw err;
  }

  const flowDataBuffer = Buffer.from(body.encrypted_flow_data, "base64");
  const iv = Buffer.from(body.initial_vector, "base64");

  console.log("Encrypted bytes:", flowDataBuffer.length);
  console.log("IV bytes:", iv.length);

  const TAG_LEN = 16;

  const encrypted = flowDataBuffer.subarray(
    0,
    flowDataBuffer.length - TAG_LEN
  );

  const tag = flowDataBuffer.subarray(
    flowDataBuffer.length - TAG_LEN
  );

  console.log("Ciphertext bytes:", encrypted.length);
  console.log("Auth tag bytes:", tag.length);

  try {
    const decipher = createDecipheriv(
      "aes-128-gcm",
      aesKey,
      iv
    );

    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    console.log("AES decrypt successful");

    return {
      decrypted: JSON.parse(decrypted.toString("utf8")) as FlowRequest,
      aesKey,
      iv,
    };
  } catch (err) {
    console.error("========== AES DECRYPT FAILED ==========");
    console.error("AES key:", aesKey.toString("hex"));
    console.error("IV:", iv.toString("hex"));
    console.error("Ciphertext length:", encrypted.length);
    console.error("Tag:", tag.toString("hex"));
    console.error(err);
    throw err;
  }
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

const APP_URL =
  process.env.APP_PUBLIC_URL || "https://slipo.lovable.app";

function publicClient() {
  return import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    }),
  );
}

function terminal(params: Record<string, unknown>, flowToken?: string) {
  return {
    screen: "SUCCESS",
    data: {
      extension_message_response: {
        params: { flow_token: flowToken, ...params },
      },
    },
  };
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

  if (req.action === "INIT") {
    return { screen: "SIGN_IN", data: {} };
  }

  if (req.action === "BACK") {
    return { screen: req.screen ?? "SIGN_IN", data: {} };
  }

  if (req.action !== "data_exchange") return { data: {} };

  const screen = req.screen ?? "";
  const data = req.data ?? {};
  const email = String(data.email ?? "").trim().toLowerCase();

  // ---- SIGN IN -----------------------------------------------------------
  if (screen === "SIGN_IN") {
    const password = String(data.password ?? "");
    if (!email || !password) {
      return terminal({ status: "error", message: "Email and password are required." }, req.flow_token);
    }

    const supabase = await publicClient();
    const { data: auth, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !auth.session) {
      return terminal({ status: "error", message: "Invalid email or password." }, req.flow_token);
    }

    const link = await magicLink(email);
    return terminal(
      {
        status: "signed_in",
        user_id: auth.user?.id,
        message: "Signed in. Tap the link to open your dashboard.",
        login_url: link ?? `${APP_URL}/auth`,
      },
      req.flow_token,
    );
  }

  // ---- SIGN UP -----------------------------------------------------------
  if (screen === "SIGN_UP") {
    const password = String(data.password ?? "");
    const confirm = String(data.confirm_password ?? "");
    const fullName = [data.first_name, data.last_name]
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .join(" ");

    if (!email || !password) {
      return terminal({ status: "error", message: "Email and password are required." }, req.flow_token);
    }
    if (password !== confirm) {
      return terminal({ status: "error", message: "Passwords do not match." }, req.flow_token);
    }
    if (password.length < 6) {
      return terminal({ status: "error", message: "Password must be at least 6 characters." }, req.flow_token);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName || null, source: "whatsapp_flow" },
    });

    if (error) {
      const msg = /already/i.test(error.message)
        ? "An account with that email already exists. Try signing in."
        : "Could not create your account. Please try again.";
      return terminal({ status: "error", message: msg }, req.flow_token);
    }

    const link = await magicLink(email);
    return terminal(
      {
        status: "signed_up",
        user_id: created.user?.id,
        message: "Account created. Tap the link to open your dashboard.",
        login_url: link ?? `${APP_URL}/auth`,
      },
      req.flow_token,
    );
  }

  // ---- FORGOT PASSWORD ---------------------------------------------------
  if (screen === "FORGOT_PASSWORD") {
    if (!email) {
      return terminal({ status: "error", message: "Email is required." }, req.flow_token);
    }
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${APP_URL}/auth` },
      });
    } catch (err) {
      console.error("recovery link error", err);
    }
    // Always the same answer — never reveal whether the account exists.
    return terminal(
      { status: "reset_sent", message: "If that email has an account, a reset link is on its way." },
      req.flow_token,
    );
  }

  return { screen, data: {} };
}

// One-time login link so the WhatsApp user lands in the web app already signed in.
async function magicLink(email: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${APP_URL}/dashboard` },
    });
    if (error) throw error;
    return data.properties?.action_link ?? null;
  } catch (err) {
    console.error("magic link error", err);
    return null;
  }
}


function verifySignature(rawBody: string, header: string | null) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  // If no app secret is configured, skip verification (dev / mock flows).
  if (!appSecret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = header.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/whatsapp-flow")({
  server: {
    handlers: {
      // Meta webhook verification handshake (hub.challenge / verify token)
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
        if (mode === "subscribe" && verifyToken && token === verifyToken) {
          return new Response(challenge ?? "", { status: 200 });
        }
        if (mode) return new Response("Forbidden", { status: 403 });
        return new Response("ok", { status: 200 });
      },
      POST: async ({ request }) => {
        try {
          const rawBody = await request.text();

          if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
            return new Response("Invalid signature", { status: 401 });
          }

          const body = JSON.parse(rawBody) as {
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

