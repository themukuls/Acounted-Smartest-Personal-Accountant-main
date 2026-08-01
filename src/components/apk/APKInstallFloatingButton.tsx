"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Download, Smartphone, X } from "lucide-react"; // NEW: Import X icon
import { cn } from "@/lib/utils";

interface APKInstallFloatingButtonProps {
  onClick: () => void;
  onDismissPermanent: () => void; // NEW: Added onDismissPermanent prop
  className?: string;
  positionClass?: string;
}

export const APKInstallFloatingButton = ({ onClick, onDismissPermanent, className, positionClass = "bottom-4 right-4" }: APKInstallFloatingButtonProps) => {
  return (
    <div className={cn("fixed flex items-center gap-2 z-50", positionClass)}> {/* NEW: Wrap button and close button in a div */}
      <Button
        onClick={onClick}
        className={cn(
          "h-12 w-auto px-4 rounded-full shadow-2xl bg-gradient-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-transform pointer-events-auto",
          className
        )}
      >
        <Smartphone className="h-5 w-5 mr-2" /> Install Android App
      </Button>
      <Button
        onClick={onDismissPermanent} // NEW: Attach permanent dismiss handler
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full bg-background/50 backdrop-blur-sm text-muted-foreground hover:bg-background/80 hover:text-foreground shadow-lg pointer-events-auto"
        title="Dismiss permanently"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};