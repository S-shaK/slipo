import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyTrips } from "@/lib/trips.functions";
import { getMyProfileAndRoles, becomeManager } from "@/lib/manager.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, MapPin, CheckCircle2, Briefcase } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const fetchTrips = useServerFn(listMyTrips);
  const fetchMe = useServerFn(getMyProfileAndRoles);
  const promote = useServerFn(becomeManager);
  const me = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const trips = useQuery({ queryKey: ["trips"], queryFn: () => fetchTrips() });

  const active = trips.data?.filter((t) => t.status === "active") ?? [];
  const completed = trips.data?.filter((t) => t.status === "completed") ?? [];
  const isManager = me.data?.roles.includes("manager");

  async function makeMeManager() {
    try { await promote(); await me.refetch(); toast.success("You're now a manager. Add your team in the Team tab."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">Welcome back</p>
          <h1 className="font-serif text-4xl">{me.data?.profile?.full_name ?? "Traveler"}</h1>
        </div>
        <Link to="/trips/new"><Button size="lg"><Plus className="h-4 w-4" />Start a new trip</Button></Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Active trips" value={active.length} icon={MapPin} />
        <Stat label="Completed trips" value={completed.length} icon={CheckCircle2} />
        <Stat label="Total trips" value={trips.data?.length ?? 0} icon={Briefcase} />
      </div>

      {!isManager && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div>
              <p className="font-medium">Managing a team?</p>
              <p className="text-sm text-muted-foreground">Switch on the manager view to track your direct reports' trips and spending.</p>
            </div>
            <Button variant="outline" onClick={makeMeManager}>Enable manager view</Button>
          </CardContent>
        </Card>
      )}

      <section>
        <h2 className="mb-3 font-serif text-2xl">Active trips</h2>
        {active.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            No active trips. <Link to="/trips/new" className="text-foreground underline">Start one</Link>.
          </CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((t) => (
              <Link key={t.id} to="/trips/$tripId" params={{ tripId: t.id }}>
                <Card className="transition hover:border-accent">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="font-serif text-2xl">{t.name}</CardTitle>
                      <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">Live</span>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {t.start_date ?? "—"} → {t.end_date ?? "ongoing"}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-serif text-2xl">Recent reports</h2>
        {completed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Your completed trip reports will appear here.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {completed.slice(0, 6).map((t) => (
              <Link key={t.id} to="/trips/$tripId/report" params={{ tripId: t.id }}>
                <Card className="transition hover:border-accent">
                  <CardHeader><CardTitle className="font-serif text-xl">{t.name}</CardTitle></CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {t.start_date ?? "—"} → {t.end_date ?? "—"}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-accent" />
        </div>
        <p className="mt-2 font-serif text-4xl">{value}</p>
      </CardContent>
    </Card>
  );
}
