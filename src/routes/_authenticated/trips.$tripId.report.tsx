import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTrip } from "@/lib/trips.functions";
import { listReceiptsByTrip, getSignedReceiptUrls } from "@/lib/receipts.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { FileDown, ArrowLeft, Loader2 } from "lucide-react";
import { EXPENSE_CATEGORIES, formatMoney, CATEGORY_LABEL } from "@/lib/categories";

export const Route = createFileRoute("/_authenticated/trips/$tripId/report")({
  component: ReportPage,
});

function ReportPage() {
  const { tripId } = Route.useParams();
  const fetchTrip = useServerFn(getTrip);
  const fetchReceipts = useServerFn(listReceiptsByTrip);
  const fetchUrls = useServerFn(getSignedReceiptUrls);

  const trip = useQuery({ queryKey: ["trip", tripId], queryFn: () => fetchTrip({ data: { id: tripId } }) });
  const receipts = useQuery({ queryKey: ["receipts", tripId], queryFn: () => fetchReceipts({ data: { trip_id: tripId } }) });
  const paths = (receipts.data ?? []).map((r) => r.image_path);
  const urls = useQuery({
    queryKey: ["sigurls-report", tripId, paths.join("|")],
    queryFn: () => fetchUrls({ data: { paths } }),
    enabled: paths.length > 0,
  });

  const chart = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const r of receipts.data ?? []) totals[r.category] = (totals[r.category] ?? 0) + Number(r.amount);
    return EXPENSE_CATEGORIES.map((c) => ({
      key: c.value,
      name: c.label,
      total: totals[c.value] ?? 0,
      color: `var(--color-chart-${EXPENSE_CATEGORIES.indexOf(c) + 1})`,
    })).filter((x) => x.total > 0);
  }, [receipts.data]);

  const grandTotal = (receipts.data ?? []).reduce((s, r) => s + Number(r.amount), 0);

  function downloadCsv() {
    const rows = [
      ["Trip", "Date", "Vendor", "Category", "Amount", "Currency", "Notes", "Image"],
      ...(receipts.data ?? []).map((r) => [
        trip.data?.name ?? "",
        r.occurred_on,
        r.vendor ?? "",
        CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category,
        Number(r.amount).toFixed(2),
        r.currency,
        (r.notes ?? "").replace(/[\r\n]+/g, " "),
        urls.data?.[r.image_path] ?? r.image_path,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => {
      const s = String(cell);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(trip.data?.name ?? "trip").replace(/[^\w-]+/g, "_")}-receipts.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (trip.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!trip.data) return <p>Trip not found.</p>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <Link to="/trips/$tripId" params={{ tripId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" />Back to trip
          </Link>
          <h1 className="mt-2 font-serif text-4xl">Expense report</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>Print / save PDF</Button>
          <Button onClick={downloadCsv}><FileDown className="h-4 w-4" />Download CSV</Button>
        </div>
      </div>

      {/* Printable area */}
      <div className="space-y-8">
        <div className="border-b border-border pb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Trip report</p>
          <h2 className="mt-2 font-serif text-5xl">{trip.data.name}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {trip.data.start_date ?? "—"} → {trip.data.end_date ?? "—"} · Generated {new Date().toLocaleDateString()}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">Total expenses</p><p className="font-serif text-4xl">{formatMoney(grandTotal)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">Receipts</p><p className="font-serif text-4xl">{receipts.data?.length ?? 0}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">Mileage</p><p className="font-serif text-4xl">{trip.data.track_mileage && trip.data.start_odometer != null && trip.data.end_odometer != null ? `${Number(trip.data.end_odometer) - Number(trip.data.start_odometer)} mi` : "—"}</p></CardContent></Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            <h3 className="mb-4 font-serif text-2xl">Spending by category</h3>
            {chart.length === 0 ? <p className="text-sm text-muted-foreground">No receipts to chart.</p> : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                    <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => `$${v}`} />
                    <Tooltip cursor={{ fill: "var(--color-secondary)" }} formatter={(v: number) => formatMoney(v)} contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                    <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                      {chart.map((c, i) => <Cell key={c.key} fill={`var(--color-chart-${i + 1})`} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <section>
          <h3 className="mb-4 font-serif text-2xl">All receipts</h3>
          <div className="space-y-4">
            {(receipts.data ?? []).map((r) => (
              <Card key={r.id} className="break-inside-avoid">
                <CardContent className="grid gap-4 pt-6 sm:grid-cols-[200px,1fr]">
                  <div className="aspect-[4/3] overflow-hidden rounded-md bg-secondary">
                    {urls.data?.[r.image_path] ? (
                      <img src={urls.data[r.image_path]} alt={r.vendor ?? "Receipt"} className="h-full w-full object-cover" />
                    ) : <div className="grid h-full place-items-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between">
                      <p className="font-serif text-2xl">{r.vendor ?? "—"}</p>
                      <p className="font-serif text-2xl">{formatMoney(Number(r.amount), r.currency)}</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category} · {r.occurred_on}</p>
                    {r.notes && <p className="mt-3 text-sm">{r.notes}</p>}
                  </div>
                </CardContent>
              </Card>
            ))}
            {(receipts.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No receipts in this trip.</p>}
          </div>
        </section>

        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          Receipt images are retained for 5 years to support tax audit compliance.
        </p>
      </div>
    </div>
  );
}
