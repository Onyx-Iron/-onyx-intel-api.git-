"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  BookOpen,
  Bot,
  Calculator,
  ChevronDown,
  ClipboardList,
  DollarSign,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Mountain,
  Ruler,
  Truck,
  Search,
  Users,
  X,
} from "lucide-react";
import ActiveProjectPicker from "@/components/project/ActiveProjectPicker";
import { requestCommandPalette } from "@/components/search/CommandPalette";
import { useProjectContext } from "@/components/project/ProjectContext";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}

/** Day-to-day destinations — keep this short so the shell stays calm. */
const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: <LayoutDashboard size={15} />, exact: true },
  { href: "/dashboard/projects", label: "Projects", icon: <FolderKanban size={15} /> },
  { href: "/dashboard/preconstruction", label: "Bid Board", icon: <ClipboardList size={15} /> },
  { href: "/dashboard/reports", label: "Reports", icon: <ClipboardList size={15} /> },
  { href: "/dashboard/agents/pending", label: "AI Workforce", icon: <Bot size={15} /> },
];

/**
 * Cross-project roll-ups and specialty tools. Still fully available —
 * just tucked under “More tools” so the default nav isn’t a wall of links.
 */
const MORE_TOOLS: NavItem[] = [
  { href: "/dashboard/project-management", label: "Project Management", icon: <ListChecks size={14} /> },
  { href: "/dashboard/takeoff", label: "Takeoff", icon: <Ruler size={14} /> },
  { href: "/dashboard/estimating", label: "Estimating", icon: <Calculator size={14} /> },
  { href: "/dashboard/documents", label: "Documents", icon: <FileText size={14} /> },
  { href: "/dashboard/contacts", label: "Contacts", icon: <Users size={14} /> },
  { href: "/dashboard/price-book", label: "Price Book", icon: <BookOpen size={14} /> },
  { href: "/dashboard/procurement", label: "Procurement", icon: <Truck size={14} /> },
  { href: "/dashboard/financials", label: "Financials", icon: <DollarSign size={14} /> },
  { href: "/dashboard/civil-intelligence", label: "Civil Intelligence", icon: <Mountain size={14} /> },
  { href: "/dashboard/marketing", label: "Marketing", icon: <Megaphone size={14} /> },
];

const SETTINGS_NAV: NavItem[] = [
  { href: "/dashboard/settings/connections", label: "Connections", icon: <Megaphone size={13} /> },
  { href: "/dashboard/settings/team", label: "Team", icon: <Users size={13} /> },
  { href: "/dashboard/settings/billing", label: "Billing", icon: <Calculator size={13} /> },
  { href: "/dashboard/settings/cost-overrides", label: "Cost Overrides", icon: <BookOpen size={13} /> },
];

function pathMatches(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

function NavLink({ item, onNavigate, small }: { item: NavItem; onNavigate?: () => void; small?: boolean }) {
  const pathname = usePathname();
  const active = pathMatches(pathname, item);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`group relative flex items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${small ? "py-2 text-xs" : "py-2.5"} ${
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

function CollapsibleNav({
  title,
  items,
  defaultOpen,
  forceOpen,
  onNavigate,
  small,
}: {
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
  forceOpen?: boolean;
  onNavigate?: () => void;
  small?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const expanded = forceOpen || open;

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex w-full items-center justify-between px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.22em] text-white/30 transition-colors hover:text-white/55"
        aria-expanded={expanded}
      >
        <span>{title}</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`}
        />
      </button>
      {expanded && (
        <div className="space-y-0.5">
          {items.map((item) => (
            <NavLink key={item.label} item={item} onNavigate={onNavigate} small={small} />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { projects, loading } = useProjectContext();
  const firstRun = !loading && projects.length === 0;
  const primaryNav = firstRun
    ? PRIMARY_NAV.filter((item) => item.href === "/dashboard" || item.href === "/dashboard/projects")
    : PRIMARY_NAV;
  const moreTools = firstRun
    ? [...PRIMARY_NAV.filter((item) => item.href !== "/dashboard" && item.href !== "/dashboard/projects"), ...MORE_TOOLS]
    : MORE_TOOLS;
  const moreActive = useMemo(
    () => moreTools.some((item) => pathMatches(pathname, item)),
    [pathname, moreTools],
  );
  const settingsActive = useMemo(
    () => SETTINGS_NAV.some((item) => pathMatches(pathname, item)),
    [pathname],
  );

  return (
    <>
      <div className="px-4 pt-5 pb-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">Onyx &amp; Iron</p>
        <p className="mt-0.5 text-sm font-semibold text-white/80">Onyx Intel</p>
      </div>

      <ActiveProjectPicker onNavigate={onNavigate} />

      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          requestCommandPalette();
        }}
        className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/45 transition-colors hover:border-white/20 hover:text-white"
      >
        <Search size={13} className="text-[#CCFF00]" />
        <span className="flex-1">Jump to a function</span>
        <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-white/35">Ctrl K</kbd>
      </button>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="space-y-0.5">
          <p className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-white/25">Main</p>
          {primaryNav.map((item) => (
            <NavLink key={item.label} item={item} onNavigate={onNavigate} />
          ))}
        </div>

        <CollapsibleNav
          title="More tools"
          items={moreTools}
          forceOpen={moreActive}
          onNavigate={onNavigate}
          small
        />

        <CollapsibleNav
          title="Settings"
          items={SETTINGS_NAV}
          forceOpen={settingsActive}
          onNavigate={onNavigate}
          small
        />
      </nav>

      <div className="border-t border-white/5 p-4">
        <div className="flex items-center gap-3">
          <UserButton />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-white/70">Account</p>
            <p className="truncate text-[9px] uppercase tracking-[0.15em] text-white/30">Signed in</p>
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
