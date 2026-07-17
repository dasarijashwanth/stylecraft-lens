// Shared brand mark — was previously duplicated as inline SVG across
// app/page.tsx, components/layout/Sidebar.tsx, and app/(auth)/sign-in/page.tsx
// with inconsistent sizing at each site. One component, size variants.
const WRAPPER_SIZES = {
  sm: "w-8 h-8 rounded-lg",
  md: "w-10 h-10 rounded-xl",
  lg: "w-14 h-14 rounded-2xl",
  xl: "w-20 h-20 rounded-[28px]",
} as const;

const ICON_SIZES = {
  sm: "w-5 h-5",
  md: "w-6 h-6",
  lg: "w-8 h-8",
  xl: "w-11 h-11",
} as const;

export type LogoSize = keyof typeof WRAPPER_SIZES;

export function Logo({ size = "sm", className = "" }: { size?: LogoSize; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center shrink-0 bg-accent text-white shadow shadow-accent/30 ${WRAPPER_SIZES[size]} ${className}`}
    >
      <svg className={ICON_SIZES[size]} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <circle cx="12" cy="12" r="5" strokeWidth="2.5" />
        <path strokeLinecap="round" strokeWidth="2.5" d="M12 2v2M12 20v2M2 12h2M20 12h2" />
      </svg>
    </div>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center font-black tracking-wider leading-none ${className}`}>
      <span>STYLECRAFT</span>
      <span className="text-accent ml-1">LENS</span>
    </div>
  );
}
