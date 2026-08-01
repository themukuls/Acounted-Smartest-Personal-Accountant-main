"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/integrations/indexeddb/auth";
import { Mail, Phone, Lock, CheckCircle2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface ForgotPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Password regex from Auth.tsx for consistency
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\d{10}$/; // Exactly 10 digits

export const ForgotPasswordDialog = ({ open, onOpenChange }: ForgotPasswordDialogProps) => {
  const { toast } = useToast();
  const [step, setStep] = useState<'verify' | 'reset'>('verify');
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    phone: "",
    newPassword: "",
    confirmNewPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setStep('verify');
      setFormData({ email: "", phone: "", newPassword: "", confirmNewPassword: "" });
      setErrors({});
      setVerifiedUserId(null);
    }
  }, [open]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setErrors(prev => ({ ...prev, [e.target.name]: undefined })); // Clear error on change
  };

  const validateVerificationForm = () => {
    const newErrors: Record<string, string | undefined> = {};
    let isValid = true;

    if (!formData.email.trim()) {
      newErrors.email = "Email is required.";
      isValid = false;
    } else if (!emailRegex.test(formData.email)) {
      newErrors.email = "Please enter a valid email address.";
      isValid = false;
    }
    if (!formData.phone.trim()) {
      newErrors.phone = "Phone number is required.";
      isValid = false;
    } else if (!phoneRegex.test(formData.phone.trim())) {
      newErrors.phone = "Phone number must be 10 digits.";
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const validateResetForm = () => {
    const newErrors: Record<string, string | undefined> = {};
    let isValid = true;

    if (!formData.newPassword) {
      newErrors.newPassword = "New password is required.";
      isValid = false;
    } else if (!passwordRegex.test(formData.newPassword)) {
      newErrors.newPassword = "Min 6 chars, 1 uppercase, 1 number, 1 special char.";
      isValid = false;
    }
    if (!formData.confirmNewPassword) {
      newErrors.confirmNewPassword = "Confirm new password is required.";
      isValid = false;
    } else if (formData.newPassword !== formData.confirmNewPassword) {
      newErrors.confirmNewPassword = "New passwords do not match.";
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateVerificationForm()) {
      toast({ title: "Validation Error", description: "Please correct the highlighted fields.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { user: foundUser, error } = await auth.verifyUserByEmailAndPhone(formData.email, formData.phone);
      if (error || !foundUser) {
        setErrors(prev => ({ ...prev, email: error || "Email or phone number is incorrect." }));
        toast({ title: "Verification Failed", description: error || "Email or phone number is incorrect.", variant: "destructive" });
        return;
      }

      setVerifiedUserId(foundUser.id);
      setStep('reset');
      toast({ title: "Verification Successful", description: "You can now set your new password." });
    } catch (error: any) {
      console.error("Error during verification:", error);
      toast({ title: "Error", description: error.message || "An unexpected error occurred during verification.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifiedUserId || !validateResetForm()) {
      toast({ title: "Validation Error", description: "Please correct the highlighted fields.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { error } = await auth.updateUserPasswordLocal(verifiedUserId, formData.newPassword);
      if (error) throw new Error(error);

      toast({ title: "Password Reset Successful", description: "Your password has been updated. You can now log in." });
      onOpenChange(false); // Close dialog
    } catch (error: any) {
      console.error("Error resetting password:", error);
      toast({ title: "Error", description: error.message || "Failed to reset password.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl pointer-events-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent flex items-center gap-2">
            {step === 'verify' ? (
              <>
                <Mail className="h-5 w-5" /> Forgot Password
              </>
            ) : (
              <>
                <Lock className="h-5 w-5" /> Reset Password
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {step === 'verify'
              ? "Enter your registered email and phone number to verify your identity."
              : "Set a new password for your account."}
          </DialogDescription>
        </DialogHeader>

        {step === 'verify' ? (
          <form onSubmit={handleVerify} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                required
                className={cn("pointer-events-auto", errors.email && "border-destructive")}
              />
              {errors.email && <p className="text-destructive text-xs mt-1">{errors.email}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                required
                className={cn("pointer-events-auto", errors.phone && "border-destructive")}
              />
              {errors.phone && <p className="text-destructive text-xs mt-1">{errors.phone}</p>}
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="pointer-events-auto">
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="pointer-events-auto">
                {loading ? "Verifying..." : "Verify"}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                value={formData.newPassword}
                onChange={handleChange}
                required
                className={cn("pointer-events-auto", errors.newPassword && "border-destructive")}
              />
              {errors.newPassword ? (
                <p className="text-destructive text-xs mt-1">{errors.newPassword}</p>
              ) : (
                <p className="text-muted-foreground text-xs mt-1">Min 6 chars, 1 uppercase, 1 number, 1 special char.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
              <Input
                id="confirmNewPassword"
                name="confirmNewPassword"
                type="password"
                value={formData.confirmNewPassword}
                onChange={handleChange}
                required
                className={cn("pointer-events-auto", errors.confirmNewPassword && "border-destructive")}
              />
              {errors.confirmNewPassword && <p className="text-destructive text-xs mt-1">{errors.confirmNewPassword}</p>}
            </div>

            <div className="flex justify-between gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setStep('verify')} className="pointer-events-auto">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button type="submit" disabled={loading} className="pointer-events-auto">
                {loading ? "Resetting..." : "Reset Password"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};