import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyReports, addReport, becomeManager } from "@/lib/manager.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserPlus, MapPin, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/categories";
import { getMyProfileAndRoles } from "@/lib/manager.functions";

export const Route = createFileRoute("/_authenticated/manager")({
  component: ManagerPage,
});

function ManagerPage() {
  const qc = useQueryClient();
  const fetchMe = useServerFn(getMyProfileAndRoles);
  const promote = useServerFn(becomeManager);
  const fetchReports = useServerFn(listMyReports);
  const add = useServerFn(addReport);

  const me = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const isManager = me.data?.roles.includes("manager");
  const reports = useQuery({
    queryKey: ["reports"],
    queryFn: () => fetchReports(),
    enabled: !!isManager,
  });

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await add({ data: { email } });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Employee added");
      setEmail(""); setOpen(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function enableManager() {
    try { await promote(); await me.refetch(); toast.success("Manager view enabled"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  if (!isManager) {
    return (
      <Card><CardContent className="space-y-3 py-12 text-center">
        <h1 className="font-serif text-3xl">Manager view</h1>
        <p className="text-muted-foreground">Enable manager view to track your team's live trips and spending.</p>
        <Button onClick={enableManager}>Enable manager view</Button>
      </CardContent></Card>
    );
  }

  const teamTotal = (reports.data ?? []).reduce((s, r) => s + r.total_spend, 0);
  const liveTotal = (reports.data ?? []).reduce((s, r) => s + r.live_spend, 0);
  const activeTrips = (reports.data ?? []).reduce((s, r) => s + r.active_trip_count, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">Manager dashboard</p>
          <h1 className="font-serif text-4xl">Your team</h1>
        </div>
        <Button onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" />Add employee</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">Team members</p><p className="font-serif text-4xl">{reports.data?.length ?? 0}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">Live trips</p><p className="font-serif text-4xl">{activeTrips}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">Live spend</p><p className="font-serif text-4xl">{formatMoney(liveTotal)}</p><p className="mt-1 text-xs text-muted-foreground">All-time: {formatMoney(teamTotal)}</p></CardContent></Card>
      </div>

      <section className="space-y-3">
        {reports.isLoading && <p className="text-muted-foreground">Loading team…</p>}
        {(reports.data ?? []).length === 0 && !reports.isLoading && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            No employees yet. Add one to start tracking their trips.
          </CardContent></Card>
        )}
        {(reports.data ?? []).map((emp) => (
          <Card key={emp.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="font-serif text-2xl">{emp.full_name ?? emp.email}</CardTitle>
                  <p className="text-xs text-muted-foreground">{emp.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{emp.total_trip_count} trips</span>
                  {emp.active_trip_count > 0 && (
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">{emp.active_trip_count} live</span>
                  )}
                  <Link to="/trips/new" search={{ user_id: emp.id }}>
                    <Button size="sm" variant="outline"><Plus className="h-3 w-3" />Trip for them</Button>
                  </Link>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap gap-6 text-sm">
                <div><p className="text-xs uppercase text-muted-foreground">Live spend</p><p className="font-serif text-2xl">{formatMoney(emp.live_spend)}</p></div>
                <div><p className="text-xs uppercase text-muted-foreground">All-time spend</p><p className="font-serif text-2xl">{formatMoney(emp.total_spend)}</p></div>
              </div>
              <div className="space-y-1">
                {emp.trips.filter((t) => t.status === "active").map((t) => (
                  <Link key={t.id} to="/trips/$tripId" params={{ tripId: t.id }} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-accent">
                    <span className="flex items-center gap-2"><MapPin className="h-3 w-3 text-success" />{t.name}</span>
                    <span className="text-xs text-muted-foreground">Live</span>
                  </Link>
                ))}
                {emp.trips.filter((t) => t.status === "completed").slice(0, 3).map((t) => (
                  <Link key={t.id} to="/trips/$tripId/report" params={{ tripId: t.id }} className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary">
                    <span>{t.name}</span>
                    <span className="text-xs">{t.end_date ?? "—"}</span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="font-serif text-2xl">Add an employee</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">They need to have signed up already. Enter their account email and they'll appear on your dashboard.</p>
          <form onSubmit={handleAdd} className="space-y-3">
            <div>
              <Label htmlFor="empemail">Employee email</Label>
              <Input id="empemail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Add to team
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
