"use client";

import { SignUp } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
const hasClerkKeys =
  typeof window !== "undefined" &&
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_..." &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "";

export default function SignUpPage() {
  const router = useRouter();

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg text-text-primary px-4">
      {hasClerkKeys ? (
        <SignUp routing="hash" />
      ) : (
        <div className="w-full max-w-sm p-6 text-center space-y-4 bg-surface-2 border border-border rounded-xl">
          <h1 className="text-lg font-bold text-text-primary">Create an account</h1>
          <p className="text-xs text-text-muted">
            In developer mode, registration is skipped. Click below to continue as a developer.
          </p>
          <button
            onClick={() => router.push("/sign-in")}
            className="w-full py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg transition-colors"
          >
            Go to developer login
          </button>
        </div>
      )}
    </div>
  );
}
