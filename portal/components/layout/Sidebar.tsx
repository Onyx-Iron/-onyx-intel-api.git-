"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  BookOpen,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Users,
  X,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}

const WORKSPACE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: <LayoutDashboard size={15} />, exact: true },
  { href: "/dashboard/projects", label: "Projects", icon: <FolderKanban size={15} /> },
  { href: "/dashboard/documents", label: "Documents", icon: <FileText size={15} /> },
  { href: "/dashboard/contacts", label: "Contacts", icon: <Users size={15} /> },
  { href: "/dashboard/price-book", label: "Price Book", icon: <BookOpen size={15} /> },
];

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? "bg-white/5 text-white"
          : "text-white/40 hover:bg-white/4 hover:text-white/80"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-[#CCFF00]" />
      )}
      <span className={`transition-colors ${active ? "text-[#CCFF00]" : "text-white/25 group-hover:text-white/55"}`}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="h-5" />

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          <p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-white/25">Workspace</p>
          {WORKSPACE_NAV.map((item) => (
            <NavLink key={item.label} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      </nav>

      <div className="border-t border-white/5 p-4">
        <div className="flex items-center gap-3">
          <UserButton />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-white/70">My Workspace</p>
            <p className="truncate text-[9px] uppercase tracking-[0.15em] text-white/30">Onyx &amp; Iron</p>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-white/5 bg-[#06070A] lg:flex">
      <SidebarContent />
    </aside>
  );
}

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-white/8 bg-[#06070A] transition-transform ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 min-h-[40px] min-w-[40px] rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40"
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>
        <SidebarContent onNavigate={onClose} />
      </aside>
    </div>
  );
}
