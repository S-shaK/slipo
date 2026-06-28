import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { createTrip } from "@/lib/trips.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

const search = z.object({ user_id: z.string().uuid().optional() });

export const Route = createFileRoute("/_authenticated/trips/new")({
  validateSearch: search,
  component: NewTrip,
});

function NewTrip() {
  const { user_id } = useSearch({ from: "/_authenticated/trips/new" });
  const navigate = useNavigate();
  const create = useServerFn(createTrip);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState<string>(new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState<string>("");
  const [track, setTrack] = useState(false);
  const [odometer, setOdometer] = useState<string>("");
  const [odoPath, setOdoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function uploadOdo(file: File) {
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in");
      const path = `${uid}/odometer/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file, { upsert: false });
      if (error) throw error;
      setOdoPath(path);
      toast.success("Starting odometer photo saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const trip = await create({
        data: {
          name,
          description: description || null,
          start_date: start || null,
          end_date: end || null,
          track_mileage: track,
          start_odometer: track && odometer ? Number(odometer) : null,
          start_odometer_path: track ? odoPath : null,
          user_id,
        },
      });
      toast.success("Trip started!");
      navigate({ to: "/trips/$tripId", params: { tripId: trip.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create trip");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">New trip</p>
        <h1 className="font-serif text-4xl">Start a trip</h1>
      </div>

      <Card><CardContent className="pt-6">
        <form onSubmit={submit} className="space-y-5">
          <div>
            <Label htmlFor="name">Trip name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 client visits — Chicago" required />
          </div>
          <div>
            <Label htmlFor="desc">Notes (optional)</Label>
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start">Start date</Label>
              <Input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="end">End date (optional)</Label>
              <Input id="end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border border-border bg-secondary/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Track mileage</p>
                <p className="text-xs text-muted-foreground">Capture starting odometer now, ending odometer when you finish.</p>
              </div>
              <Switch checked={track} onCheckedChange={setTrack} />
            </div>
            {track && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <div>
                  <Label htmlFor="odo">Starting odometer</Label>
                  <Input id="odo" type="number" inputMode="decimal" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="e.g. 42180" />
                </div>
                <div>
                  <Label>Odometer photo</Label>
                  <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background py-6 text-sm text-muted-foreground hover:border-accent">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    {odoPath ? "Photo saved — replace" : "Take or upload photo"}
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadOdo(f); }} />
                  </label>
                </div>
              </div>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={saving || uploading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Start trip
          </Button>
        </form>
      </CardContent></Card>
    </div>
  );
}
