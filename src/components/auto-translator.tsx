import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { translateBatch } from "@/lib/translate.functions";

const CACHE_PREFIX = "oddysai_tr_v4_";
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "CODE",
  "PRE",
  "TEXTAREA",
  "INPUT",
  "SVG",
  "PATH",
]);
const NUMERIC_RE = /^[\s\d.,:%/+\-–·•|()\[\]{}]+$/;
const URL_EMAIL_RE = /^(?:https?:\/\/|mailto:|[\w.+-]+@)/i;
const ORIGINAL = new WeakMap<Text, string>();

function shouldSkipNode(n: Node): boolean {
  let p: Node | null = n.parentNode;
  while (p) {
    if (p.nodeType === Node.ELEMENT_NODE) {
      const el = p as HTMLElement;
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.getAttribute("data-no-translate") != null) return true;
      if (el.isContentEditable) return true;
    }
    p = p.parentNode;
  }
  return false;
}

function isTranslatable(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (NUMERIC_RE.test(t)) return false;
  if (URL_EMAIL_RE.test(t)) return false;
  // Skip strings without any letter
  if (!/[A-Za-zÀ-ÿΑ-Ωα-ωÄÖÜäöüß]/.test(t)) return false;
  return true;
}

function loadCache(lang: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + lang);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(lang: string, cache: Record<string, string>) {
  try {
    localStorage.setItem(CACHE_PREFIX + lang, JSON.stringify(cache));
  } catch {
    /* ignore quota */
  }
}

export function AutoTranslator() {
  const { i18n } = useTranslation();
  const fn = useServerFn(translateBatch);
  const langRef = useRef(i18n.resolvedLanguage ?? i18n.language ?? "en");
  const cacheRef = useRef<Record<string, string>>({});
  const pendingRef = useRef<Set<Text>>(new Set());
  const inFlightRef = useRef(false);
  const observerRef = useRef<MutationObserver | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Collect all eligible text nodes under a given root.
  function collect(root: Node, out: Text[]) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null = walker.nextNode();
    while (n) {
      const t = n as Text;
      const original = ORIGINAL.get(t) ?? t.nodeValue ?? "";
      if (
        !shouldSkipNode(t) &&
        isTranslatable(original)
      ) {
        out.push(t);
      }
      n = walker.nextNode();
    }
  }

  function applyToNode(node: Text, lang: string) {
    const original = ORIGINAL.get(node) ?? node.nodeValue ?? "";
    if (!ORIGINAL.has(node)) ORIGINAL.set(node, original);
    if (lang === "en") {
      if (node.nodeValue !== original) node.nodeValue = original;
      return;
    }
    const trimmed = original.trim();
    if (!trimmed) return;
    const cached = cacheRef.current[trimmed];
    if (cached) {
      // preserve leading/trailing whitespace
      const leading = original.match(/^\s*/)?.[0] ?? "";
      const trailing = original.match(/\s*$/)?.[0] ?? "";
      const next = leading + cached + trailing;
      if (node.nodeValue !== next) node.nodeValue = next;
    } else {
      pendingRef.current.add(node);
    }
  }

  async function flushPending() {
    if (inFlightRef.current) return;
    const lang = langRef.current;
    if (lang === "en") {
      pendingRef.current.clear();
      return;
    }
    const nodes = Array.from(pendingRef.current);
    pendingRef.current.clear();
    if (nodes.length === 0) return;

    // Deduplicate by trimmed source
    const groups = new Map<string, Text[]>();
    for (const n of nodes) {
      const orig = (ORIGINAL.get(n) ?? n.nodeValue ?? "").trim();
      if (!orig) continue;
      if (cacheRef.current[orig]) {
        applyToNode(n, lang);
        continue;
      }
      const arr = groups.get(orig) ?? [];
      arr.push(n);
      groups.set(orig, arr);
    }
    const uniqueTexts = Array.from(groups.keys());
    if (uniqueTexts.length === 0) return;

    inFlightRef.current = true;
    try {
      // Batch in chunks of 30
      for (let i = 0; i < uniqueTexts.length; i += 30) {
        const chunk = uniqueTexts.slice(i, i + 30);
        if (langRef.current !== lang) break; // lang switched mid-flight
        try {
          const res = await fn({ data: { texts: chunk, targetLang: lang as any } });
          const out = res?.translations ?? chunk;
          for (let k = 0; k < chunk.length; k++) {
            const src = chunk[k];
            const tr = out[k] ?? src;
            cacheRef.current[src] = tr;
            const targets = groups.get(src) ?? [];
            for (const t of targets) applyToNode(t, lang);
          }
          saveCache(lang, cacheRef.current);
        } catch {
          // swallow chunk failure, continue
        }
      }
    } finally {
      inFlightRef.current = false;
      // If new pending appeared while in-flight, flush again
      if (pendingRef.current.size > 0) {
        scheduleFlush();
      }
    }
  }

  function scheduleFlush() {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void flushPending();
    }, 200);
  }

  function translateRoot(root: Node) {
    const lang = langRef.current;
    const nodes: Text[] = [];
    collect(root, nodes);
    for (const n of nodes) applyToNode(n, lang);
    if (lang !== "en") scheduleFlush();
  }

  useEffect(() => {
    const lang = i18n.resolvedLanguage ?? i18n.language ?? "en";
    langRef.current = lang;
    cacheRef.current = loadCache(lang);

    // Initial pass
    translateRoot(document.body);

    // Observe new content
    observerRef.current?.disconnect();
    const obs = new MutationObserver((mutations) => {
      const lang2 = langRef.current;
      for (const m of mutations) {
        if (m.type === "characterData") {
          const t = m.target as Text;
          // If the text changed externally (e.g. React update), reset original
          ORIGINAL.delete(t);
          if (!shouldSkipNode(t) && isTranslatable(t.nodeValue ?? "")) {
            applyToNode(t, lang2);
          }
        } else if (m.type === "childList") {
          m.addedNodes.forEach((n) => {
            if (n.nodeType === Node.TEXT_NODE) {
              const t = n as Text;
              if (!shouldSkipNode(t) && isTranslatable(t.nodeValue ?? "")) {
                applyToNode(t, lang2);
              }
            } else if (n.nodeType === Node.ELEMENT_NODE) {
              translateRoot(n);
            }
          });
        }
      }
      if (lang2 !== "en") scheduleFlush();
    });
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    observerRef.current = obs;

    return () => {
      obs.disconnect();
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.resolvedLanguage, i18n.language]);

  return null;
}
