import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, Receipt, BarChart3, Users, FileDown, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Slipo — Travel expense reports without the spreadsheet" },
      { name: "description", content: "Snap receipts on the road. Auto-categorize with AI. Generate manager-ready reports and 5-year-compliant CSV exports." },
      { property: "og:title", content: "Slipo — Travel expense reports without the spreadsheet" },
      { property: "og:description", content: "Snap receipts on the road. Auto-categorize with AI. Generate manager-ready reports and 5-year-compliant CSV exports." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-serif text-xl">L</div>
            <span className="font-serif text-2xl">Ledger</span>
          </div>
          <nav className="flex items-center gap-3">
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
            <Link to="/auth" search={{ mode: "signup" }} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-20 pb-24">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm uppercase tracking-[0.2em] text-accent">For travelling employees & their managers</p>
          <h1 className="font-serif text-5xl leading-[1.05] sm:text-7xl">
            Receipts in your pocket.<br />
            <span className="italic text-muted-foreground">Reports in a tap.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Stop hoarding paper receipts. Snap each one as you spend, let AI read the total,
            and end the trip with a manager-ready report and audit-safe CSV.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/auth" search={{ mode: "signup" }} className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Track my own trips
            </Link>
            <Link to="/auth" search={{ mode: "signup" }} className="rounded-md border border-border bg-card px-6 py-3 text-sm font-medium hover:bg-secondary">
              I manage a team
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-border/60 bg-card">
        <div className="mx-auto grid max-w-6xl gap-px overflow-hidden bg-border/60 px-0 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { i: Camera, t: "Snap as you go", d: "Photograph receipts at the table, the gas pump, or the front desk." },
            { i: Receipt, t: "AI reads the total", d: "Amount, vendor, date, and category — all auto-filled from the photo." },
            { i: BarChart3, t: "Live trip totals", d: "Bar chart by category updates with every receipt you add." },
            { i: FileDown, t: "CSV + photo report", d: "End the trip and get a printable report plus a spreadsheet export." },
            { i: Users, t: "Manager dashboard", d: "Managers see live trips and spend from every employee in one place." },
            { i: ShieldCheck, t: "5-year retention", d: "Every receipt photo is kept for audit-grade retention by default." },
          ].map(({ i: Icon, t, d }) => (
            <div key={t} className="bg-card p-8">
              <Icon className="h-6 w-6 text-accent" />
              <h3 className="mt-4 font-serif text-2xl">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted-foreground">
        © {new Date().getFullYear()} Ledger. Built for people who travel for work.
      </footer>
    </div>
  );
}
