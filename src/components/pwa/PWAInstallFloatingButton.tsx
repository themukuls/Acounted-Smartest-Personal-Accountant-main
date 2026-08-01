"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface PWAInstallFloatingButtonProps {
  onClick: () => void;
  className?: string;
}

export const PWAInstallFloatingButton = ({ onClick, className }: PWAInstallFloatingButtonProps) => {
  return (
    <Button
      onClick={onClick}
      className={cn(
        "fixed bottom-4 right-4 h-12 w-auto px-4 rounded-full shadow-2xl bg-gradient-primary text-primary-foreground flex items-center justify-center z-50 hover:scale-105 transition-transform pointer-events-auto",
        className
      )}
    >
      <Download className="h-5 w-5 mr-2" /> Install App
    </Button>
  );
};