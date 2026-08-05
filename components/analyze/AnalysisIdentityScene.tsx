"use client";

// Replaces the old plain "Identified Product" card with a pinned, scrubbed
// intro scene: as the user scrolls the results page, this card briefly pins
// while its title -> tool-type chip -> motor chip -> price -> category
// detail reveal in sequence over a cinematic background, then releases and
// continues as a normal (fully-revealed) card for the rest of the scroll.
import { useRef } from "react";
import Image from "next/image";
import { gsap } from "gsap";
import { useScrollScene, pinnedScrubScene } from "@/lib/scroll-scenes";

interface AnalysisIdentitySceneProps {
  productName: string;
  category?: string;
  subcategory?: string;
  whatItIs?: string;
  confidence?: "high" | "medium" | "low";
  evidence?: { claim: string; url: string; quote: string }[];
  toolTypeLabel?: string | null;
  motorLabel?: string | null;
  priceLabel?: string | null;
}

export default function AnalysisIdentityScene({
  productName,
  category,
  subcategory,
  whatItIs,
  confidence,
  evidence,
  toolTypeLabel,
  motorLabel,
  priceLabel,
}: AnalysisIdentitySceneProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toolChipRef = useRef<HTMLSpanElement>(null);
  const motorChipRef = useRef<HTMLSpanElement>(null);
  const priceChipRef = useRef<HTMLSpanElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);

  const scopeRef = useScrollScene<HTMLDivElement>((ctx) => {
    const refs: (HTMLElement | null)[] = [
      titleRef.current,
      toolChipRef.current,
      motorChipRef.current,
      priceChipRef.current,
      detailRef.current,
    ];
    const els = refs.filter((el): el is HTMLElement => el !== null);

    gsap.set(els, { opacity: 0, y: 16 });
    gsap.set(bgRef.current, { scale: 1.15 });

    pinnedScrubScene(
      scopeRef.current,
      (tl) => {
        tl.to(bgRef.current, { scale: 1, ease: "none" }, 0);
        els.forEach((el, i) => {
          tl.to(el, { opacity: 1, y: 0, ease: "none" }, i * 0.18);
        });
      },
      ctx,
      { end: "+=90%" }
    );
  }, []);

  const confidenceClass =
    confidence === "high"
      ? "bg-success/15 border-success/30 text-success"
      : confidence === "medium"
      ? "bg-warning/15 border-warning/25 text-warning"
      : confidence === "low"
      ? "bg-danger/15 border-danger/30 text-danger"
      : "";

  return (
    <div ref={scopeRef} className="relative overflow-hidden rounded-2xl min-h-[360px] flex items-end">
      <div ref={bgRef} className="absolute inset-0">
        <Image src="/images/hero-3.jpg" alt="" fill sizes="100vw" className="object-cover" priority />
      </div>
      <div className="cinema-scrim" style={{ "--scrim-opacity": 0.68 } as React.CSSProperties} />

      <div className="relative z-10 w-full p-6 md:p-8 space-y-3">
        <p className="text-cinema-gold-text text-[10px] font-bold uppercase tracking-wider">Identified Product</p>
        <h2 ref={titleRef} className="text-2xl md:text-3xl font-display font-bold text-white leading-tight">
          {productName}
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          {toolTypeLabel && (
            <span
              ref={toolChipRef}
              className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/10 border border-white/20 text-white backdrop-blur-sm"
            >
              {toolTypeLabel}
            </span>
          )}
          {motorLabel && (
            <span
              ref={motorChipRef}
              className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/10 border border-white/20 text-white backdrop-blur-sm"
            >
              {motorLabel}
            </span>
          )}
          {priceLabel && (
            <span
              ref={priceChipRef}
              className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-cinema-gold/20 border border-cinema-gold/40 text-cinema-gold-text backdrop-blur-sm"
            >
              {priceLabel}
            </span>
          )}
        </div>

        {(category || whatItIs) && (
          <div ref={detailRef} className="cinema-glass rounded-xl p-4 space-y-1.5 max-w-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-white/60 uppercase tracking-wider">Category</span>
              {confidence && (
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${confidenceClass}`}>
                  {confidence} confidence
                </span>
              )}
            </div>
            <div className="text-xs text-white font-semibold">
              {category}
              {subcategory && subcategory !== category ? ` / ${subcategory}` : ""}
            </div>
            {whatItIs && <p className="text-[11px] text-white/80 leading-relaxed">{whatItIs}</p>}
            {Array.isArray(evidence) && evidence.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-0.5">
                {evidence.slice(0, 4).map((e, i) =>
                  e.url ? (
                    <a
                      key={i}
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-cinema-gold-text hover:underline"
                      title={e.claim}
                    >
                      evidence {i + 1}
                    </a>
                  ) : null
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
