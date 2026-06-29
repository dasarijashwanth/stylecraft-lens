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

    fetch(`/api/amazon/product?asin=${key}`)
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
