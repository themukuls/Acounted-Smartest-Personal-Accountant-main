"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CloudDownload, ShieldCheck } from "lucide-react";

interface BackupReminderDialogProps {
  open: boolean;
  onConfirmBackup: () => void;
  onDismiss: () => void;
}

export const BackupReminderDialog = ({ open, onConfirmBackup, onDismiss }: BackupReminderDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onDismiss}>
      <DialogContent 
        className="sm:max-w-md bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl pointer-events-auto"
        onInteractOutside={(e) => e.preventDefault()} // Prevent closing by clicking outside
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent flex items-center gap-2">
            <CloudDownload className="h-5 w-5" /> Backup Your Data
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm mt-2 space-y-2">
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" />
              <span><span className="font-semibold">Protect Your Financial Records:</span> As an offline-first app, your data is stored locally. Regular backups ensure your financial history is safe.</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-lg">🔄</span> 
              <span><span className="font-semibold">Seamless Device Transfers:</span> Easily move your data to a new device or restore it if needed.</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-lg">🗓️</span> 
              <span>It's been a while since your last backup. We recommend backing up your data now.</span>
            </p>
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4">
          <Button onClick={onConfirmBackup} className="w-full pointer-events-auto">
            <CloudDownload className="h-4 w-4 mr-2" /> Backup Now
          </Button>
          <Button variant="outline" onClick={onDismiss} className="w-full pointer-events-auto">
            Remind Me Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};