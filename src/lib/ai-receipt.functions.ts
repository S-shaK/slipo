import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  image_path: z.string().min(1),
});

const CATEGORIES = [
  "meals", "lodging", "transportation", "fuel",
  "entertainment", "office_supplies", "client_entertainment", "other",
] as const;

type ReceiptSuggestion = {
  amount: number | null;
  currency: string;
  vendor: string | null;
  occurred_on: string | null;
  category: (typeof CATEGORIES)[number];
};

export const extractReceiptDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<ReceiptSuggestion> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured (missing LOVABLE_API_KEY)");

    // Get signed URL the model can fetch.
    const { data: signed, error } = await context.supabase.storage
      .from("receipts").createSignedUrl(data.image_path, 60 * 10);
    if (error || !signed?.signedUrl) throw new Error(error?.message ?? "Could not sign image URL");

    const body = {
      model: "google/gemini-2.5-flash",
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
            { type: "image_url", image_url: { url: signed.signedUrl } },
          ],
        },
      ],
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) throw new Error("AI is rate-limited. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
    if (!res.ok) throw new Error(`AI error ${res.status}: ${await res.text()}`);

    const payload = await res.json();
    const raw: string = payload?.choices?.[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(cleaned); } catch { /* fall through */ }

    const cat = String(parsed.category ?? "other") as ReceiptSuggestion["category"];
    return {
      amount: typeof parsed.amount === "number" ? parsed.amount : Number(parsed.amount) || null,
      currency: typeof parsed.currency === "string" ? parsed.currency : "USD",
      vendor: typeof parsed.vendor === "string" ? parsed.vendor : null,
      occurred_on: typeof parsed.occurred_on === "string" ? parsed.occurred_on : null,
      category: (CATEGORIES as readonly string[]).includes(cat) ? cat : "other",
    };
  });
