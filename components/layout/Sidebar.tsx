"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Target, 
  FolderOpen, 
  Sparkles, 
  FileText, 
  Settings, 
  HelpCircle, 
  LogOut,
  Menu,
  X
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export default function Sidebar({ isOpen, setIsOpen }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const navItems = [
    { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
    { label: "Competitors", href: "/dashboard/competitors", icon: Target },
    { label: "Projects", href: "/dashboard/projects", icon: FolderOpen },
    { label: "Analyze", href: "/dashboard/analyze", icon: Sparkles },
    { label: "Reports", href: "/dashboard/reports", icon: FileText },
  ];

  const subItems = [
    { label: "Settings", href: "/dashboard/settings", icon: Settings },
    { label: "Help", href: "/dashboard/help", icon: HelpCircle },
  ];

  const planTones: Record<string, BadgeTone> = {
    FREE: "neutral",
    PRO: "accent",
    AGENCY: "success",
    ENTERPRISE: "warning",
  };

  const currentPlan = user?.plan || "FREE";

  const renderNavLinks = (items: typeof navItems) => {
    return items.map((item) => {
      const isActive = item.href === "/dashboard"
        ? pathname === "/dashboard"
        : pathname === item.href || pathname.startsWith(item.href + "/");
      const Icon = item.icon;
      
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setIsOpen(false)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative ${
            isActive
              ? "bg-accent-bg text-accent-text border-l-2 border-accent rounded-l-none"
              : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          }`}
        >
          <Icon className={`w-4 h-4 transition-transform duration-200 group-hover:scale-110 ${
            isActive ? "text-accent" : "text-text-muted group-hover:text-text-secondary"
          }`} />
          <span>{item.label}</span>
          {isActive && (
            <span className="absolute right-2 w-1 h-1 rounded-full bg-accent" />
          )}
        </Link>
      );
    });
  };

  return (
    <>
      {/* Mobile Sidebar Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col w-[var(--sidebar-width)] border-r border-border bg-surface-1 transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo Section */}
        <div className="flex items-center justify-between h-[var(--topbar-height)] px-4 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent text-white font-bold shadow-md shadow-accent/20">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <circle cx="12" cy="12" r="5" strokeWidth="2.5" />
                <path strokeLinecap="round" strokeWidth="2.5" d="M12 2v2M12 20v2M2 12h2M20 12h2" />
              </svg>
            </div>
            <div>
              <div className="flex items-center text-sm font-black tracking-wider leading-none">
                <span>STYLECRAFT</span>
                <span className="text-accent ml-1">LENS</span>
              </div>
              <span className="text-[9px] text-text-muted tracking-tight font-medium">Competitive Intelligence</span>
            </div>
          </Link>
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
            className="p-1 rounded-lg hover:bg-surface-3 text-text-secondary lg:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Section */}
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
          {renderNavLinks(navItems)}
          
          <div className="my-4 border-t border-border/60" />
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Support</p>
          
          {renderNavLinks(subItems)}
        </nav>

        {/* User / Plan Section at Bottom */}
        <div className="p-4 border-t border-border bg-surface-2/40 space-y-3">
          {/* Plan Badge */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">Subscription</span>
            <Badge tone={planTones[currentPlan] ?? "neutral"} uppercase className="rounded-full">
              {currentPlan}
            </Badge>
          </div>

          {/* User Profile Summary */}
          {user && (
            <div className="flex items-center gap-2.5 p-1 rounded-lg">
              <img
                src={user.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150"}
                alt={user.name}
                className="w-8 h-8 rounded-full object-cover border border-border-strong"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-text-primary truncate">{user.name}</p>
                <p className="text-[10px] text-text-muted truncate">{user.email}</p>
              </div>
              <button 
                onClick={logout}
                title="Log out"
                className="p-1.5 rounded-md hover:bg-surface-3 text-text-muted hover:text-danger transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
