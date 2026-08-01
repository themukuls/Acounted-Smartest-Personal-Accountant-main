"use client";
import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Member } from "@/integrations/indexeddb/services/lendrService";
import { v4 as uuidv4 } from "uuid";
import { createOnlineGroup, saveOnlineGroupRef } from "@/integrations/indexeddb/services/lendrService";
import { Copy, Share2, CheckCircle2 } from "lucide-react";

const EMOJIS = ["🏖️", "🏠", "💑", "✈️", "🍽️", "🎉", "🎓", "💼", "🏕️", "🛒"];
const YOU_ID = "you";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: { id?: string; name: string; emoji: string; members: Member[] }) => Promise<void>;
  initial?: { id: string; name: string; emoji: string; members: Member[] };
}

export const CreateGroupDialog = ({ open, onClose, onSave, initial }: Props) => {
  const [name,    setName]    = useState("");
  const [emoji,   setEmoji]   = useState("🎉");
  const [members, setMembers] = useState<Member[]>([]);
  const [newName, setNewName] = useState("");
  const [newPhone,setNewPhone]= useState("");
  const [saving,     setSaving]     = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [copied,      setCopied]      = useState(false);
  const [error,   setError]   = useState("");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setEmoji(initial.emoji);
      setMembers(initial.members.filter(m => m.id !== YOU_ID));
    } else {
      setName(""); setEmoji("🎉"); setMembers([]); setNewName(""); setNewPhone(""); setError("");
    }
  }, [open, initial]);

  const addMember = () => {
    if (!newName.trim()) { setError("Enter a name for this member."); return; }
    setMembers(p => [...p, { id: uuidv4(), name: newName.trim(), phone: newPhone.replace(/\D/g, "") }]);
    setNewName(""); setNewPhone(""); setError("");
  };

  const removeMember = (id: string) => setMembers(p => p.filter(m => m.id !== id));

  const handleSave = async () => {
    if (!name.trim()) { setError("Group name is required."); return; }
    setSaving(true);
    try {
      const youMember: Member = { id: YOU_ID, name: "You", phone: "" };
      const allMembers = [youMember, ...members];

      if (initial) {
        // Editing existing group — local + online update
        await onSave({ id: initial.id, name: name.trim(), emoji, members: allMembers });
        onClose();
      } else {
        // Creating new group — create online first, then save locally
        const { groupId, code } = await createOnlineGroup(name.trim(), emoji, allMembers);
        await onSave({ id: groupId, name: name.trim(), emoji, members: allMembers });
        saveOnlineGroupRef({ code, groupId, memberId: YOU_ID, name: name.trim(), emoji, lastSynced: new Date().toISOString() });
        setCreatedCode(code);
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to save group.");
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCode = () => {
    if (!createdCode) return;
    navigator.clipboard.writeText(createdCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareWhatsApp = () => {
    if (!createdCode) return;
    const msg = encodeURIComponent(`Join our group "${name}" on Lendr (Acounted)! Use invite code: *${createdCode}* 🤝`);
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  // Success screen — show invite code after group creation
  if (createdCode) return (
    <Dialog open={open} onOpenChange={() => { setCreatedCode(null); onClose(); }}>
      <DialogContent className="max-w-xs sm:max-w-sm bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl rounded-2xl pointer-events-auto text-center">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold gradient-text">Group Created! 🎉</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-5">
          <div className="text-4xl">{emoji}</div>
          <p className="text-sm text-foreground font-medium">{name}</p>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Share this code with others to join</p>
            <div className="flex items-center justify-center gap-3 bg-primary/8 border border-primary/20 rounded-2xl py-4 px-6">
              <span className="text-3xl font-bold tracking-widest text-primary font-mono">{createdCode}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={handleCopyCode}
              className={cn("flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-medium transition-all pointer-events-auto border",
                copied ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-muted/40 text-foreground border-border/40 hover:bg-muted"
              )}>
              {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied!" : "Copy Code"}
            </button>
            <button type="button" onClick={handleShareWhatsApp}
              className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-medium bg-green-500 text-white hover:bg-green-600 transition-all pointer-events-auto">
              <Share2 className="h-4 w-4" /> WhatsApp
            </button>
          </div>

          <button type="button" onClick={() => { setCreatedCode(null); onClose(); }}
            className="w-full text-sm text-muted-foreground hover:text-foreground pointer-events-auto">
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs sm:max-w-md bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl rounded-2xl pointer-events-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent flex items-center gap-2">
            <Users className="h-4 w-4" />
            {initial ? "Edit Group" : "New Group"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Emoji picker */}
          <div className="space-y-1.5">
            <Label className="text-xs">Icon</Label>
            <div className="flex flex-wrap gap-2">
              {EMOJIS.map(e => (
                <button key={e} type="button" onClick={() => setEmoji(e)}
                  className={cn(
                    "h-9 w-9 rounded-xl text-xl transition-all pointer-events-auto",
                    emoji === e ? "bg-primary/15 ring-2 ring-primary scale-110" : "bg-muted/40 hover:bg-muted"
                  )}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Group name */}
          <div className="space-y-1.5">
            <Label htmlFor="gname" className="text-xs">Group Name</Label>
            <Input id="gname" value={name} onChange={e => { setName(e.target.value); setError(""); }}
              placeholder="e.g. Goa Trip, Flat May" className="h-9 text-sm pointer-events-auto" />
          </div>

          {/* Members list */}
          <div className="space-y-2">
            <Label className="text-xs">Members <span className="text-muted-foreground font-normal">(you are always included)</span></Label>

            {/* "You" pill */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/8 border border-primary/20">
              <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">Y</div>
              <span className="text-sm font-medium text-foreground">You</span>
            </div>

            {members.map(m => (
              <div key={m.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border/40">
                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                  {m.name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.name}</p>
                  {m.phone && <p className="text-[10px] text-muted-foreground">{m.phone}</p>}
                </div>
                <button type="button" onClick={() => removeMember(m.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors pointer-events-auto">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {/* Add member row */}
            <div className="flex gap-2">
              <Input value={newName} onChange={e => { setNewName(e.target.value); setError(""); }}
                placeholder="Name" className="h-8 text-xs flex-1 pointer-events-auto"
                onKeyDown={e => e.key === "Enter" && addMember()} />
              <Input value={newPhone} onChange={e => setNewPhone(e.target.value)}
                placeholder="Phone (optional)" type="tel"
                className="h-8 text-xs w-32 pointer-events-auto"
                onKeyDown={e => e.key === "Enter" && addMember()} />
              <Button type="button" size="sm" variant="outline" onClick={addMember}
                className="h-8 px-2 pointer-events-auto shrink-0">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {error && <p className="text-destructive text-xs">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1 pointer-events-auto">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1 bg-gradient-primary text-primary-foreground pointer-events-auto">
              {saving ? "Saving…" : initial ? "Save Changes" : "Create Group"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
