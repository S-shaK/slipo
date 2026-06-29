import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTrip, endTrip } from "@/lib/trips.functions";
import { listReceiptsByTrip, createReceipt, deleteReceipt, getSignedReceiptUrls } from "@/lib/receipts.functions";
import { extractReceiptDetails } from "@/lib/ai-receipt.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, Loader2, Plus, Sparkles, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { EXPENSE_CATEGORIES, formatMoney, CATEGORY_LABEL } from "@/lib/categories";

export const Route = createFileRoute("/_authenticated/trips/$tripId")({
  component: LiveTrip,
});

function LiveTrip() {
  const { tripId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchTrip = useServerFn(getTrip);
  const fetchReceipts = useServerFn(listReceiptsByTrip);
  const finishTrip = useServerFn(endTrip);

  const trip = useQuery({ queryKey: ["trip", tripId], queryFn: () => fetchTrip({ data: { id: tripId } }) });
  const receipts = useQuery({ queryKey: ["receipts", tripId], queryFn: () => fetchReceipts({ data: { trip_id: tripId } }) });

  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState(false);

  const total = (receipts.data ?? []).reduce((s, r) => s + Number(r.amount), 0);

  async function handleEnd() {
    setEnding(true);
    try {
      await finishTrip({ data: { id: tripId } });
      qc.invalidateQueries({ queryKey: ["trip", tripId] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success("Trip completed");
      navigate({ to: "/trips/$tripId/report", params: { tripId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setEnding(false); }
  }

  if (trip.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!trip.data) return <p>Trip not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/trips" className="text-sm text-muted-foreground hover:text-foreground">← All trips</Link>
          <h1 className="mt-1 font-serif text-4xl">{trip.data.name}</h1>
          <p className="text-sm text-muted-foreground">
            {trip.data.start_date ?? "—"} → {trip.data.end_date ?? "ongoing"} · <span className="capitalize">{trip.data.status}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/trips/$tripId/report" params={{ tripId }}>
            <Button variant="outline"><FileText className="h-4 w-4" />Report</Button>
          </Link>
          {trip.data.status === "active" && (
            <Button onClick={handleEnd} disabled={ending}>
              {ending && <Loader2 className="h-4 w-4 animate-spin" />}End trip & generate report
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">Receipts</p><p className="font-serif text-4xl">{receipts.data?.length ?? 0}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">Trip total</p><p className="font-serif text-4xl">{formatMoney(total)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">Mileage tracking</p><p className="font-serif text-4xl">{trip.data.track_mileage ? "On" : "Off"}</p></CardContent></Card>
      </div>

      {trip.data.status === "active" && (
        <Card className="border-accent/50 bg-accent/5"><CardContent className="pt-6 text-center">
          <Camera className="mx-auto h-8 w-8 text-accent" />
          <h2 className="mt-2 font-serif text-2xl">Snap a receipt</h2>
          <p className="text-sm text-muted-foreground">AI fills in the total, vendor, and category from the photo.</p>
          <Button className="mt-4" size="lg" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />Add receipt
          </Button>
        </CardContent></Card>
      )}

      <section>
        <h2 className="mb-3 font-serif text-2xl">Receipts</h2>
        <ReceiptsList tripId={tripId} />
      </section>

      <AddReceiptDialog open={adding} onOpenChange={setAdding} tripId={tripId} />
    </div>
  );
}

function ReceiptsList({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const fetchReceipts = useServerFn(listReceiptsByTrip);
  const fetchUrls = useServerFn(getSignedReceiptUrls);
  const del = useServerFn(deleteReceipt);
  const receipts = useQuery({ queryKey: ["receipts", tripId], queryFn: () => fetchReceipts({ data: { trip_id: tripId } }) });
  const paths = (receipts.data ?? []).map((r) => r.image_path);
  const urls = useQuery({
    queryKey: ["sigurls", tripId, paths.join("|")],
    queryFn: () => fetchUrls({ data: { paths } }),
    enabled: paths.length > 0,
  });

  async function handleDelete(id: string) {
    if (!confirm("Delete this receipt?")) return;
    try { await del({ data: { id } }); qc.invalidateQueries({ queryKey: ["receipts", tripId] }); toast.success("Deleted"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  if ((receipts.data ?? []).length === 0) return <p className="text-sm text-muted-foreground">No receipts yet.</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {receipts.data!.map((r) => (
        <Card key={r.id} className="overflow-hidden">
          <div className="aspect-[4/3] bg-secondary">
            {urls.data?.[r.image_path] ? (
              <img src={urls.data[r.image_path]} alt={r.vendor ?? "Receipt"} className="h-full w-full object-cover" />
            ) : <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          </div>
          <CardContent className="space-y-1 pt-4">
            <div className="flex items-baseline justify-between">
              <p className="font-serif text-2xl">{formatMoney(Number(r.amount), r.currency)}</p>
              <button onClick={() => handleDelete(r.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
            <p className="text-sm">{r.vendor ?? "—"}</p>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category}</span>
              <span>{r.occurred_on}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AddReceiptDialog({ open, onOpenChange, tripId }: { open: boolean; onOpenChange: (b: boolean) => void; tripId: string }) {
  const qc = useQueryClient();
  const create = useServerFn(createReceipt);
  const extract = useServerFn(extractReceiptDetails);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [category, setCategory] = useState<string>("other");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  function reset() {
    setPath(null); setPreview(null); setAmount(""); setVendor(""); setCurrency("USD");
    setCategory("other"); setOccurredOn(new Date().toISOString().slice(0, 10)); setNotes("");
  }

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in");
      const fpath = `${uid}/${tripId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("receipts").upload(fpath, file, { upsert: false });
      if (error) throw error;
      setPath(fpath);
      setPreview(URL.createObjectURL(file));
      setExtracting(true);
      try {
        const r = await extract({ data: { image_path: fpath } });
        if (r.amount != null) setAmount(String(r.amount));
        if (r.vendor) setVendor(r.vendor);
        if (r.currency) setCurrency(r.currency);
        if (r.occurred_on) setOccurredOn(r.occurred_on);
        setCategory(r.category);
        toast.success("AI filled in receipt details — please confirm");
      } catch (e) {
        toast.warning(e instanceof Error ? e.message : "AI extraction failed — fill in manually");
      } finally { setExtracting(false); }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally { setUploading(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!path) return toast.error("Add a photo first");
    setSaving(true);
    try {
      await create({
        data: {
          trip_id: tripId,
          amount: Number(amount) || 0,
          currency,
          category: category as never,
          vendor: vendor || null,
          occurred_on: occurredOn,
          notes: notes || null,
          image_path: path,
        },
      });
      qc.invalidateQueries({ queryKey: ["receipts", tripId] });
      toast.success("Receipt added");
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-serif text-2xl">Add receipt</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!preview ? (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-secondary/40 py-10 text-sm text-muted-foreground hover:border-accent">
              {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
              <span>{uploading ? "Uploading…" : "Tap to take or upload photo"}</span>
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </label>
          ) : (
            <div className="relative overflow-hidden rounded-md border border-border">
              <img src={preview} alt="Preview" className="w-full" />
              {extracting && (
                <div className="absolute inset-0 grid place-items-center bg-background/80 backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 text-accent" />AI reading receipt…</div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" inputMode="decimal" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <Label>Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={4} />
            </div>
          </div>
          <div>
            <Label>Vendor</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Marriott Downtown" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <Button type="submit" className="w-full" disabled={saving || uploading || extracting}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save receipt
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
