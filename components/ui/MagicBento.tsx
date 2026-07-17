"use client";

// Adapted from React Bits' MagicBento. The source is a fixed 6-card
// showcase grid with hardcoded title/description content and its own
// gsap-driven particle/tilt/magnetism/spotlight/ripple effects; here that
// effect layer is generalized into two reusable pieces so it can wrap
// whatever REAL content (forms, tables, editable fields) already exists in
// each tab across this app, instead of replacing it:
//   <MagicBentoSection>          — grid/spotlight scope (one per tab panel)
//     <MagicBentoCard>...</MagicBentoCard>   — one interactive card, real children
//   </MagicBentoSection>
// The interaction logic (spotlight proximity, particle bursts, tilt,
// magnetism, click ripple) is kept as close to source as practical.
import { useRef, useEffect, useCallback, useState, type ReactNode } from "react";
import { gsap } from "gsap";
import "./MagicBento.css";

const DEFAULT_PARTICLE_COUNT = 8;
const DEFAULT_SPOTLIGHT_RADIUS = 260;
const DEFAULT_GLOW_COLOR = "99, 102, 241"; // this app's accent, as an RGB triple
const MOBILE_BREAKPOINT = 768;

function useMobileDetection() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

function createParticleElement(x: number, y: number, color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "particle";
  el.style.cssText = `
    position: absolute; width: 4px; height: 4px; border-radius: 50%;
    background: rgba(${color}, 1); box-shadow: 0 0 6px rgba(${color}, 0.6);
    pointer-events: none; z-index: 100; left: ${x}px; top: ${y}px;
  `;
  return el;
}

function calculateSpotlightValues(radius: number) {
  return { proximity: radius * 0.5, fadeDistance: radius * 0.75 };
}

function updateCardGlowProperties(card: HTMLElement, mouseX: number, mouseY: number, glow: number, radius: number) {
  const rect = card.getBoundingClientRect();
  const relativeX = ((mouseX - rect.left) / rect.width) * 100;
  const relativeY = ((mouseY - rect.top) / rect.height) * 100;
  card.style.setProperty("--glow-x", `${relativeX}%`);
  card.style.setProperty("--glow-y", `${relativeY}%`);
  card.style.setProperty("--glow-intensity", glow.toString());
  card.style.setProperty("--glow-radius", `${radius}px`);
}

export interface MagicBentoCardProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  glowColor?: string;
  enableStars?: boolean;
  enableBorderGlow?: boolean;
  enableTilt?: boolean;
  enableMagnetism?: boolean;
  clickEffect?: boolean;
  particleCount?: number;
  disableAnimations?: boolean;
  onClick?: () => void;
}

export function MagicBentoCard({
  children,
  className = "",
  style,
  glowColor = DEFAULT_GLOW_COLOR,
  enableStars = true,
  enableBorderGlow = true,
  enableTilt = false,
  enableMagnetism = false,
  clickEffect = true,
  particleCount = DEFAULT_PARTICLE_COUNT,
  disableAnimations = false,
  onClick,
}: MagicBentoCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isHoveredRef = useRef(false);
  const memoizedParticles = useRef<HTMLDivElement[]>([]);
  const particlesInitialized = useRef(false);
  const magnetismAnimRef = useRef<gsap.core.Tween | null>(null);
  const isMobile = useMobileDetection();
  const shouldDisableAnimations = disableAnimations || isMobile;

  const initializeParticles = useCallback(() => {
    if (particlesInitialized.current || !cardRef.current) return;
    const { width, height } = cardRef.current.getBoundingClientRect();
    memoizedParticles.current = Array.from({ length: particleCount }, () =>
      createParticleElement(Math.random() * width, Math.random() * height, glowColor)
    );
    particlesInitialized.current = true;
  }, [particleCount, glowColor]);

  const clearAllParticles = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    magnetismAnimRef.current?.kill();
    particlesRef.current.forEach((particle) => {
      gsap.to(particle, {
        scale: 0,
        opacity: 0,
        duration: 0.3,
        ease: "back.in(1.7)",
        onComplete: () => particle.parentNode?.removeChild(particle),
      });
    });
    particlesRef.current = [];
  }, []);

  const animateParticles = useCallback(() => {
    if (!cardRef.current || !isHoveredRef.current) return;
    if (!particlesInitialized.current) initializeParticles();

    memoizedParticles.current.forEach((particle, index) => {
      const timeoutId = setTimeout(() => {
        if (!isHoveredRef.current || !cardRef.current) return;
        const clone = particle.cloneNode(true) as HTMLDivElement;
        cardRef.current.appendChild(clone);
        particlesRef.current.push(clone);

        gsap.fromTo(clone, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(1.7)" });
        gsap.to(clone, {
          x: (Math.random() - 0.5) * 80,
          y: (Math.random() - 0.5) * 80,
          rotation: Math.random() * 360,
          duration: 2 + Math.random() * 2,
          ease: "none",
          repeat: -1,
          yoyo: true,
        });
        gsap.to(clone, { opacity: 0.3, duration: 1.5, ease: "power2.inOut", repeat: -1, yoyo: true });
      }, index * 100);
      timeoutsRef.current.push(timeoutId);
    });
  }, [initializeParticles]);

  useEffect(() => {
    if (shouldDisableAnimations || !cardRef.current) return;
    const element = cardRef.current;

    const handleMouseEnter = () => {
      isHoveredRef.current = true;
      if (enableStars) animateParticles();
      if (enableTilt) gsap.to(element, { rotateX: 4, rotateY: 4, duration: 0.3, ease: "power2.out", transformPerspective: 1000 });
    };
    const handleMouseLeave = () => {
      isHoveredRef.current = false;
      if (enableStars) clearAllParticles();
      if (enableTilt) gsap.to(element, { rotateX: 0, rotateY: 0, duration: 0.3, ease: "power2.out" });
      if (enableMagnetism) gsap.to(element, { x: 0, y: 0, duration: 0.3, ease: "power2.out" });
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!enableTilt && !enableMagnetism) return;
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      if (enableTilt) {
        gsap.to(element, {
          rotateX: ((y - centerY) / centerY) * -8,
          rotateY: ((x - centerX) / centerX) * 8,
          duration: 0.1,
          ease: "power2.out",
          transformPerspective: 1000,
        });
      }
      if (enableMagnetism) {
        magnetismAnimRef.current = gsap.to(element, {
          x: (x - centerX) * 0.04,
          y: (y - centerY) * 0.04,
          duration: 0.3,
          ease: "power2.out",
        });
      }
    };
    const handleClick = (e: MouseEvent) => {
      if (!clickEffect) return;
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const maxDistance = Math.max(Math.hypot(x, y), Math.hypot(x - rect.width, y), Math.hypot(x, y - rect.height), Math.hypot(x - rect.width, y - rect.height));
      const ripple = document.createElement("div");
      ripple.style.cssText = `
        position: absolute; width: ${maxDistance * 2}px; height: ${maxDistance * 2}px; border-radius: 50%;
        background: radial-gradient(circle, rgba(${glowColor}, 0.4) 0%, rgba(${glowColor}, 0.2) 30%, transparent 70%);
        left: ${x - maxDistance}px; top: ${y - maxDistance}px; pointer-events: none; z-index: 1000;
      `;
      element.appendChild(ripple);
      gsap.fromTo(ripple, { scale: 0, opacity: 1 }, { scale: 1, opacity: 0, duration: 0.8, ease: "power2.out", onComplete: () => ripple.remove() });
    };

    element.addEventListener("mouseenter", handleMouseEnter);
    element.addEventListener("mouseleave", handleMouseLeave);
    element.addEventListener("mousemove", handleMouseMove);
    element.addEventListener("click", handleClick);
    return () => {
      isHoveredRef.current = false;
      element.removeEventListener("mouseenter", handleMouseEnter);
      element.removeEventListener("mouseleave", handleMouseLeave);
      element.removeEventListener("mousemove", handleMouseMove);
      element.removeEventListener("click", handleClick);
      clearAllParticles();
    };
  }, [shouldDisableAnimations, enableStars, enableTilt, enableMagnetism, clickEffect, glowColor, animateParticles, clearAllParticles]);

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      className={`magic-bento-card ${enableBorderGlow ? "magic-bento-card--border-glow" : ""} ${enableStars ? "magic-bento-card--particle-container" : ""} ${className}`}
      style={{ ...style, ["--glow-color" as string]: glowColor }}
    >
      {children}
    </div>
  );
}

export function MagicBentoSection({
  children,
  className = "",
  enableSpotlight = true,
  spotlightRadius = DEFAULT_SPOTLIGHT_RADIUS,
  glowColor = DEFAULT_GLOW_COLOR,
}: {
  children: ReactNode;
  className?: string;
  enableSpotlight?: boolean;
  spotlightRadius?: number;
  glowColor?: string;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const spotlightElRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useMobileDetection();

  useEffect(() => {
    if (!enableSpotlight || isMobile || !gridRef.current) return;
    const sectionEl = gridRef.current;

    const spotlight = document.createElement("div");
    spotlight.className = "global-spotlight";
    spotlight.style.cssText = `
      position: fixed; width: 700px; height: 700px; border-radius: 50%; pointer-events: none;
      background: radial-gradient(circle, rgba(${glowColor}, 0.15) 0%, rgba(${glowColor}, 0.08) 15%, rgba(${glowColor}, 0.04) 25%, rgba(${glowColor}, 0.02) 40%, transparent 70%);
      z-index: 200; opacity: 0; transform: translate(-50%, -50%); mix-blend-mode: screen;
    `;
    document.body.appendChild(spotlight);
    spotlightElRef.current = spotlight;

    const handleMouseMove = (e: MouseEvent) => {
      if (!spotlightElRef.current) return;
      const rect = sectionEl.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      const cards = sectionEl.querySelectorAll<HTMLElement>(".magic-bento-card");

      if (!inside) {
        gsap.to(spotlightElRef.current, { opacity: 0, duration: 0.3, ease: "power2.out" });
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"));
        return;
      }

      const { proximity, fadeDistance } = calculateSpotlightValues(spotlightRadius);
      let minDistance = Infinity;
      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect();
        const centerX = cardRect.left + cardRect.width / 2;
        const centerY = cardRect.top + cardRect.height / 2;
        const distance = Math.max(0, Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2);
        minDistance = Math.min(minDistance, distance);
        const glow = distance <= proximity ? 1 : distance <= fadeDistance ? (fadeDistance - distance) / (fadeDistance - proximity) : 0;
        updateCardGlowProperties(card, e.clientX, e.clientY, glow, spotlightRadius);
      });

      gsap.to(spotlightElRef.current, { left: e.clientX, top: e.clientY, duration: 0.1, ease: "power2.out" });
      const targetOpacity = minDistance <= proximity ? 0.8 : minDistance <= fadeDistance ? ((fadeDistance - minDistance) / (fadeDistance - proximity)) * 0.8 : 0;
      gsap.to(spotlightElRef.current, { opacity: targetOpacity, duration: targetOpacity > 0 ? 0.2 : 0.5, ease: "power2.out" });
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      spotlightElRef.current?.parentNode?.removeChild(spotlightElRef.current);
    };
  }, [enableSpotlight, isMobile, spotlightRadius, glowColor]);

  return (
    <div className={`magic-bento-section ${className}`} ref={gridRef}>
      {children}
    </div>
  );
}
