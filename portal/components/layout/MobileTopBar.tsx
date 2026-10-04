"use client";

import { useState } from "react";
import { Menu, Search } from "lucide-react";
import { OILogo } from "@/components/brand/BrandMark";
import { MobileSidebar } from "@/components/layout/Sidebar";
import { requestCommandPalette } from "@/components/search/CommandPalette";

export default function MobileTopBar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/5 bg-[#06070A]/95 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-[40px] min-w-[40px] rounded-md p-2 text-white/70 transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40"
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <OILogo className="h-6 w-auto" />
          <span className="text-sm font-black tracking-tight text-white">Onyx Intel</span>
        </div>
        <button
          type="button"
          onClick={() => requestCommandPalette()}
          className="min-h-[40px] min-w-[40px] rounded-md p-2 text-white/70 transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40"
          aria-label="Jump to a function"
        >
          <Search size={18} />
        </button>
      </header>
      <MobileSidebar open={open} onClose={() => setOpen(false)} />
    </>
  );
}
