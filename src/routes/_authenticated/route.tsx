import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfileAndRoles } from "@/lib/manager.functions";
import { LayoutDashboard, MapPin, Users, LogOut, Briefcase } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const fetchMe = useServerFn(getMyProfileAndRoles);
  const me = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const roles: string[] = me.data?.roles ?? [];
  const isManager = roles.includes("manager");

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nav = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/trips", label: "Trips", icon: MapPin },
    { to: "/manager", label: "Team", icon: Users },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-serif text-xl">L</div>
              <span className="font-serif text-xl">Ledger</span>
            </Link>
            <nav className="hidden gap-1 sm:flex">
              {nav.map(({ to, label, icon: Icon }) => {
                const active = pathname === to || pathname.startsWith(to + "/");
                return (
                  <Link key={to} to={to} className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    <Icon className="h-4 w-4" />{label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {me.data?.profile?.full_name ?? me.data?.profile?.email}
            </span>
            {isManager && <span className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent-foreground"><Briefcase className="h-3 w-3" />Manager</span>}
            <button onClick={signOut} className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* mobile nav */}
        <div className="border-t border-border/60 sm:hidden">
          <div className="mx-auto flex max-w-7xl gap-1 px-2 py-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} className="flex flex-1 flex-col items-center gap-0.5 rounded px-2 py-1.5 text-xs text-muted-foreground [&.active]:text-foreground" activeProps={{ className: "active bg-secondary" }}>
                <Icon className="h-4 w-4" />{label}
              </Link>
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
