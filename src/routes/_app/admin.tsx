import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useIsAdmin } from "@/hooks/use-role";
import { useEffect } from "react";
import { Shield, Users, CreditCard, Activity, Cpu, CheckCircle2, XCircle, Bug } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import {
  assertAdmin,
  getAdminOverview,
  getAdminAuditGrants,
  getAdminLogs,
} from "@/lib/admin.functions";
import { getSportsApiDebug } from "@/lib/sports.functions";
import { runFixtureDiagnostics, type DiagCheck, type DiagStatus } from "@/lib/diagnostics.functions";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_app/admin")({
  head: () => ({ meta: [{ title: "Admin — OddysAI" }] }),
  // Server-side admin gate: runs before any admin HTML is rendered. If the
  // server function throws (401/403), redirect to /dashboard so non-admins
  // never receive admin markup. Client-side `useIsAdmin` is kept as a
  // belt-and-suspenders check.
  beforeLoad: async () => {
    try {
      await assertAdmin();
    } catch {
      throw redirect({ to: "/dashboard", replace: true });
    }
  },
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin, loading } = useIsAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/dashboard", replace: true });
  }, [loading, isAdmin, navigate]);

  const fetchOverview = useServerFn(getAdminOverview);
  const fetchAuditGrants = useServerFn(getAdminAuditGrants);
  const fetchLogs = useServerFn(getAdminLogs);
  const fetchSportsDebug = useServerFn(getSportsApiDebug);

  // Block rendering of any admin UI until the role check resolves AND confirms admin.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">Verifying access…</div>
      </div>
    );
  }
  if (!isAdmin) return null;

  // All data below comes from server functions guarded by `requireAdmin`,
  // which re-checks the admin role on the server and writes to admin_logs.
  const { data: overview } = useQuery({
    queryKey: ["admin-overview"],
    enabled: isAdmin,
    queryFn: () => fetchOverview(),
  });
  const subs = overview?.subs ?? [];
  const usage = overview?.usage ?? [];

  const { data: grants, isLoading: auditLoading, error: auditError } = useQuery({
    queryKey: ["admin-audit-grants"],
    enabled: isAdmin,
    queryFn: () => fetchAuditGrants(),
  });
  const audit = grants?.functionGrants ?? [];
  const tableAudit = grants?.tableGrants ?? [];
  const tableAuditLoading = auditLoading;
  const tableAuditError = auditError;

  const { data: logsData } = useQuery({
    queryKey: ["admin-logs"],
    enabled: isAdmin,
    queryFn: () => fetchLogs(),
  });
  const logs = logsData?.logs ?? [];

  const { data: sportsDebug } = useQuery({
    queryKey: ["admin-sports-api-debug"],
    enabled: isAdmin,
    queryFn: () => fetchSportsDebug(),
  });


  const planDist = ["free", "basic", "pro", "elite"].map((p) => ({
    name: p.toUpperCase(),
    value: subs.filter((s) => s.plan === p && s.status === "active").length,
  }));
  const COLORS = ["oklch(0.50 0.02 250)", "oklch(0.70 0.10 230)", "oklch(0.82 0.22 145)", "oklch(0.78 0.17 75)"];

  const activeSubs = subs.filter((s) => s.status === "active" && s.plan !== "free").length;
  const mrr = subs
    .filter((s) => s.status === "active")
    .reduce((sum, s) => sum + (s.plan === "basic" ? 19 : s.plan === "pro" ? 29 : s.plan === "elite" ? 79 : 0), 0);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-accent" />
        <h1 className="font-display text-2xl md:text-3xl font-bold">Admin Dashboard</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Total users" value={String(subs.length)} />
        <Stat icon={CreditCard} label="Active subs" value={String(activeSubs)} />
        <Stat icon={Activity} label="MRR" value={`€${mrr}`} positive />
        <Stat icon={Cpu} label="API calls" value={String(usage.length)} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="usage">API Usage</TabsTrigger>
          <TabsTrigger value="sports">Sports API</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="security">Security Audit</TabsTrigger>
          <TabsTrigger value="logs">Audit Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid lg:grid-cols-2 gap-4 mt-4">
          <div className="rounded-xl border border-border bg-gradient-card p-5">
            <h3 className="font-display font-semibold mb-3">Plan distribution</h3>
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={planDist} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                    {planDist.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "oklch(0.21 0.025 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-gradient-card p-5">
            <h3 className="font-display font-semibold mb-3">Subs by plan</h3>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={planDist}>
                  <XAxis dataKey="name" stroke="oklch(0.68 0.02 250)" tick={{ fontSize: 10 }} />
                  <YAxis stroke="oklch(0.68 0.02 250)" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "oklch(0.21 0.025 250)", border: "1px solid oklch(0.30 0.025 250)", borderRadius: 8 }} />
                  <Bar dataKey="value" fill="oklch(0.82 0.22 145)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <div className="rounded-xl border border-border bg-gradient-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                <tr><th className="text-left px-4 py-2">User ID</th><th className="text-left px-4 py-2">Plan</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Period end</th></tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-4 py-2 font-mono text-xs">{s.user_id.slice(0, 8)}…</td>
                    <td className="px-4 py-2 uppercase font-mono text-xs">{s.plan}</td>
                    <td className="px-4 py-2 text-xs">{s.status}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <div className="rounded-xl border border-border bg-gradient-card p-5">
            <p className="text-sm text-muted-foreground">{usage.length} API calls logged. Wire your sports data + AI calls to <code className="text-primary">api_usage</code> for full telemetry.</p>
          </div>
        </TabsContent>

        <TabsContent value="sports" className="mt-4">
          <div className="rounded-xl border border-border bg-gradient-card overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
              <Bug className="h-4 w-4 text-primary" />
              <div>
                <h3 className="font-display font-semibold">Paid sports API debug</h3>
                <p className="text-xs text-muted-foreground mt-1">Key configured: {sportsDebug?.keyConfigured ? "yes" : "no"} · timezone: {sportsDebug?.timezone ?? "UTC"}</p>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                <tr><th className="text-left px-4 py-2">Endpoint</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Rows</th><th className="text-left px-4 py-2">Quota</th><th className="text-left px-4 py-2">Errors</th></tr>
              </thead>
              <tbody>
                {(sportsDebug?.entries ?? []).map((e, i) => (
                  <tr key={`${e.endpoint}-${i}`} className="border-t border-border">
                    <td className="px-4 py-2 font-mono text-xs break-all">{e.endpoint}</td>
                    <td className="px-4 py-2 font-mono text-xs">{e.status ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{e.responseCount ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{e.quotaRemaining ?? "—"}/{e.quotaLimit ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{e.errors ?? e.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="diagnostics" className="mt-4">
          <DiagnosticsPanel />
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <div className="rounded-xl border border-border bg-gradient-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-display font-semibold">SECURITY DEFINER grant audit</h3>
                <p className="text-xs text-muted-foreground mt-1">Verifies which roles can EXECUTE each privileged function vs the expected matrix.</p>
              </div>
              {!auditLoading && audit.length > 0 && (
                <span className={`font-mono text-xs px-2 py-1 rounded ${audit.every((r) => r.ok) ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {audit.filter((r) => r.ok).length}/{audit.length} OK
                </span>
              )}
            </div>
            {auditError && <div className="p-5 text-sm text-destructive">Failed to load audit: {(auditError as Error).message}</div>}
            {auditLoading && <div className="p-5 text-sm text-muted-foreground">Running audit…</div>}
            {!auditLoading && !auditError && (
              <table className="w-full text-sm">
                <thead className="bg-card/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Function</th>
                    <th className="text-left px-4 py-2">Role</th>
                    <th className="text-left px-4 py-2">Expected</th>
                    <th className="text-left px-4 py-2">Actual</th>
                    <th className="text-left px-4 py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-4 py-2 font-mono text-xs">{r.function_signature}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.role_name}</td>
                      <td className="px-4 py-2 font-mono text-xs">{String(r.expected)}</td>
                      <td className="px-4 py-2 font-mono text-xs">{String(r.actual)}</td>
                      <td className="px-4 py-2">
                        {r.ok
                          ? <CheckCircle2 className="h-4 w-4 text-success" />
                          : <XCircle className="h-4 w-4 text-destructive" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-xl border border-border bg-gradient-card overflow-hidden mt-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="font-display font-semibold">RBAC table-grant audit</h3>
                <p className="text-xs text-muted-foreground mt-1">Verifies that anon/authenticated roles have no broader table privileges than expected.</p>
              </div>
              {!tableAuditLoading && tableAudit.length > 0 && (
                <span className={`font-mono text-xs px-2 py-1 rounded ${tableAudit.every((r) => r.ok) ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {tableAudit.filter((r) => r.ok).length}/{tableAudit.length} OK
                </span>
              )}
            </div>
            {tableAuditError && <div className="p-5 text-sm text-destructive">Failed to load audit: {(tableAuditError as Error).message}</div>}
            {tableAuditLoading && <div className="p-5 text-sm text-muted-foreground">Running audit…</div>}
            {!tableAuditLoading && !tableAuditError && (
              <table className="w-full text-sm">
                <thead className="bg-card/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Object</th>
                    <th className="text-left px-4 py-2">Role</th>
                    <th className="text-left px-4 py-2">Privilege</th>
                    <th className="text-left px-4 py-2">Expected</th>
                    <th className="text-left px-4 py-2">Actual</th>
                    <th className="text-left px-4 py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {tableAudit.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-4 py-2 font-mono text-xs">{r.object_name}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.role_name}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.privilege}</td>
                      <td className="px-4 py-2 font-mono text-xs">{String(r.expected)}</td>
                      <td className="px-4 py-2 font-mono text-xs">{String(r.actual)}</td>
                      <td className="px-4 py-2">
                        {r.ok
                          ? <CheckCircle2 className="h-4 w-4 text-success" />
                          : <XCircle className="h-4 w-4 text-destructive" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <div className="rounded-xl border border-border bg-gradient-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-display font-semibold">Admin action audit log</h3>
              <p className="text-xs text-muted-foreground mt-1">Last 200 admin events. Every privileged server call writes here.</p>
            </div>
            {logs.length === 0 ? (
              <div className="p-5 text-sm text-muted-foreground">No entries yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-card/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">When</th>
                    <th className="text-left px-4 py-2">Actor</th>
                    <th className="text-left px-4 py-2">Action</th>
                    <th className="text-left px-4 py-2">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l: any) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2 font-mono text-xs">{l.actor_id ? l.actor_id.slice(0, 8) + "…" : "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{l.action}</td>
                      <td className="px-4 py-2 font-mono text-xs">{l.target ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ icon: Icon, label, value, positive }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-gradient-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className={`mt-1 font-mono text-2xl font-bold ${positive ? "text-success" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function statusBadge(s: DiagStatus) {
  const map: Record<DiagStatus, string> = {
    ok: "bg-success/15 text-success border-success/30",
    missing: "bg-muted/40 text-muted-foreground border-border",
    empty: "bg-warning/15 text-warning border-warning/30",
    error: "bg-danger/15 text-danger border-danger/30",
    rate_limited: "bg-danger/15 text-danger border-danger/30",
  };
  const label: Record<DiagStatus, string> = {
    ok: "OK",
    missing: "Missing",
    empty: "Empty",
    error: "Error",
    rate_limited: "Rate Limited",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider ${map[s]}`}>{label[s]}</span>;
}

function DiagnosticsPanel() {
  const runDiag = useServerFn(runFixtureDiagnostics);
  const [fixtureId, setFixtureId] = useState("");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [league, setLeague] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ reqId: string; generatedAt: string; checks: DiagCheck[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await runDiag({
        data: {
          fixtureId: fixtureId.trim() || undefined,
          homeTeam: homeTeam.trim() || undefined,
          awayTeam: awayTeam.trim() || undefined,
          league: league.trim() || undefined,
        },
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Diagnostic run failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-gradient-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
        <Bug className="h-4 w-4 text-primary" />
        <div>
          <h3 className="font-display font-semibold">Provider diagnostics</h3>
          <p className="text-xs text-muted-foreground mt-1">Run live checks against API-Football, Odds API, team matching and quotas. Full provider responses are logged to server logs (no API keys exposed).</p>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div><Label className="text-xs">Fixture id</Label><Input value={fixtureId} onChange={(e) => setFixtureId(e.target.value)} placeholder="af-123456 or 123456" className="mt-1" /></div>
          <div><Label className="text-xs">Home team</Label><Input value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)} className="mt-1" /></div>
          <div><Label className="text-xs">Away team</Label><Input value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)} className="mt-1" /></div>
          <div><Label className="text-xs">League</Label><Input value={league} onChange={(e) => setLeague(e.target.value)} placeholder="Premier League" className="mt-1" /></div>
        </div>
        <Button onClick={run} disabled={running} className="bg-gradient-primary text-primary-foreground">{running ? "Running checks…" : "Run diagnostics"}</Button>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        {result ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 bg-card/60 text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex justify-between">
              <span>Request {result.reqId}</span>
              <span>{new Date(result.generatedAt).toLocaleString()}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-card/40 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                <tr><th className="text-left px-4 py-2">Check</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Detail</th></tr>
              </thead>
              <tbody>
                {result.checks.map((c) => (
                  <tr key={c.key} className="border-t border-border">
                    <td className="px-4 py-2 text-xs">{c.label}</td>
                    <td className="px-4 py-2">{statusBadge(c.status)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground break-all">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
