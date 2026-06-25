import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";

export function useAuth() {
  const { user, loading, error, fetchSession, logout } = useAuthStore();

  useEffect(() => {
    if (!user && loading) {
      fetchSession();
    }
  }, [user, loading, fetchSession]);

  return {
    user,
    loading,
    error,
    isSignedIn: !!user,
    logout,
    refreshSession: fetchSession,
  };
}
