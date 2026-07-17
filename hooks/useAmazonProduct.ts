"use client";

import { useState, useEffect } from "react";

export interface AmazonData {
  price:        string;
  price_raw:    number | null;
  rating:       number | null;
  rating_str:   string;
  reviews_str:  string;
  monthly_str:  string | null;
  bsr:          string | null;
  image:        string | null;
  amazon_url:   string;
  in_stock:     boolean;
  last_updated: string;

  // Widened fields — mirrors the curated (non-heavy) subset the
  // /api/amazon/product/[asin] route now returns.
  title?:            string;
  brand?:            string | null;
  manufacturer?:     string | null;
  model_number?:     string | null;
  description?:      string | null;
  images?:           string[];
  feature_bullets?:  string[];
  rating_breakdown?: { five_star?: number; four_star?: number; three_star?: number; two_star?: number; one_star?: number } | null;
}

interface UseAmazonProductResult {
  data:    AmazonData | null;
  loading: boolean;
  error:   string | null;
}

// Cache results in memory for the session (avoid duplicate calls)
const cache: Record<string, AmazonData> = {};

export function useAmazonProduct(asin: string | undefined | null): UseAmazonProductResult {
  const [data,    setData]    = useState<AmazonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
      setData(null);
      return;
    }

    const key = asin.toUpperCase();

    // Return cached data immediately if available
    if (cache[key]) {
      setData(cache[key]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/amazon/product/${key}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.error) {
          setError(d.error);
        } else {
          cache[key] = d;
          setData(d);
        }
      })
      .catch(e => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [asin]);

  return { data, loading, error };
}
