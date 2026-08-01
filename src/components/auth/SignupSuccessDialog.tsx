"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface SignupSuccessDialogProps {
  open: boolean;
  onLoginRedirect: () => void;
  loading: boolean; // New prop for loading state
}

export const SignupSuccessDialog = ({ open, onLoginRedirect, loading }: SignupSuccessDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={() => {}}> {/* Prevent closing by clicking outside */}
      <DialogContent className="sm:max-w-md bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl pointer-events-auto">
        <DialogHeader className="text-center">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
              <DialogTitle className="text-xl font-bold text-foreground">
                Creating your account...
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-2">
                Please wait a moment.
              </DialogDescription>
            </div>
          ) : (
            <>
              <Sparkles className="h-12 w-12 text-primary mx-auto mb-4 animate-pulse" />
              <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Congrats towards a big step towards Financial Freedom!
              </DialogTitle>
              <DialogDescription className="text-base text-muted-foreground mt-2">
                This is the most important step that you took towards wealth building.
              </DialogDescription>
            </>
          )}
        </DialogHeader>
        {!loading && (
          <div className="flex justify-center pt-6">
            <Button onClick={onLoginRedirect} className="pointer-events-auto">
              Log In
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};