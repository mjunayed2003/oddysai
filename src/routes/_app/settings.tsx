import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Settings, LogOut } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — OddysAI" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, signOut } = useAuth();
  const qc = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle()).data,
  });

  const [name, setName] = useState("");
  const [country, setCountry] = useState("");

  useEffect(() => {
    if (profile) { setName(profile.display_name ?? ""); setCountry(profile.country ?? ""); }
  }, [profile]);

  async function saveProfile() {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ display_name: name, country }).eq("id", user.id);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    qc.invalidateQueries({ queryKey: ["profile"] });
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="font-display text-2xl md:text-3xl font-bold">Account Settings</h1>
      </div>

      <div className="rounded-xl border border-border bg-gradient-card p-5 space-y-3">
        <h2 className="font-display font-semibold">Profile</h2>
        <div><Label>Email</Label><Input value={user?.email ?? ""} disabled className="mt-1" /></div>
        <div><Label>Display name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" /></div>
        <div><Label>Country</Label><Input value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1" /></div>
        <Button onClick={saveProfile} className="bg-gradient-primary text-primary-foreground">Save</Button>
      </div>

      <div className="rounded-xl border border-border bg-gradient-card p-5">
        <h2 className="font-display font-semibold mb-3">Session</h2>
        <Button onClick={() => signOut()} variant="outline"><LogOut className="h-4 w-4 mr-2" /> Sign out</Button>
      </div>
    </div>
  );
}
