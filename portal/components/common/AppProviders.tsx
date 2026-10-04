"use client";

import React from "react";
import { ToastProvider, Toaster } from "./Toast";
import { ConfirmProvider } from "./ConfirmDialog";
import { ProjectProvider } from "@/components/project/ProjectContext";
import CommandPalette from "@/components/search/CommandPalette";

export default function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <ProjectProvider>
          {children}
          <CommandPalette />
          <Toaster />
        </ProjectProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
