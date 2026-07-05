"use client";

import React from "react";
import { ToastProvider, Toaster } from "./Toast";
import { ConfirmProvider } from "./ConfirmDialog";

export default function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        {children}
        <Toaster />
      </ConfirmProvider>
    </ToastProvider>
  );
}
