"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  BookOpen,
  Bot,
  Calculator,
  ClipboardList,
  DollarSign,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Mountain,
  Ruler,
  Settings,
  Truck,
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
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={15} />, exact: true },
  { href: "/dashboard/command-center", label: "Automation Center", icon: <Bot size={15} /> },
  { href: "/dashboard/projects", label: "Projects", icon: <FolderKanban size={15} /> },
  { href: "/dashboard/preconstruction", label: "Preconstruction", icon: <BookOpen size={15} /> },
  { href: "/dashboard/project-management", label: "Project Management", icon: <ListChecks size={15} /> },
  { href: "/dashboard/takeoff", label: "Takeoff", icon: <Ruler size={15} /> },
  { href: "/dashboard/estimating", label: "Estimating", icon: <Calculator size={15} /> },
  { href: "/dashboard/documents", label: "Documents", icon: <FileText size={15} /> },
  { href: "/dashboard/contacts", label: "Contacts & Companies", icon: <Users size={15} /> },
  { href: "/dashboard/price-book", label: "Price Book", icon: <BookOpen size={15} /> },
  { href: "/dashboard/procurement", label: "Procurement", icon: <Truck size={15} /> },
  { href: "/dashboard/financials", label: "Financials", icon: <DollarSign size={15} /> },
  { href: "/dashboard/civil-intelligence", label: "Civil Intelligence", icon: <Mountain size={15} /> },
  { href: "/dashboard/marketing", label: "Marketing", icon: <Megaphone size={15} /> },
  { href: "/dashboard/reports", label: "Reports", icon: <ClipboardList size={15} /> },
  { href: "/dashboard/agents/pending", label: "AI Workforce", icon: <Bot size={15} /> },
];

const SETTINGS_NAV: NavItem[] = [
  { href: "/dashboard/settings/team", label: "Team", icon: <Users size={13} /> },
  { href: "/dashboard/settings/billing", label: "Billing", icon: <Calculator size={13} /> },
  { href: "/dashboard/settings/cost-overrides", label: "Cost Overrides", icon: <BookOpen size={13} /> },
];

const COMING_SOON: string[] = [];

function NavLink({ item, onNavigate, small }: { item: NavItem; onNavigate?: () => void; small?: boolean }) {
  const pathname = usePathname();
  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`group relative flex items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${small ? "py-2 text-xs" : "py-2.5"} ${
        active ? "bg-white/5 text-white" : "text-white/40 hover:bg-white/4 hover:text-white/80"
      }`}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-[#CCFF00]" />}
      <span className={`transition-colors ${active ? "text-[#CCFF00]" : "text-white/25 group-hover:text-white/55"}`}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

function ComingSoonRow({ label }: { label: string }) {
  return (
    <div
      className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-xs text-white/20"
      title={`${label} is not ready yet. The workflow isn't connected or verified right now.`}
    >
      <Settings size={13} className="text-white/15" />
      <span className="flex-1">{label}</span>
      <span className="rounded border border-white/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white/25">
        Not ready
      </span>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="px-3 pt-4">
        <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/25">Workspace</p>
        <p className="mt-2 text-xs leading-5 text-white/38">
          Start with the common jobs. The rest stays easy to reach when you need it.
        </p>
        <div className="mt-3 space-y-1">
          <NavLink item={{ href: "/dashboard/command-center", label: "Command Center", icon: <Bot size={15} /> }} onNavigate={onNavigate} />
          <NavLink item={{ href: "/dashboard/projects", label: "Projects", icon: <FolderKanban size={15} /> }} onNavigate={onNavigate} />
          <NavLink item={{ href: "/dashboard/takeoff", label: "Takeoff", icon: <Ruler size={15} /> }} onNavigate={onNavigate} />
          <NavLink item={{ href: "/dashboard/documents", label: "Documents", icon: <FileText size={15} /> }} onNavigate={onNavigate} />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          <p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-white/25">Core Work</p>
          {WORKSPACE_NAV.map((item) => (
            <NavLink key={item.label} item={item} onNavigate={onNavigate} />
          ))}
        </div>

        <div className="mt-6 space-y-0.5">
          <p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-white/25">
            Settings & Administration
          </p>
          {SETTINGS_NAV.map((item) => (
            <NavLink key={item.label} item={item} onNavigate={onNavigate} small />
          ))}
        </div>

        {COMING_SOON.length > 0 && (
          <div className="mt-6 space-y-0.5">
            <p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-white/25">Coming Soon</p>
            {COMING_SOON.map((label) => (
              <ComingSoonRow key={label} label={label} />
            ))}
          </div>
        )}
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
    <div className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
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
