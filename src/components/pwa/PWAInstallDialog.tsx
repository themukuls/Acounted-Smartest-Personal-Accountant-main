"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface PWAInstallDialogProps {
  open: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}

export const PWAInstallDialog = ({ open, onInstall, onDismiss }: PWAInstallDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onDismiss}>
      <DialogContent 
        className="sm:max-w-sm bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl pointer-events-auto"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent flex items-center gap-2">
            <Download className="h-5 w-5" /> Highly Recommended - Install the app on your machine
          </DialogTitle>
          {/* Using a div for custom styling of the description points */}
          <div className="text-muted-foreground text-sm mt-2 space-y-2">
            <p className="flex items-center gap-2">
              <span className="text-lg">🔒</span> 
              <span><span className="font-semibold">Enhanced Privacy & Offline Access:</span> Enjoy a fully private and offline-first experience by installing the app directly on your device.</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-lg">⚡</span> 
              <span><span className="font-semibold">Seamless Data Management:</span> Installed apps offer quicker data updates and effortless financial tracking.</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-lg">🚀</span> 
              <span><span className="font-semibold">Instant Access & Convenience:</span> Launch Acounted directly from your home screen, no need to open a browser every time.</span>
            </p>
          </div>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4">
          <Button onClick={onInstall} className="w-full pointer-events-auto">
            <Download className="h-4 w-4 mr-2" /> Install App
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
