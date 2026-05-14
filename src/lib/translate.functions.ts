import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  texts: z.array(z.string().min(1).max(2000)).min(1).max(60),
  targetLang: z.enum(["en", "de", "it", "el", "es"]),
});

let _admin: ReturnType<typeof createClient> | null = null;
function getAdmin() {
  if (!_admin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    _admin = createClient(url, key, { auth: { persistSession: false } });
  }
  return _admin;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

const LANG_NAME: Record<string, string> = {
  en: "English",
  de: "German",
  it: "Italian",
  el: "Greek",
  es: "Spanish",
};

export const translateBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.targetLang === "en") {
      return { translations: data.texts };
    }

    // Per-user hourly rate limit on translation calls (anti-abuse)
    const admin0 = getAdmin();
    if (admin0) {
      try {
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count } = await (admin0
          .from("api_usage") as any)
          .select("id", { count: "exact", head: true })
          .eq("user_id", context.userId)
          .eq("kind", "translate_batch")
          .gte("created_at", since);
        if ((count ?? 0) >= 200) {
          return { translations: data.texts };
        }
        await (admin0.from("api_usage") as any).insert({
          user_id: context.userId,
          kind: "translate_batch",
          cost: 0,
        });
      } catch {
        /* don't block on rate-limit accounting */
      }
    }

    // 1) Check shared DB cache first (instant for repeat phrases across all users)
    const admin = getAdmin();
    const hashes = data.texts.map(hashText);
    const cacheMap = new Map<string, string>(); // hash -> translated
    if (admin) {
      try {
        const { data: rows } = await admin
          .from("translation_cache")
          .select("source_hash, translated_text")
          .eq("target_lang", data.targetLang)
          .in("source_hash", hashes);
        for (const r of (rows ?? []) as Array<{ source_hash: string; translated_text: string }>) {
          cacheMap.set(r.source_hash, r.translated_text);
        }
      } catch {
        /* ignore cache read errors, fall through to AI */
      }
    }

    // Determine which texts still need AI translation
    const missingIdx: number[] = [];
    for (let i = 0; i < data.texts.length; i++) {
      if (!cacheMap.has(hashes[i])) missingIdx.push(i);
    }

    // If everything is cached, return immediately — zero AI cost
    if (missingIdx.length === 0) {
      return {
        translations: data.texts.map((src, i) => cacheMap.get(hashes[i]) ?? src),
      };
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        translations: data.texts.map((src, i) => cacheMap.get(hashes[i]) ?? src),
      };
    }

    const target = LANG_NAME[data.targetLang];
    const items = missingIdx.map((origIdx, i) => ({ id: i, text: data.texts[origIdx] }));

    // Per-language style guide. We bias the model toward a premium,
    // sports-analytics editorial voice — never literal, never tipster slang,
    // never robotic AI phrasing.
    const STYLE_GUIDE: Record<string, string> = {
      el: `Greek (Ελληνικά) style guide:
- Voice: premium sports-analytics platform, modern, institutional, professional. Never gambling-tipster slang, never literal/word-for-word translation.
- Rewrite for natural Greek flow. Prefer concise nouns and verified-data wording over English sentence structure.
- Tone: confident but neutral. No exclamations, no informal slang, no anglicisms unless industry-standard.
- Required terminology mapping (ALWAYS use these — never literal alternatives):
  • "low confidence" / "low-confidence" → "περιορισμένη επιβεβαίωση αγοράς"
  • "limited market confidence" → "περιορισμένη κάλυψη αγοράς"
  • "lower-confidence market environment" → "περιβάλλον περιορισμένης κάλυψης αγοράς"
  • "stuck" / "staying stuck" / "κολλημένοι" → "μέχρι να ενεργοποιηθεί πλήρης κάλυψη αγοράς"
  • "conservative baseline" → "συντηρητική εκτίμηση βάσης"
  • "stake conservatively" → "διαχειριστείτε την έκθεση με προσοχή"
  • "value bet" → "αξία στην αγορά"
  • "edge" → "πλεονέκτημα μοντέλου"
  • "odds" → "αποδόσεις"
  • "fixture" → "αγώνας"
  • "kickoff" → "έναρξη αγώνα"
  • "head-to-head" / "H2H" → "ιστορικό αναμετρήσεων"
  • "form" → "πρόσφατη φόρμα"
  • "lineups" → "ενδεκάδες"
  • "injuries" → "τραυματισμοί"
  • "standings" → "βαθμολογία"
  • "verified" → "επαληθευμένο"
  • "real-time" → "σε πραγματικό χρόνο"
  • "premium" → "premium" (αμετάφραστο)
  • "AI" / "GPT" / "OddysAI" / "SportMonks" → αμετάφραστα
  • "High" / "High risk" / "High confidence" (ως αυτόνομη ετικέτα ή badge) → ΠΑΝΤΑ αρσενικό: "Υψηλός" (όχι "Υψηλή", όχι "Υψηλό"). π.χ. "High risk" → "Υψηλός κίνδυνος", "High confidence" → "Υψηλός βαθμός εμπιστοσύνης".
  • "Medium" → "Μέτριος" (αρσενικό), "Low" → "Χαμηλός" (αρσενικό) όταν είναι αυτόνομες ετικέτες/badges.
- BANNED phrasings: "κολλημένοι", "χαμηλής εμπιστοσύνης", "παγιδευμένοι", "Υψηλή" / "Υψηλό" ως αυτόνομη ετικέτα, direct calques like "στοιχηματίστε συντηρητικά", "ποσοστό πιθανότητας ~XX%".
- Numbers, percentages, scores, timestamps, dates: leave untouched.`,
      de: `German (Deutsch) style guide:
- Voice: premium sports-analytics platform, modern, institutional, professional. Never gambling-tipster slang, never literal English-to-German.
- Use formal "Sie" register; avoid Anglicisms unless industry-standard.
- Required terminology mapping (ALWAYS use these):
  • "low confidence" / "low-confidence" → "eingeschränkte Marktbestätigung"
  • "limited market confidence" → "eingeschränkte Marktabdeckung"
  • "lower-confidence market environment" → "Marktumfeld mit eingeschränkter Abdeckung"
  • "stuck" / "staying stuck" → "bis vollständige Marktabdeckung verfügbar ist"
  • "conservative baseline" → "konservative Basiseinschätzung"
  • "stake conservatively" → "Risiko umsichtig steuern"
  • "value bet" → "Value-Wette"
  • "edge" → "Modellvorteil"
  • "odds" → "Quoten"
  • "fixture" → "Spiel"
  • "kickoff" → "Anstoß"
  • "head-to-head" / "H2H" → "direkter Vergleich"
  • "form" → "aktuelle Form"
  • "lineups" → "Aufstellungen"
  • "injuries" → "Verletzungen"
  • "standings" → "Tabelle"
  • "verified" → "verifiziert"
  • "real-time" → "in Echtzeit"
  • "premium" → "Premium" (unverändert)
- BANNED: "konservativ wetten", literal calques like "geringes Vertrauen", "festgefahren", "stecken bleiben".`,
      it: `Italian (Italiano) style guide:
- Voice: premium sports-analytics platform, modern, institutional, professional. Never tipster slang, never literal English-to-Italian.
- Register: cortese, professionale, terza persona quando possibile.
- Required terminology mapping (ALWAYS use these):
  • "low confidence" / "low-confidence" → "conferma di mercato limitata"
  • "limited market confidence" → "copertura di mercato limitata"
  • "lower-confidence market environment" → "contesto di mercato con copertura limitata"
  • "stuck" / "staying stuck" → "in attesa di una copertura di mercato completa"
  • "conservative baseline" → "stima conservativa di riferimento"
  • "stake conservatively" → "gestire l'esposizione con prudenza"
  • "value bet" → "valore di mercato"
  • "edge" → "vantaggio del modello"
  • "odds" → "quote"
  • "fixture" → "partita"
  • "kickoff" → "fischio d'inizio"
  • "head-to-head" / "H2H" → "scontri diretti"
  • "form" → "forma recente"
  • "lineups" → "formazioni"
  • "injuries" → "infortuni"
  • "standings" → "classifica"
  • "verified" → "verificato"
  • "real-time" → "in tempo reale"
  • "premium" → "premium" (invariato)
- BANNED: "scommettere conservativamente", "bassa fiducia", "rimanere bloccati", calchi letterali dall'inglese.`,
      es: `Spanish (Español de España) style guide:
- Voice: premium sports-analytics platform, modern, institutional, professional. Never tipster slang, never literal English-to-Spanish.
- Register: cortés, profesional; usar "usted" implícito o tercera persona cuando sea natural; evitar voseo.
- Required terminology mapping (ALWAYS use these):
  • "low confidence" / "low-confidence" → "confirmación de mercado limitada"
  • "limited market confidence" → "cobertura de mercado limitada"
  • "lower-confidence market environment" → "entorno de mercado con cobertura limitada"
  • "stuck" / "staying stuck" → "a la espera de una cobertura de mercado completa"
  • "conservative baseline" → "estimación base conservadora"
  • "stake conservatively" → "gestionar la exposición con prudencia"
  • "value bet" → "valor de mercado"
  • "edge" → "ventaja del modelo"
  • "odds" → "cuotas"
  • "fixture" → "partido"
  • "kickoff" → "saque inicial"
  • "head-to-head" / "H2H" → "enfrentamientos directos"
  • "form" → "forma reciente"
  • "lineups" → "alineaciones"
  • "injuries" → "lesiones"
  • "standings" → "clasificación"
  • "verified" → "verificado"
  • "real-time" → "en tiempo real"
  • "premium" → "premium" (invariable)
- BANNED: "apostar conservadoramente", "baja confianza", "estar atrapado", calcos literales del inglés.`,
      en: ``,
    };

    const prompt = `Translate the "text" of each item to ${target}.
${STYLE_GUIDE[data.targetLang] ?? ""}

Universal rules:
- Preserve meaning and intent — but rewrite naturally in the target language. Do NOT translate word-by-word.
- Match the original punctuation style and casing where it makes sense in the target language.
- NEVER translate: "OddysAI", "SportMonks", "GPT", "AI", team names, league names, player names, country names, scorelines, numbers, percentages, URLs, email addresses, time/date stamps.
- Single-word labels like "OK", "1X2", "FT", "HT" stay as-is.
- If a source string is already in the target language, return it unchanged.
- Output STRICT JSON only: { "items": [ { "id": <number>, "translated": "<string>" }, ... ] } — one entry per input id, in the same order.

Input:
${JSON.stringify({ items })}`;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "You are a senior localization editor for a premium sports-analytics platform. You translate UI and analytical copy with native fluency, never literally. Output only valid compact JSON, no markdown, no commentary.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        return {
          translations: data.texts.map((src, i) => cacheMap.get(hashes[i]) ?? src),
        };
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as {
        items?: Array<{ id: number; translated: string }>;
      };
      const aiMap = new Map<number, string>(); // local id -> translated
      for (const it of parsed.items ?? []) {
        if (typeof it?.id === "number" && typeof it?.translated === "string") {
          aiMap.set(it.id, it.translated);
        }
      }

      // Build final translations + persist new entries to shared cache
      const rowsToInsert: Array<{
        source_hash: string;
        target_lang: string;
        source_text: string;
        translated_text: string;
      }> = [];
      const translations = data.texts.map((src, i) => {
        const cached = cacheMap.get(hashes[i]);
        if (cached) return cached;
        const localIdx = missingIdx.indexOf(i);
        const tr = localIdx >= 0 ? aiMap.get(localIdx) : undefined;
        if (tr && tr !== src) {
          rowsToInsert.push({
            source_hash: hashes[i],
            target_lang: data.targetLang,
            source_text: src,
            translated_text: tr,
          });
          return tr;
        }
        return src;
      });

      // Persist to shared cache (fire-and-forget, no await blocking response)
      if (admin && rowsToInsert.length > 0) {
        (admin.from("translation_cache") as any)
          .upsert(rowsToInsert, { onConflict: "source_hash,target_lang", ignoreDuplicates: true })
          .then(() => {}, () => {});
      }

      return { translations };
    } catch {
      return {
        translations: data.texts.map((src, i) => cacheMap.get(hashes[i]) ?? src),
      };
    }
  });
