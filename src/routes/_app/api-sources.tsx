import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Copy, Check, Database, Link as LinkIcon, FileJson, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/api-sources")({
  head: () => ({
    meta: [
      { title: "API Sources — OddysAI" },
      { name: "description", content: "Paste API endpoints, docs links, and sample JSON responses for sports data integrations." },
    ],
  }),
  component: ApiSourcesPage,
});

type Source = {
  id: string;
  name: string;
  endpoint: string;
  docsUrl: string;
  authNotes: string;
  sampleJson: string;
  notes: string;
  createdAt: number;
};

const STORAGE_KEY = "oddysai.api-sources.v1";

function loadSources(): Source[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Source[]) : [];
  } catch {
    return [];
  }
}

function saveSources(s: Source[]) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

const empty: Omit<Source, "id" | "createdAt"> = {
  name: "", endpoint: "", docsUrl: "", authNotes: "", sampleJson: "", notes: "",
};

function ApiSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [draft, setDraft] = useState({ ...empty });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => { setSources(loadSources()); }, []);

  function persist(next: Source[]) {
    setSources(next);
    saveSources(next);
  }

  function handleAdd() {
    if (!draft.name.trim() && !draft.endpoint.trim() && !draft.sampleJson.trim()) {
      toast.error("Add at least a name, endpoint, or sample response.");
      return;
    }
    if (draft.sampleJson.trim()) {
      try { JSON.parse(draft.sampleJson); }
      catch { toast.error("Sample JSON is not valid JSON."); return; }
    }
    const item: Source = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...draft,
    };
    persist([item, ...sources]);
    setDraft({ ...empty });
    toast.success("API source saved locally.");
  }

  function handleDelete(id: string) {
    persist(sources.filter((s) => s.id !== id));
  }

  async function handleCopy(s: Source) {
    const block = [
      `# ${s.name || "Untitled API"}`,
      s.endpoint && `Endpoint: ${s.endpoint}`,
      s.docsUrl && `Docs: ${s.docsUrl}`,
      s.authNotes && `Auth: ${s.authNotes}`,
      s.notes && `Notes: ${s.notes}`,
      s.sampleJson && `Sample:\n${s.sampleJson}`,
    ].filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(block);
    setCopiedId(s.id);
    setTimeout(() => setCopiedId(null), 1500);
    toast.success("Copied to clipboard.");
  }

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8 space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
          <Database className="h-3.5 w-3.5" /> Data Integrations
        </div>
        <h1 className="font-display text-3xl font-bold">API Sources</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Paste API endpoints, documentation links, and sample JSON responses for sports data providers
          you'd like to integrate. Entries are saved in your browser only and ready to share with the OddysAI team.
        </p>
      </header>

      {/* New source form */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Add a new API source</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="e.g. SportMonks Football" value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endpoint">Endpoint URL</Label>
            <Input id="endpoint" placeholder="https://api.example.com/v3/fixtures" value={draft.endpoint}
              onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="docs">Documentation URL</Label>
            <Input id="docs" placeholder="https://docs.example.com" value={draft.docsUrl}
              onChange={(e) => setDraft({ ...draft, docsUrl: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth">Authentication notes</Label>
            <Input id="auth" placeholder="Header: X-API-Key, plan: free tier 100/day" value={draft.authNotes}
              onChange={(e) => setDraft({ ...draft, authNotes: e.target.value })} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sample">Sample JSON response</Label>
          <Textarea id="sample" rows={8} className="font-mono text-xs"
            placeholder='{ "fixture": { "id": 12345, "home": "...", "away": "..." } }'
            value={draft.sampleJson}
            onChange={(e) => setDraft({ ...draft, sampleJson: e.target.value })} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes (what should we use it for?)</Label>
          <Textarea id="notes" rows={3}
            placeholder="e.g. Use for live odds across women's leagues. Better H2H coverage than current source."
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDraft({ ...empty })}>Clear</Button>
          <Button onClick={handleAdd}><Plus className="h-4 w-4 mr-1" /> Save source</Button>
        </div>
      </section>

      {/* Saved list */}
      <section className="space-y-3">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
          Saved sources ({sources.length})
        </h2>

        {sources.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No API sources yet. Add one above to get started.
          </div>
        ) : (
          <div className="space-y-3">
            {sources.map((s) => (
              <article key={s.id} className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="font-semibold text-base">{s.name || "Untitled API"}</h3>
                    <div className="text-[11px] font-mono text-muted-foreground">
                      Added {new Date(s.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => handleCopy(s)}>
                      {copiedId === s.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(s.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  {s.endpoint && (
                    <div className="flex items-start gap-2 min-w-0">
                      <LinkIcon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <span className="font-mono text-xs break-all">{s.endpoint}</span>
                    </div>
                  )}
                  {s.docsUrl && (
                    <div className="flex items-start gap-2 min-w-0">
                      <BookOpen className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <a href={s.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline break-all">
                        {s.docsUrl}
                      </a>
                    </div>
                  )}
                </div>

                {s.authNotes && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Auth:</span> {s.authNotes}
                  </div>
                )}
                {s.notes && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Notes:</span> {s.notes}
                  </div>
                )}

                {s.sampleJson && (
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <FileJson className="h-3.5 w-3.5" /> View sample JSON
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted/40 p-3 text-[11px] font-mono leading-relaxed">
                      {s.sampleJson}
                    </pre>
                  </details>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
