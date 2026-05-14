import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Wallet, Banknote, Plus, Trash2, ArrowDownToLine } from "lucide-react";
import { format } from "date-fns";

const MIN_WITHDRAWAL = 300;

type Method = {
  id: string;
  type: "bank" | "usdt_erc20" | "revolut";
  label: string | null;
  bank_account_holder: string | null;
  bank_iban: string | null;
  bank_swift: string | null;
  bank_name: string | null;
  wallet_address: string | null;
};

type PayoutRequest = {
  id: string;
  amount: number;
  status: "pending" | "approved" | "paid" | "rejected";
  created_at: string;
};

export function AffiliatePayout({ pendingPayout }: { pendingPayout: number }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"bank" | "usdt_erc20" | "revolut">("bank");
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState<string>("");

  // Bank form
  const [holder, setHolder] = useState("");
  const [iban, setIban] = useState("");
  const [swift, setSwift] = useState("");
  const [bankName, setBankName] = useState("");
  // Crypto form
  const [wallet, setWallet] = useState("");
  // Revolut form
  const [revolutId, setRevolutId] = useState("");
  const [label, setLabel] = useState("");

  const { data: methods = [] } = useQuery({
    queryKey: ["payout-methods", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("payout_methods").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Method[];
    },
  });

  const { data: requests = [] } = useQuery({
    queryKey: ["payout-requests", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("payout_requests").select("id, amount, status, created_at").order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      return (data ?? []) as PayoutRequest[];
    },
  });

  const addMethod = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("not signed in");
      const payload: any = { user_id: user.id, type: tab, label: label || null };
      if (tab === "bank") {
        if (!holder.trim() || !iban.trim()) throw new Error("Account holder and IBAN required");
        payload.bank_account_holder = holder.trim();
        payload.bank_iban = iban.replace(/\s+/g, "").toUpperCase();
        payload.bank_swift = swift.trim() || null;
        payload.bank_name = bankName.trim() || null;
      } else if (tab === "usdt_erc20") {
        if (!/^0x[a-fA-F0-9]{40}$/.test(wallet.trim())) throw new Error("Enter a valid USDT ERC-20 address (0x…)");
        payload.wallet_address = wallet.trim();
      } else {
        const v = revolutId.trim();
        if (v.length < 3) throw new Error("Enter your Revolut @revtag, email, or phone");
        payload.wallet_address = v;
      }
      const { error } = await supabase.from("payout_methods").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payout method saved");
      setHolder(""); setIban(""); setSwift(""); setBankName(""); setWallet(""); setRevolutId(""); setLabel("");
      qc.invalidateQueries({ queryKey: ["payout-methods"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save method"),
  });

  const removeMethod = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payout_methods").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["payout-methods"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const requestPayout = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt < MIN_WITHDRAWAL) throw new Error(`Minimum withdrawal is €${MIN_WITHDRAWAL}`);
      if (!methodId) throw new Error("Select a payout method");
      const { error } = await supabase.rpc("request_payout", { _amount: amt, _method_id: methodId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Withdrawal request submitted");
      setAmount("");
      qc.invalidateQueries({ queryKey: ["payout-requests"] });
      qc.invalidateQueries({ queryKey: ["affiliate"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to request payout"),
  });

  const canWithdraw = pendingPayout >= MIN_WITHDRAWAL && methods.length > 0;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Withdraw card */}
      <div className="rounded-xl border border-primary/30 bg-gradient-card p-5 shadow-glow">
        <div className="flex items-center gap-2 mb-1">
          <ArrowDownToLine className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold">Request withdrawal</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Minimum €{MIN_WITHDRAWAL}. Available: <span className="font-mono text-success">€{pendingPayout.toFixed(2)}</span>
        </p>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Amount (EUR)</Label>
            <Input
              type="number"
              min={MIN_WITHDRAWAL}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`${MIN_WITHDRAWAL}.00`}
              className="mt-1 font-mono"
            />
          </div>
          <div>
            <Label className="text-xs">Payout method</Label>
            <select
              value={methodId}
              onChange={(e) => setMethodId(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select method…</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.type === "bank"
                    ? `Bank · ${m.bank_iban?.slice(0, 4)}…${m.bank_iban?.slice(-4)}`
                    : m.type === "revolut"
                      ? `Revolut · ${m.wallet_address}`
                      : `USDT · ${m.wallet_address?.slice(0, 6)}…${m.wallet_address?.slice(-4)}`}
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={!canWithdraw || requestPayout.isPending}
            onClick={() => requestPayout.mutate()}
            className="w-full bg-gradient-primary text-primary-foreground"
          >
            {requestPayout.isPending ? "Submitting…" : "Request payout"}
          </Button>
          {!canWithdraw && (
            <p className="text-[11px] text-muted-foreground">
              {methods.length === 0 ? "Add a payout method first." : `Reach €${MIN_WITHDRAWAL} pending balance to withdraw.`}
            </p>
          )}
        </div>

        {requests.length > 0 && (
          <div className="mt-5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Recent requests</div>
            <ul className="space-y-1.5">
              {requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded-md border border-border bg-card/40 px-3 py-1.5 text-xs">
                  <span className="font-mono">€{Number(r.amount).toFixed(2)}</span>
                  <span className="text-muted-foreground">{format(new Date(r.created_at), "dd MMM")}</span>
                  <span className={`px-2 py-0.5 rounded font-mono uppercase text-[9px] ${r.status === "paid" ? "bg-success/15 text-success" : r.status === "rejected" ? "bg-danger/15 text-danger" : "bg-primary/15 text-primary"}`}>
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Methods card */}
      <div className="rounded-xl border border-border bg-gradient-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="h-5 w-5 text-accent" />
          <h3 className="font-display font-semibold">Payout methods</h3>
        </div>

        {methods.length > 0 && (
          <ul className="space-y-2 mb-4">
            {methods.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-lg border border-border bg-card/40 p-2.5">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">{m.type === "bank" ? "Bank transfer" : m.type === "revolut" ? "Revolut" : "USDT ERC-20"}</div>
                  <div className="font-mono text-xs truncate">
                    {m.type === "bank" ? `${m.bank_account_holder} · ${m.bank_iban}` : m.wallet_address}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => removeMethod.mutate(m.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as "bank" | "usdt_erc20" | "revolut")}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="bank"><Banknote className="h-3.5 w-3.5 mr-1.5" />Bank</TabsTrigger>
            <TabsTrigger value="revolut"><Wallet className="h-3.5 w-3.5 mr-1.5" />Revolut</TabsTrigger>
            <TabsTrigger value="usdt_erc20"><Wallet className="h-3.5 w-3.5 mr-1.5" />USDT</TabsTrigger>
          </TabsList>

          <TabsContent value="bank" className="space-y-2 pt-3">
            <Input placeholder="Account holder" value={holder} onChange={(e) => setHolder(e.target.value)} />
            <Input placeholder="IBAN" value={iban} onChange={(e) => setIban(e.target.value)} className="font-mono" />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="SWIFT / BIC (optional)" value={swift} onChange={(e) => setSwift(e.target.value)} className="font-mono" />
              <Input placeholder="Bank name (optional)" value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </div>
          </TabsContent>

          <TabsContent value="revolut" className="space-y-2 pt-3">
            <Input placeholder="@revtag, email, or phone number" value={revolutId} onChange={(e) => setRevolutId(e.target.value)} className="font-mono" />
            <p className="text-[11px] text-muted-foreground">Enter your Revolut @revtag (e.g. @johnsmith), the email, or phone number linked to your Revolut account.</p>
          </TabsContent>

          <TabsContent value="usdt_erc20" className="space-y-2 pt-3">
            <Input placeholder="0x… wallet address (Ethereum / ERC-20)" value={wallet} onChange={(e) => setWallet(e.target.value)} className="font-mono" />
            <p className="text-[11px] text-muted-foreground">Only USDT on the Ethereum (ERC-20) network is supported. Sending to a non-ERC-20 address will lose funds.</p>
          </TabsContent>

          <Input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} className="mt-2" />
          <Button onClick={() => addMethod.mutate()} disabled={addMethod.isPending} className="w-full mt-2" variant="outline">
            <Plus className="h-4 w-4 mr-1" />{addMethod.isPending ? "Saving…" : "Add method"}
          </Button>
        </Tabs>
      </div>
    </div>
  );
}
