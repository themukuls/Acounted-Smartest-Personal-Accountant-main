import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/integrations/indexeddb/auth";

interface PersonalDetailsModalProps {
  open: boolean;
  onClose: () => void;
}

export const PersonalDetailsModal = ({ open, onClose }: PersonalDetailsModalProps) => {
  const { user, refreshUser } = useAuth();
  const { toast }             = useToast();
  const [loading,        setLoading]        = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [formData, setFormData] = useState({
    display_name: "",
    phone:        "",
    email:        "",
  });

  useEffect(() => {
    const load = async () => {
      if (!user || !open) return;
      setLoadingProfile(true);
      try {
        const { profile, error } = await auth.getUserProfileLocal(user.id);
        if (error) throw new Error(error);
        setFormData({
          display_name: profile?.display_name || "",
          phone:        profile?.phone        || "",
          email:        user.email            || "",
        });
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } finally {
        setLoadingProfile(false);
      }
    };
    load();
  }, [user, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      toast({ title: "Invalid email", description: "Enter a valid email address.", variant: "destructive" });
      return;
    }
    if (!/^\d{10}$/.test(formData.phone.trim())) {
      toast({ title: "Invalid phone", description: "Phone must be 10 digits.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // Update name + phone
      const { error: profileError } = await auth.updateUserProfileLocal(user!.id, {
        display_name: formData.display_name,
        phone:        formData.phone.trim(),
      });
      if (profileError) throw new Error(profileError);

      // Update email only if changed
      if (formData.email.trim() !== user?.email) {
        const { error: emailError } = await auth.updateUserEmailLocal(user!.id, formData.email);
        if (emailError) throw new Error(emailError);
      }

      await refreshUser();
      toast({ title: "Profile updated", description: "Your details have been saved." });
      onClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl pointer-events-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            Personal Details
          </DialogTitle>
        </DialogHeader>

        {loadingProfile ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="display_name">Name</Label>
              <Input
                id="display_name"
                placeholder="Your name (optional)"
                value={formData.display_name}
                onChange={e => setFormData(p => ({ ...p, display_name: e.target.value }))}
                className="pointer-events-auto"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pd-email">Email</Label>
              <Input
                id="pd-email"
                type="email"
                value={formData.email}
                onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                required
                className="pointer-events-auto"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pd-phone">Phone Number</Label>
              <Input
                id="pd-phone"
                type="tel"
                value={formData.phone}
                onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                required
                className="pointer-events-auto"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onClose} className="pointer-events-auto">
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="pointer-events-auto">
                {loading ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
