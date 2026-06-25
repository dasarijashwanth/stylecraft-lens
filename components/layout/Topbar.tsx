"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { 
  Bell, 
  Search, 
  Menu, 
  ChevronRight, 
  Command,
  Target,
  FolderOpen,
  FileText,
  User
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface TopbarProps {
  onMenuClick: () => void;
  onSearchClick: () => void;
}

export default function Topbar({ onMenuClick, onSearchClick }: TopbarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  
  const [notifications, setNotifications] = useState([
    { id: 1, text: "Apex Clipper Analysis completed", time: "5 min ago", read: false },
    { id: 2, text: "Wahl Professional details updated", time: "2 hours ago", read: true },
  ]);
  const [showNotifications, setShowNotifications] = useState(false);

  // Generate dynamic title and breadcrumbs
  const getBreadcrumbs = () => {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return { title: "Overview", crumbs: [] };

    // Capitalize helper
    const format = (str: string) => {
      if (str === "id" || str.startsWith("an_") || str.startsWith("comp_") || str.startsWith("proj_") || str.startsWith("rep_")) {
        return "Detail";
      }
      return str.charAt(0).toUpperCase() + str.slice(1).replace(/-/g, " ");
    };

    const title = format(segments[segments.length - 1]);
    const crumbs = segments.slice(0, -1).map((segment, index) => {
      const href = "/" + segments.slice(0, index + 1).join("/");
      return { label: format(segment), href };
    });

    return { title, crumbs };
  };

  const { title, crumbs } = getBreadcrumbs();
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-[60px] px-4 md:px-6 border-b border-border bg-bg/85 backdrop-blur-md">
      {/* Left: Menu Toggle + Breadcrumbs */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="p-1.5 rounded-lg hover:bg-surface-3 text-text-secondary lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="hidden sm:flex items-center gap-1.5 text-xs text-text-muted font-medium">
          <span className="hover:text-text-secondary cursor-pointer">Dashboard</span>
          {crumbs.map((crumb) => (
            <div key={crumb.href} className="flex items-center gap-1.5">
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="hover:text-text-secondary cursor-pointer">{crumb.label}</span>
            </div>
          ))}
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-accent-text">{title}</span>
        </div>
        <h1 className="text-base font-bold text-text-primary sm:hidden">
          {title}
        </h1>
      </div>

      {/* Center: Search Trigger Button */}
      <div className="flex-1 max-w-md mx-6 hidden md:block">
        <button
          onClick={onSearchClick}
          className="flex items-center justify-between w-full px-3 py-1.5 text-sm text-text-muted border border-border rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-text-muted" />
            <span>Search competitors, projects, reports...</span>
          </div>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border border-border-strong bg-surface-1">
            <Command className="w-2.5 h-2.5" />
            <span>K</span>
          </div>
        </button>
      </div>

      {/* Right: Search (mobile) + Notifications + User Avatar */}
      <div className="flex items-center gap-3">
        <button
          onClick={onSearchClick}
          className="p-2 rounded-lg hover:bg-surface-3 text-text-secondary md:hidden"
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Notifications Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 rounded-lg hover:bg-surface-3 text-text-secondary relative transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-danger animate-pulse-soft" />
            )}
          </button>

          {showNotifications && (
            <>
              <div 
                className="fixed inset-0 z-30" 
                onClick={() => setShowNotifications(false)}
              />
              <div className="absolute right-0 mt-2 w-[280px] z-40 border border-border rounded-xl bg-surface-2 p-2 shadow-xl">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60">
                  <span className="text-xs font-bold text-text-primary">Notifications</span>
                  {unreadCount > 0 && (
                    <button 
                      onClick={() => setNotifications(notifications.map(n => ({ ...n, read: true })))}
                      className="text-[10px] text-accent hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="mt-1.5 max-h-[220px] overflow-y-auto space-y-1">
                  {notifications.map((n) => (
                    <div 
                      key={n.id} 
                      className={`p-2 rounded-lg text-xs leading-normal transition-colors cursor-pointer ${
                        n.read ? "hover:bg-surface-3/50 text-text-secondary" : "bg-accent-bg/40 text-text-primary hover:bg-accent-bg/60"
                      }`}
                    >
                      <p>{n.text}</p>
                      <span className="text-[10px] text-text-muted mt-1 block">{n.time}</span>
                    </div>
                  ))}
                  {notifications.length === 0 && (
                    <p className="p-3 text-xs text-text-muted text-center">No new notifications</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Profile Avatar */}
        {user && (
          <div className="flex items-center gap-2 pl-2 border-l border-border/80">
            <img
              src={user.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&h=100"}
              alt={user.name}
              className="w-7 h-7 rounded-full object-cover border border-border-strong hover:scale-105 transition-transform"
            />
          </div>
        )}
      </div>
    </header>
  );
}
