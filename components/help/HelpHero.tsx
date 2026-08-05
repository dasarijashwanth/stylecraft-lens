// Static scrimmed backdrop behind the Help & Support title row only — the
// FAQ list/search below stays on the plain surface background for
// legibility, per the redesign's "data-dense areas stay imagery-free" rule.
// No scroll-linked motion here; this band is already fully visible on load.
import Image from "next/image";
import { HelpCircle } from "lucide-react";

export default function HelpHero() {
  return (
    <div className="relative rounded-2xl overflow-hidden p-6 md:p-8">
      <Image src="/images/hero-4.jpg" alt="" fill sizes="100vw" className="object-cover" priority />
      <div className="cinema-scrim" style={{ "--scrim-opacity": 0.65 } as React.CSSProperties} />
      <div className="relative z-10 flex items-center gap-2">
        <HelpCircle className="w-5 h-5 text-cinema-gold-text" />
        <h1 className="text-display text-white">Help &amp; Support</h1>
      </div>
    </div>
  );
}
