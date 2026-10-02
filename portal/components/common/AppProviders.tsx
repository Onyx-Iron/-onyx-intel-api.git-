"use client";

import React from "react";
import { ToastProvider, Toaster } from "./Toast";
import { ConfirmProvider } from "./ConfirmDialog";
import { ProjectProvider } from "@/components/project/ProjectContext";

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
          <Toaster />
        </ProjectProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
