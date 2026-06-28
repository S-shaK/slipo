import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyTrips } from "@/lib/trips.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/trips/")({
  component: TripsList,
});

function TripsList() {
  const fetchTrips = useServerFn(listMyTrips);
  const { data } = useQuery({ queryKey: ["trips"], queryFn: () => fetchTrips() });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="font-serif text-4xl">My trips</h1>
        <Link to="/trips/new"><Button><Plus className="h-4 w-4" />New trip</Button></Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(data ?? []).map((t) => (
          <Link key={t.id} to={t.status === "completed" ? "/trips/$tripId/report" : "/trips/$tripId"} params={{ tripId: t.id }}>
            <Card className="h-full transition hover:border-accent">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="font-serif text-2xl">{t.name}</CardTitle>
                  <StatusPill status={t.status} />
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {t.description && <p className="mb-2 line-clamp-2">{t.description}</p>}
                <p>{t.start_date ?? "—"} → {t.end_date ?? "—"}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
        {(data ?? []).length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3"><CardContent className="py-12 text-center text-muted-foreground">No trips yet.</CardContent></Card>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-success/15 text-success",
    completed: "bg-muted text-muted-foreground",
    planned: "bg-accent/20 text-accent-foreground",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] ?? ""}`}>{status}</span>;
}
