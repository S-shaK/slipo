import { createFileRoute } from "@tanstack/react-router";
import {
  createDecipheriv,
  createCipheriv,
  createHmac,
  timingSafeEqual,
  privateDecrypt,
  constants,
} from "node:crypto";
import { getNextScreen } from "@/lib/whatsapp/flow";

// WhatsApp Flow Data Endpoint
// Meta docs: https://developers.facebook.com/docs/whatsapp/flows/reference/implementingyourflowendpoint
//
// FIX: removed a module-top-level try/catch block that used to call
// loadPrivateKey() + createPublicKey().export() purely for debug logging
// (its result, `pub`, was never used anywhere). That code ran as a side
// effect of *importing this module* — i.e. on every cold start / route
// registration, before any request handler exists. In this SSR/edge
// framework, a throw during module evaluation happens outside any
// handler's own try/catch, so it bypasses our error handling entirely
// and surfaces as the framework's generic crash page instead of the
// plain-text "Internal error" our POST handler would normally return.
// That mismatch (HTML crash page vs. our own error text) is exactly
// what showed up in the logs, so removing this dead code should fix it.

function loadPrivateKey() {
  const raw = process.env.WHATSAPP_FLOW_PRIVATE_KEY;

  if (!raw) {
    throw new Error("WHATSAPP_FLOW_PRIVATE_KEY is not set");
  }

  let pem = raw
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .trim();

  // Fix Lovable single-line secret formatting
  if (!pem.includes("\n")) {
    const body = pem
      .replace("-----BEGIN PRIVATE KEY-----", "")
      .replace("-----END PRIVATE KEY-----", "")
      .replace(/\s+/g, "");

    const wrapped = body.match(/.{1,64}/g)?.join("\n");

    pem = `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
  }

  return { pem };
}

function decryptRequest(body: {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}) {
  const { pem } = loadPrivateKey();

  let aesKey: Buffer;

  try {
    aesKey = privateDecrypt(
      {
        key: pem,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(body.encrypted_aes_key, "base64"),
    );

    console.log("RSA decrypt successful");
    console.log("AES key length:", aesKey.length);
  } catch {
    throw new Error("RSA decrypt failed");
  }

  const flowDataBuffer = Buffer.from(body.encrypted_flow_data, "base64");
  const iv = Buffer.from(body.initial_vector, "base64");

  const TAG_LEN = 16;

  const encrypted = flowDataBuffer.subarray(
    0,
    flowDataBuffer.length - TAG_LEN
  );

  const tag = flowDataBuffer.subarray(
    flowDataBuffer.length - TAG_LEN
  );

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

    return {
      decrypted,
      aesKey,
      iv,
    };
  } catch {
    throw new Error("AES decrypt failed");
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
        // Fail loud and early, inside a context we control, if the key
        // env var is missing — rather than letting it surface deep
        // inside decryptRequest() with a less obvious log trail.
        if (!process.env.WHATSAPP_FLOW_PRIVATE_KEY) {
          console.error("WHATSAPP_FLOW_PRIVATE_KEY is not set");
        }

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
          const decryptedBody = JSON.parse(decrypted.toString("utf8"));

          const responsePayload = await getNextScreen(decryptedBody);
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
