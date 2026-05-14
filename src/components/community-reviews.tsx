import { Star, Quote } from "lucide-react";

type Review = {
  name: string;
  lang: string;
  text: string;
  rating: number;
};

const REVIEWS: Review[] = [
  {
    name: "Mateusz K.",
    lang: "PL",
    rating: 5,
    text: "Bardzo dobre, polecam.",
  },
  {
    name: "Sofia R.",
    lang: "PT",
    rating: 4,
    text: "Gosto da forma como mostra a probabilidade e o valor. Sério e direto.",
  },
  {
    name: "Giorgos P.",
    lang: "GR",
    rating: 5,
    text: "Poly kalo, aksizei ta 5.99.",
  },
  {
    name: "Lukas M.",
    lang: "DE",
    rating: 4,
    text: "Saubere Oberfläche, klare Zahlen. Wirkt erwachsen.",
  },
  {
    name: "Elena V.",
    lang: "RO",
    rating: 5,
    text: "Foarte util.",
  },
  {
    name: "Tom B.",
    lang: "EN",
    rating: 4,
    text: "Solid second opinion before a match. No hype, just numbers.",
  },
  {
    name: "Davide L.",
    lang: "IT",
    rating: 5,
    text: "Finalmente qualcosa di serio.",
  },
  {
    name: "Nadia C.",
    lang: "FR",
    rating: 4,
    text: "Très propre, interface claire et analyses utiles.",
  },
  {
    name: "Marek H.",
    lang: "CZ",
    rating: 4,
    text: "Dobré, neslibuje zázraky.",
  },
  {
    name: "Andrés F.",
    lang: "ES",
    rating: 5,
    text: "Muy bueno.",
  },
  {
    name: "Jeroen V.",
    lang: "NL",
    rating: 4,
    text: "Werkt prima op mobiel, snel en geen onzin.",
  },
  {
    name: "Kostas A.",
    lang: "GR",
    rating: 5,
    text: "Δεν περίμενα ότι θα μου άρεσε τόσο. Το unlock των 5,99€ ανά αγώνα είναι αρκετά καλό, έκανα δελτίο με 3 αναλύσεις που πήρα και δεν με δεσμεύει με συνδρομή. Καθαρό και σοβαρό site.",
  },
  {
    name: "Hannah W.",
    lang: "EN",
    rating: 4,
    text: "Very nice.",
  },
  {
    name: "Luca G.",
    lang: "IT-EN",
    rating: 5,
    text: "Piu accurato di quello che mi aspettavo.",
  },
  {
    name: "Sven O.",
    lang: "EN",
    rating: 4,
    text: "Clean product. Pay per match works for me.",
  },
];

export function CommunityReviews() {
  return (
    <section className="border-t border-border/60 bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto px-4 py-16 sm:py-20">
        <div className="max-w-2xl mb-10">
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
            What early users are saying
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Honest, unfiltered feedback from beta users. No paid testimonials.
          </p>
        </div>

        <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {REVIEWS.map((r, i) => (
            <article
              key={i}
              className="mb-4 break-inside-avoid rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-sm hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <Star
                      key={idx}
                      className={
                        idx < r.rating
                          ? "h-3.5 w-3.5 fill-warning text-warning"
                          : "h-3.5 w-3.5 text-muted-foreground/30"
                      }
                    />
                  ))}
                </div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {r.lang}
                </span>
              </div>
              <Quote className="h-3.5 w-3.5 text-primary/50 mb-1.5" />
              <p className="text-sm leading-relaxed text-foreground/90">{r.text}</p>
              <div className="mt-3 text-xs">
                <span className="font-medium text-foreground/80">{r.name}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
