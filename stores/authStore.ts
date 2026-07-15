import { create } from "zustand";
import type { UserSession } from "@/lib/auth";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export type { UserSession };

interface AuthState {
  user: UserSession | null;
  loading: boolean;
  error: string | null;
  fetchSession: () => Promise<UserSession | null>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,
  fetchSession: async () => {
    try {
      set({ loading: true });
      const res = await fetch("/api/auth/session");
      if (!res.ok) throw new Error("Failed to fetch session");
      const data = await res.json();
      set({ user: data.user, loading: false, error: null });
      return data.user;
    } catch (e: any) {
      set({ user: null, loading: false, error: e.message });
      return null;
    }
  },
  logout: async () => {
    try {
      await createSupabaseBrowserClient().auth.signOut();
    } catch (e) {
      // Best-effort — still clear local state and redirect even if the
      // sign-out call itself fails (e.g. Supabase not configured locally).
    }
    set({ user: null });
    window.location.href = "/sign-in";
  }
}));
