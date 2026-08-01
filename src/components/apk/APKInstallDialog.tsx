"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Smartphone } from "lucide-react"; // Changed Android to Smartphone

interface APKInstallDialogProps {
  open: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}

export const APKInstallDialog = ({ open, onInstall, onDismiss }: APKInstallDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onDismiss}>
      <DialogContent 
        className="sm:max-w-sm bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl pointer-events-auto"
        onInteractOutside={(e) => e.preventDefault()} // Prevent closing by clicking outside
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent flex items-center gap-2">
            <Smartphone className="h-5 w-5" /> Install Acounted Android App
          </DialogTitle>
          <div className="text-muted-foreground text-sm mt-2 space-y-2">
            <p className="flex items-center gap-2">
              <span className="text-lg">🚀</span> 
              <span><span className="font-semibold">Enhanced Performance:</span> Get a smoother, faster experience with our native Android application.</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-lg">🔒</span> 
              <span><span className="font-semibold">Full Offline Access:</span> Enjoy complete functionality even without an internet connection.</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-lg">⚙️</span> 
              <span><span className="font-semibold">Important:</span> You may need to enable "Install from Unknown Sources" in your device settings to install the app.</span>
            </p>
          </div>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4">
          <Button onClick={onInstall} className="w-full pointer-events-auto">
            <Download className="h-4 w-4 mr-2" /> Download APK
          </Button>
          <Button variant="outline" onClick={onDismiss} className="w-full pointer-events-auto">
            Remind Me Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
