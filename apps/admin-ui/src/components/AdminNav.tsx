import { type RealtimeConnectionState } from "@cuecommx/core";
import { LayoutDashboard, Layers, Lock, Radio, Settings2, Users } from "lucide-react";
import { type AuthSuccessResponse } from "@cuecommx/protocol";

import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { type AdminPage } from "../App.js";

interface AdminNavProps {
  currentPage: AdminPage;
  onNavigate: (page: AdminPage) => void;
  session?: AuthSuccessResponse;
  onSignOut: () => void;
  adminRealtimeState: RealtimeConnectionState;
}

interface NavItem {
  page: AdminPage;
  label: string;
  icon: React.ReactNode;
  requiresSession: boolean;
}

const navItems: NavItem[] = [
  { page: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, requiresSession: false },
  { page: "users", label: "Users", icon: <Users className="h-4 w-4" />, requiresSession: true },
  { page: "channels", label: "Channels", icon: <Radio className="h-4 w-4" />, requiresSession: false },
  { page: "groups", label: "Groups", icon: <Layers className="h-4 w-4" />, requiresSession: true },
  { page: "integrations", label: "Integrations", icon: <Settings2 className="h-4 w-4" />, requiresSession: true },
];

export function AdminNav({
  currentPage,
  onNavigate,
  session,
  onSignOut,
  adminRealtimeState,
}: AdminNavProps) {
  return (
    <nav className="w-56 bg-card border-r border-border flex flex-col min-h-screen">
      <div className="p-4 border-b border-border">
        <p className="text-sm font-semibold text-foreground">CueCommX</p>
        <p className="text-xs text-muted-foreground">Admin</p>
      </div>

      <div className="flex-1 py-2">
        {navItems.map((item) => {
          const isActive = currentPage === item.page;
          const locked = item.requiresSession && !session;

          if (locked) {
            return (
              <div
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground/50 cursor-not-allowed"
                key={item.page}
                title="Sign in as admin to access this page"
              >
                {item.icon}
                <span>{item.label}</span>
                <Lock className="ml-auto h-3 w-3" />
              </div>
            );
          }

          return (
            <button
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              key={item.page}
              onClick={() => onNavigate(item.page)}
              type="button"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {session ? (
        <div className="border-t border-border p-4 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground truncate">{session.user.username}</p>
            <div className="flex items-center gap-2">
              <Badge variant="accent">{session.user.role}</Badge>
              <Badge variant={adminRealtimeState === "connected" ? "success" : "warning"}>
                {adminRealtimeState === "connected" ? "Live" : "Reconnecting"}
              </Badge>
            </div>
          </div>
          <Button
            className="w-full justify-center"
            onClick={onSignOut}
            size="sm"
            type="button"
            variant="outline"
          >
            Sign Out
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
