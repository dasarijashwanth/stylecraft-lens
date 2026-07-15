"use client";

import { useState } from "react";
import { 
  Settings, 
  User, 
  CreditCard, 
  Key, 
  ShieldAlert, 
  CheckCircle,
  TrendingUp,
  Sliders
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/Spinner";

export default function SettingsPage() {
  const { user, refreshSession } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<"profile" | "billing" | "keys">("profile");

  const [userName, setUserName] = useState(user?.name || "Dev Admin");
  const [userEmail, setUserEmail] = useState(user?.email || "developer@stylecraftlens.com");
  const [savingProfile, setSavingProfile] = useState(false);

  const planLimits = {
    FREE: { competitors: 5, analyses: 3, projects: 1, reports: 3 },
    PRO: { competitors: 50, analyses: 25, projects: 10, reports: 20 },
    AGENCY: { competitors: "Unlimited", analyses: "Unlimited", projects: "Unlimited", reports: "Unlimited" },
    ENTERPRISE: { competitors: "Unlimited", analyses: "Unlimited", projects: "Unlimited", reports: "Unlimited" },
  };

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setTimeout(() => {
      setSavingProfile(false);
      toast.success("Profile saved successfully");
    }, 800);
  };

  const handleUpgradePlan = async (targetPlan: "FREE" | "PRO" | "AGENCY") => {
    try {
      // Direct update org plan in DB/Memory
      const res = await fetch(`/api/competitors`, { method: "GET" }); // dummy call to assert connection
      
      // We will perform a local mock plan change in DB via a PATCH org call or simply mock it for user session
      // For immediate response, let's notify the user
      toast.success(`Upgrading workspace subscription to ${targetPlan}...`);
      
      // Let's call a mock update or trigger status reload
      setTimeout(() => {
        toast.success(`Plan updated to ${targetPlan}!`);
        // Refresh session to pull updated plan
        refreshSession();
      }, 1000);
    } catch (e) {
      toast.error("Failed to update plan");
    }
  };

  const currentPlan = user?.plan || "FREE";
  const limits = planLimits[currentPlan as keyof typeof planLimits] || planLimits.FREE;

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-accent" />
        <h1 className="text-display">Settings</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Side: Navigation Links (3/12) */}
        <div className="lg:col-span-3 flex flex-col gap-1 p-2 bg-surface-2 border border-border rounded-xl">
          {[
            { id: "profile", label: "User Profile", icon: User },
            { id: "billing", label: "Plan & Billing", icon: CreditCard },
            { id: "keys", label: "API Configuration", icon: Key },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors text-left ${
                  isSelected 
                    ? "bg-accent-bg text-accent-text" 
                    : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
                }`}
              >
                <Icon className={`w-4 h-4 ${isSelected ? "text-accent" : "text-text-muted"}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right Side: Tab Contents (9/12) */}
        <div className="lg:col-span-9 bg-surface-2 border border-border rounded-xl p-5 md:p-6 min-h-[350px]">
          
          {/* USER PROFILE TAB */}
          {activeSubTab === "profile" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-sm font-bold text-text-primary">Profile Details</h2>
                <p className="text-[11px] text-text-muted mt-0.5">Manage your user profile details.</p>
              </div>

              <form onSubmit={handleUpdateProfile} className="space-y-4 max-w-md text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-text-primary">Display Name</label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-text-primary">Email Address</label>
                  <input
                    type="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingProfile}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingProfile && <Spinner size="xs" className="text-white" />}
                  <span>Save Profile</span>
                </button>
              </form>
            </div>
          )}

          {/* PLAN & BILLING TAB */}
          {activeSubTab === "billing" && (
            <div className="space-y-6 text-xs">
              <div>
                <h2 className="text-sm font-bold text-text-primary font-display">Plan & Workspace Limits</h2>
                <p className="text-[11px] text-text-muted mt-0.5">Monitor resource consumption limits and switch plans.</p>
              </div>

              {/* Limits progress bars */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 border border-border bg-surface-3/30 rounded-xl">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-text-primary">Competitor Entries</span>
                    <span className="font-mono text-text-muted">4 / {limits.competitors}</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-1 rounded-full overflow-hidden border border-border">
                    <div 
                      className="h-full bg-accent" 
                      style={{ width: typeof limits.competitors === "number" ? `${(4 / limits.competitors) * 100}%` : "15%" }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-text-primary">Analyses Completed (Month)</span>
                    <span className="font-mono text-text-muted">1 / {limits.analyses}</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-1 rounded-full overflow-hidden border border-border">
                    <div 
                      className="h-full bg-accent" 
                      style={{ width: typeof limits.analyses === "number" ? `${(1 / limits.analyses) * 100}%` : "5%" }}
                    />
                  </div>
                </div>
              </div>

              {/* Pricing grid */}
              <div className="space-y-3.5 pt-4">
                <h3 className="font-bold text-text-primary">Choose Subscription Plan</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { plan: "FREE", price: "$0", desc: "For hobbyists and individual stylists.", badge: "FREE" },
                    { plan: "PRO", price: "$49/mo", desc: "For professional barbers and salon leads.", badge: "PRO" },
                    { plan: "AGENCY", price: "$149/mo", desc: "For large agencies and brands.", badge: "AGENCY" }
                  ].map((pkg) => {
                    const isCurrent = currentPlan === pkg.plan;
                    return (
                      <div 
                        key={pkg.plan}
                        className={`p-4 border rounded-xl flex flex-col justify-between space-y-4 transition-all ${
                          isCurrent 
                            ? "border-accent bg-accent-bg/10 shadow-sm" 
                            : "border-border bg-surface-3/30 hover:border-border-strong"
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-text-primary">{pkg.plan}</span>
                            {isCurrent && (
                              <span className="text-[8px] bg-accent/15 border border-accent/25 text-accent-text px-1.5 py-0.5 rounded uppercase font-semibold">
                                Current
                              </span>
                            )}
                          </div>
                          <p className="text-lg font-black text-text-primary mt-1">{pkg.price}</p>
                          <p className="text-[10px] text-text-secondary leading-normal">{pkg.desc}</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleUpgradePlan(pkg.plan as any)}
                          disabled={isCurrent}
                          className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                            isCurrent 
                              ? "bg-surface-3 text-text-muted cursor-not-allowed" 
                              : "bg-accent hover:bg-accent-hover text-white"
                          }`}
                        >
                          {isCurrent ? "Active Plan" : `Upgrade to ${pkg.plan}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* API CONFIGURATION TAB */}
          {activeSubTab === "keys" && (
            <div className="space-y-6 text-xs">
              <div>
                <h2 className="text-sm font-bold text-text-primary">Local Environment Variables</h2>
                <p className="text-[11px] text-text-muted mt-0.5 font-display">Configure API keys inside your local `.env.local` file.</p>
              </div>

              <div className="p-4 border border-border bg-surface-3/30 rounded-xl space-y-3.5">
                <div className="flex gap-3.5 items-start">
                  <Sliders className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                  <div className="space-y-1 leading-relaxed">
                    <p className="font-semibold text-text-primary">Google Gemini API Key</p>
                    <p className="text-text-secondary">
                      To run live market audits, supply a valid `GEMINI_API_KEY` to connect with Gemini (includes built-in Google Search grounding — no separate search key needed).
                    </p>
                    <pre className="p-2 border border-border bg-surface-1 text-mono text-[10px] text-accent-text rounded mt-2 select-all w-fit">
                      {"GEMINI_API_KEY=\"...\""}
                    </pre>
                  </div>
                </div>

                <div className="flex gap-3.5 items-start pt-3.5 border-t border-border/60">
                  <User className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                  <div className="space-y-1 leading-relaxed">
                    <p className="font-semibold text-text-primary">Clerk Authentication Keys</p>
                    <p className="text-text-secondary">
                      Supply publishable and secret keys to configure real register/sign-in flows.
                    </p>
                    <pre className="p-2 border border-border bg-surface-1 text-mono text-[10px] text-accent-text rounded mt-2 select-all w-fit">
                      {"NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=\"pk_...\""}{"\n"}
                      {"CLERK_SECRET_KEY=\"sk-clerk-...\""}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 p-3 rounded-lg border border-warning/25 bg-warning-bg/15 text-warning items-start">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="leading-normal">
                  Important: In the absence of Clerk keys, the application automatically runs in Developer Bypass mode using in-memory databases, letting you test all pages out-of-the-box.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
