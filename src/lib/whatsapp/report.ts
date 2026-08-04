/**
 * Trip report generation for the WhatsApp Flow.
 *
 * Builds either a CSV or a PDF for a trip (live or completed), stores it in
 * the private `receipts` bucket under `<user_id>/reports/`, and returns a
 * signed URL that can be opened from WhatsApp or emailed.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

const CATEGORY_LABELS: Record<string, string> = {
  meals: "Meals",
  lodging: "Lodging",
  transportation: "Transportation",
  fuel: "Fuel",
  entertainment: "Entertainment",
  office_supplies: "Office Supplies",
  client_entertainment: "Client Entertainment",
  other: "Other",
};

const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

function label(category: string) {
  return CATEGORY_LABELS[category] ?? category;
}

function csvCell(value: unknown) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function slug(name: string) {
  return (name || "trip").replace(/[^\w-]+/g, "_").slice(0, 60);
}

/** All trips for a user (live + completed), newest first. */
export async function listAllTrips(admin: Admin, userId: string) {
  const { data, error } = await admin
    .from("trips")
    .select("id, name, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error({ msg: "Failed to list trips for report", user_id: userId, error: error.message });
    return [];
  }

  return (data ?? []).map((t) => ({
    id: t.id,
    title: `${t.name}${t.status === "completed" ? " (completed)" : " (live)"}`,
  }));
}

async function loadTripData(admin: Admin, userId: string, tripId: string) {
  const { data: trip, error: tripError } = await admin
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .eq("user_id", userId)
    .single();

  if (tripError || !trip) throw new Error("trip_not_found");

  const { data: receipts, error: receiptError } = await admin
    .from("receipts")
    .select("*")
    .eq("trip_id", tripId)
    .order("occurred_on", { ascending: true });

  if (receiptError) throw new Error("receipts_failed");

  return { trip, receipts: receipts ?? [] };
}

async function signedUrlFor(admin: Admin, path: string) {
  const { data, error } = await admin.storage
    .from("receipts")
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) throw new Error("sign_failed");
  return data.signedUrl;
}

async function uploadReport(
  admin: Admin,
  userId: string,
  fileName: string,
  bytes: Uint8Array | string,
  contentType: string,
) {
  const path = `${userId}/reports/${Date.now()}-${fileName}`;
  const body = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const { error } = await admin.storage
    .from("receipts")
    .upload(path, body, { contentType, upsert: false });
  if (error) {
    console.error({ msg: "Report upload failed", user_id: userId, error: error.message });
    throw new Error("upload_failed");
  }
  return { path, url: await signedUrlFor(admin, path) };
}

function totalsByCategory(receipts: Array<{ category: string; amount: number | string }>) {
  const totals: Record<string, number> = {};
  for (const r of receipts) totals[r.category] = (totals[r.category] ?? 0) + Number(r.amount);
  return totals;
}

async function buildCsv(
  admin: Admin,
  trip: Database["public"]["Tables"]["trips"]["Row"],
  receipts: Database["public"]["Tables"]["receipts"]["Row"][],
) {
  const rows: string[][] = [
    ["Trip", "Date", "Vendor", "Category", "Amount", "Currency", "Notes", "Image"],
  ];

  for (const r of receipts) {
    let image = r.image_path;
    try {
      image = await signedUrlFor(admin, r.image_path);
    } catch {
      /* keep raw path */
    }
    rows.push([
      trip.name,
      r.occurred_on,
      r.vendor ?? "",
      label(r.category),
      Number(r.amount).toFixed(2),
      r.currency,
      (r.notes ?? "").replace(/[\r\n]+/g, " "),
      image,
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

async function buildPdf(
  admin: Admin,
  trip: Database["public"]["Tables"]["trips"]["Row"],
  receipts: Database["public"]["Tables"]["receipts"]["Row"][],
) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.08, 0.11, 0.19);
  const muted = rgb(0.45, 0.47, 0.53);
  const accent = rgb(0.78, 0.62, 0.25);

  let page = pdf.addPage([595, 842]); // A4
  const M = 48;
  let y = 842 - M;

  const text = (
    s: string,
    opts: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb>; x?: number } = {},
  ) => {
    const size = opts.size ?? 11;
    page.drawText(s, { x: opts.x ?? M, y, size, font: opts.f ?? font, color: opts.color ?? ink });
    y -= size + 6;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < M) {
      page = pdf.addPage([595, 842]);
      y = 842 - M;
    }
  };

  const grandTotal = receipts.reduce((s, r) => s + Number(r.amount), 0);
  const currency = receipts[0]?.currency ?? "USD";
  const money = (n: number) => `${currency} ${n.toFixed(2)}`;

  text("TRIP EXPENSE REPORT", { size: 10, color: muted });
  text(trip.name, { size: 24, f: bold });
  text(
    `${trip.start_date ?? "—"} to ${trip.end_date ?? "ongoing"}  ·  Status: ${trip.status}  ·  Generated ${new Date().toISOString().slice(0, 10)}`,
    { size: 9, color: muted },
  );
  y -= 10;

  text(`Total expenses: ${money(grandTotal)}`, { size: 14, f: bold });
  text(`Receipts: ${receipts.length}`, { size: 11, color: muted });
  if (trip.track_mileage && trip.start_odometer != null && trip.end_odometer != null) {
    text(`Mileage: ${Number(trip.end_odometer) - Number(trip.start_odometer)} mi`, {
      size: 11,
      color: muted,
    });
  }
  y -= 12;

  // Category bar chart
  const totals = totalsByCategory(receipts);
  const entries = Object.entries(totals).filter(([, v]) => v > 0);
  if (entries.length > 0) {
    ensureSpace(40 + entries.length * 22);
    text("Spending by category", { size: 14, f: bold });
    y -= 4;
    const max = Math.max(...entries.map(([, v]) => v));
    const barX = M + 130;
    const barMax = 595 - M - barX - 70;
    for (const [cat, value] of entries) {
      const w = Math.max(2, (value / max) * barMax);
      page.drawText(label(cat), { x: M, y: y, size: 9, font, color: ink });
      page.drawRectangle({ x: barX, y: y - 3, width: w, height: 11, color: accent });
      page.drawText(money(value), { x: barX + w + 6, y, size: 9, font, color: muted });
      y -= 22;
      ensureSpace(22);
    }
    y -= 10;
  }

  // Receipt list
  ensureSpace(40);
  text("Receipts", { size: 14, f: bold });
  y -= 2;
  for (const r of receipts) {
    ensureSpace(200);
    page.drawText(`${r.occurred_on}  ·  ${r.vendor ?? "—"}`, { x: M, y, size: 11, font: bold, color: ink });
    page.drawText(money(Number(r.amount)), { x: 595 - M - 90, y, size: 11, font: bold, color: ink });
    y -= 14;
    page.drawText(`${label(r.category)}${r.notes ? ` — ${r.notes.slice(0, 80)}` : ""}`, {
      x: M,
      y,
      size: 9,
      font,
      color: muted,
    });
    y -= 12;

    // Embed the receipt image when possible
    try {
      const { data: file } = await admin.storage.from("receipts").download(r.image_path);
      if (file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
        const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const maxW = 180;
        const scale = Math.min(maxW / img.width, 140 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ensureSpace(h + 16);
        page.drawImage(img, { x: M, y: y - h, width: w, height: h });
        y -= h + 16;
      }
    } catch {
      y -= 4;
    }
  }

  if (receipts.length === 0) text("No receipts recorded for this trip.", { size: 10, color: muted });

  ensureSpace(30);
  y -= 10;
  page.drawText("Receipt images are retained for 5 years to support tax audit compliance.", {
    x: M,
    y,
    size: 8,
    font,
    color: muted,
  });

  return await pdf.save();
}

export type ReportResult = {
  tripName: string;
  format: "csv" | "pdf";
  url: string;
  total: number;
  receiptCount: number;
  currency: string;
};

export async function generateTripReport(
  admin: Admin,
  userId: string,
  tripId: string,
  format: "csv" | "pdf",
): Promise<ReportResult> {
  const { trip, receipts } = await loadTripData(admin, userId, tripId);
  const base = slug(trip.name);

  const uploaded =
    format === "csv"
      ? await uploadReport(admin, userId, `${base}-expenses.csv`, await buildCsv(admin, trip, receipts), "text/csv")
      : await uploadReport(admin, userId, `${base}-report.pdf`, await buildPdf(admin, trip, receipts), "application/pdf");

  return {
    tripName: trip.name,
    format,
    url: uploaded.url,
    total: receipts.reduce((s, r) => s + Number(r.amount), 0),
    receiptCount: receipts.length,
    currency: receipts[0]?.currency ?? "USD",
  };
}

/**
 * Email the report link. Returns false when no email provider is configured,
 * so the caller can fall back to delivering the link in WhatsApp.
 */
export async function emailReport(to: string, report: ReportResult): Promise<boolean> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["REPORT_EMAIL_FROM"];
  if (!apiKey || !from || !to) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: `Expense report — ${report.tripName}`,
        html: `<p>Your ${report.format.toUpperCase()} report for <strong>${report.tripName}</strong> is ready.</p>
<p>${report.receiptCount} receipts · Total ${report.currency} ${report.total.toFixed(2)}</p>
<p><a href="${report.url}">Download the report</a> (link valid for 7 days)</p>`,
      }),
    });
    if (!res.ok) {
      console.error({ msg: "Report email failed", status: res.status, body: await res.text() });
      return false;
    }
    return true;
  } catch (err) {
    console.error({ msg: "Report email error", error: String(err) });
    return false;
  }
}
