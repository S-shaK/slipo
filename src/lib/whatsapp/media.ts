/**
 * WhatsApp Flows – encrypted media download/decrypt helpers.
 *
 * A PhotoPicker/DocumentPicker component sends the endpoint an array of items:
 * { file_name, media_id, cdn_url, encryption_metadata: {...} }
 * The bytes at cdn_url are AES-256-CBC encrypted with an appended 10-byte HMAC.
 */

import { createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";

export type FlowMediaItem = {
  file_name?: string;
  media_id?: string;
  cdn_url: string;
  encryption_metadata: {
    encryption_key: string;
    hmac_key: string;
    iv: string;
    encrypted_hash?: string;
    plaintext_hash?: string;
  };
};

function b64(value: string) {
  return Buffer.from(value, "base64");
}

function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest();
}

/** Download the media from Meta's CDN and decrypt it to raw file bytes. */
export async function downloadFlowMedia(item: FlowMediaItem): Promise<Buffer> {
  const res = await fetch(item.cdn_url);
  if (!res.ok) {
    throw new Error(`Media download failed (${res.status})`);
  }
  const body = Buffer.from(await res.arrayBuffer());

  const meta = item.encryption_metadata;
  if (meta.encrypted_hash) {
    const expected = b64(meta.encrypted_hash);
    const actual = sha256(body);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error("Media hash mismatch (encrypted)");
    }
  }

  const ciphertext = body.subarray(0, body.length - 10);
  const hmac10 = body.subarray(body.length - 10);

  const iv = b64(meta.iv);
  const calcHmac = createHmac("sha256", b64(meta.hmac_key))
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
    .subarray(0, 10);
  if (!timingSafeEqual(calcHmac, hmac10)) {
    throw new Error("Media HMAC mismatch");
  }

  const decipher = createDecipheriv("aes-256-cbc", b64(meta.encryption_key), iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  if (meta.plaintext_hash) {
    const expected = b64(meta.plaintext_hash);
    const actual = sha256(plaintext);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error("Media hash mismatch (plaintext)");
    }
  }

  return plaintext;
}

export const RECEIPT_CATEGORIES = [
  "meals",
  "lodging",
  "transportation",
  "fuel",
  "entertainment",
  "office_supplies",
  "client_entertainment",
  "other",
] as const;

export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

export type ReceiptExtraction = {
  amount: number | null;
  currency: string;
  vendor: string | null;
  occurred_on: string | null;
  category: ReceiptCategory;
};

/** Run AI extraction on raw receipt image bytes via the Lovable AI Gateway. */
export async function extractReceiptFromBytes(
  bytes: Buffer,
  mimeType: string,
): Promise<ReceiptExtraction> {
  const fallback: ReceiptExtraction = {
    amount: null,
    currency: "USD",
    vendor: null,
    occurred_on: null,
    category: "other",
  };

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return fallback;

  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
    },
    body: JSON.stringify({
      model: "google/gemini-3.6-flash",
      messages: [
        {
          role: "system",
          content:
            "Extract structured expense data from a receipt photo. Reply with ONLY a JSON object, no markdown. Fields: amount (number, the final total paid), currency (ISO code, default USD), vendor (string), occurred_on (YYYY-MM-DD), category (one of: meals, lodging, transportation, fuel, entertainment, office_supplies, client_entertainment, other). Use null if unknown.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the expense details from this receipt." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error({ msg: "AI receipt extraction failed", status: res.status });
    return fallback;
  }

  const payload = await res.json();
  const raw: string = payload?.choices?.[0]?.message?.content ?? "";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return fallback;
  }

  const cat = String(parsed.category ?? "other");
  const amountNum = Number(parsed.amount);

  return {
    amount: Number.isFinite(amountNum) ? amountNum : null,
    currency: typeof parsed.currency === "string" && parsed.currency ? parsed.currency : "USD",
    vendor: typeof parsed.vendor === "string" ? parsed.vendor : null,
    occurred_on: typeof parsed.occurred_on === "string" ? parsed.occurred_on : null,
    category: (RECEIPT_CATEGORIES as readonly string[]).includes(cat)
      ? (cat as ReceiptCategory)
      : "other",
  };
}
