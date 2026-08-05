"use client";

// Decorative hero band above the Dashboard's title/KPI row — cinematic
// surface only. The KPI grid and everything below it stays on the plain
// surface background, imagery-free, per the redesign's "data-dense areas
// get no background imagery" rule.
import { useRef } from "react";
import Image from "next/image";
import { useScrollScene, parallaxLayer } from "@/lib/scroll-scenes";

export default function DashboardHero() {
  const bgRef = useRef<HTMLDivElement>(null);
  const scopeRef = useScrollScene<HTMLDivElement>((ctx) => {
    parallaxLayer(bgRef.current, ctx, { speed: 0.4 });
  }, []);

  return (
    <section
      ref={scopeRef}
      className="relative h-[30vh] min-h-[200px] max-h-[320px] rounded-2xl overflow-hidden"
    >
      <div ref={bgRef} className="absolute inset-0 scale-125">
        <Image
          src="/images/hero-1.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
      </div>
      <div className="cinema-scrim" style={{ "--scrim-opacity": 0.6 } as React.CSSProperties} />
      {/* Bottom seam — the band visually "sinks" into the surface background
          it sits on, rather than cutting off with a hard edge. */}
      <div
        className="absolute inset-x-0 bottom-0 h-16"
        style={{ background: "linear-gradient(to bottom, transparent, var(--bg))" }}
      />
      <div className="absolute inset-0 flex items-end p-6">
        <div>
          <p className="text-cinema-gold-text text-[11px] font-bold uppercase tracking-wider mb-1">
            Welcome back
          </p>
          <h2 className="text-2xl md:text-3xl font-display font-bold text-white">
            Your competitive intelligence, at a glance
          </h2>
        </div>
      </div>
    </section>
  );
}
