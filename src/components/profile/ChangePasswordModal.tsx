"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/integrations/indexeddb/auth";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

// Password regex from Auth.tsx for consistency
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;

export const ChangePasswordModal = ({ open, onClose }: ChangePasswordModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    oldPassword: "",
    newPassword: "",
    confirmNewPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setErrors(prev => ({ ...prev, [e.target.name]: undefined })); // Clear error on change
  };

  const validateForm = () => {
    const newErrors: Record<string, string | undefined> = {};
    let isValid = true;

    if (!formData.oldPassword) {
      newErrors.oldPassword = "Old password is required.";
      isValid = false;
    }
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
    if (formData.oldPassword && formData.newPassword && formData.oldPassword === formData.newPassword) {
      newErrors.newPassword = "New password cannot be the same as old password.";
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast({ title: "Error", description: "User not authenticated.", variant: "destructive" });
      return;
    }

    if (!validateForm()) {
      toast({ title: "Validation Error", description: "Please correct the highlighted fields.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // 1. Verify old password
      const { user: verifiedUser, error: signInError } = await auth.signInLocal(user.email, formData.oldPassword);
      if (signInError || !verifiedUser) {
        setErrors(prev => ({ ...prev, oldPassword: "Old password is incorrect." }));
        toast({ title: "Error", description: "Old password is incorrect.", variant: "destructive" });
        return;
      }

      // 2. Update password
      const { error: updateError } = await auth.updateUserPasswordLocal(user.id, formData.newPassword);
      if (updateError) throw new Error(updateError);

      toast({
        title: "Success",
        description: "Your password has been changed successfully.",
      });
      onClose();
      setFormData({ oldPassword: "", newPassword: "", confirmNewPassword: "" }); // Clear form
    } catch (error: any) {
      console.error("Error changing password:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to change password.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl pointer-events-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent flex items-center gap-2">
            <Lock className="h-5 w-5" /> Change Password
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="oldPassword">Old Password</Label>
            <Input
              id="oldPassword"
              name="oldPassword"
              type="password"
              value={formData.oldPassword}
              onChange={handleChange}
              required
              className={cn("pointer-events-auto", errors.oldPassword && "border-destructive")}
            />
            {errors.oldPassword && <p className="text-destructive text-xs mt-1">{errors.oldPassword}</p>}
          </div>

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

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="pointer-events-auto">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="pointer-events-auto">
              {loading ? "Changing..." : "Change Password"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};