"use client";

// Muted looping background video for cinematic scroll surfaces (Login hero,
// loading-screen ambient backdrops). Always go through this component rather
// than a bare <video> tag — it's the one place that (a) respects
// prefers-reduced-motion by rendering the poster image instead of playing
// anything, and (b) pauses playback when off-screen or the tab is hidden, so
// a page with several of these never burns CPU/battery on video decode the
// user can't see.
import { useEffect, useRef, useState } from "react";
import Image from "next/image";

interface HeroVideoProps {
  srcMp4: string;
  srcWebm?: string;
  poster: string;
  posterAlt?: string;
  className?: string;
  /** Applied to both the <video> and the reduced-motion poster <Image> so callers style them identically. */
  mediaClassName?: string;
}

export default function HeroVideo({
  srcMp4,
  srcWebm,
  poster,
  posterAlt = "",
  className,
  mediaClassName,
}: HeroVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    let isIntersecting = false;

    const syncPlayback = () => {
      if (isIntersecting && document.visibilityState === "visible") {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        isIntersecting = entry.isIntersecting;
        syncPlayback();
      },
      { threshold: 0.01 }
    );
    observer.observe(container);
    document.addEventListener("visibilitychange", syncPlayback);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncPlayback);
    };
  }, [reducedMotion]);

  return (
    <div ref={containerRef} className={className}>
      {reducedMotion ? (
        <Image
          src={poster}
          alt={posterAlt}
          fill
          sizes="100vw"
          className={mediaClassName}
          priority
        />
      ) : (
        <video
          ref={videoRef}
          className={mediaClassName}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          poster={poster}
          aria-hidden="true"
        >
          {srcWebm && <source src={srcWebm} type="video/webm" />}
          <source src={srcMp4} type="video/mp4" />
        </video>
      )}
    </div>
  );
}
