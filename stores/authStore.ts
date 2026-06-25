import { create } from "zustand";

export interface UserSession {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  avatarUrl: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  plan: "FREE" | "PRO" | "AGENCY" | "ENTERPRISE";
}

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
    // For mock, just clear user and redirect.
    // For Clerk, we can redirect to sign out endpoint or sign out locally.
    set({ user: null });
    window.location.href = "/sign-in";
  }
}));
