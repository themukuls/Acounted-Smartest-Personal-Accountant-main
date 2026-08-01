"use client";
import React, { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatFullINR } from "@/lib/currency";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Plus, Trash2, Edit3, MessageSquare, CheckCircle2,
  MoreVertical, Users, Receipt, TrendingUp, TrendingDown,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  getGroup, getExpenses, saveExpense, deleteExpense, deleteGroup,
  simplifyDebts, settleAllBetween, SettlementEntry, LendrExpense,
  fetchOnlineGroup, pushExpense, updateOnlineExpense, deleteOnlineExpense,
  pushSettlement, getOnlineGroupRefs, OnlineGroup,
} from "@/integrations/indexeddb/services/lendrService";
import { AddExpenseDialog } from "./AddExpenseDialog";
import { CreateGroupDialog } from "./CreateGroupDialog";
import { saveGroup } from "@/integrations/indexeddb/services/lendrService";

const YOU_ID = "you";

interface Props {
  groupId: string;
  onBack: () => void;
}

export const GroupDetail = ({ groupId, onBack }: Props) => {
  const { user }       = useAuth();
  const { toast }      = useToast();
  const queryClient    = useQueryClient();

  const [showAddExp,   setShowAddExp]   = useState(false);
  const [syncing,      setSyncing]      = useState(false);
  const [lastSynced,   setLastSynced]   = useState<string | null>(null);
  const [onlineData,   setOnlineData]   = useState<OnlineGroup | null>(null);

  // Get the online code for this group (if it was created online)
  const onlineRef = getOnlineGroupRefs().find(r => r.groupId === groupId);
  const [showEditGrp,  setShowEditGrp]  = useState(false);
  const [editingExp,   setEditingExp]   = useState<LendrExpense | null>(null);

  const { data: group, isLoading: loadingGroup } = useQuery({
    queryKey: ["lendr_group", groupId],
    queryFn:  () => getGroup(groupId),
    enabled:  !!groupId,
  });

  const { data: expenses = [], isLoading: loadingExp } = useQuery({
    queryKey: ["lendr_expenses", groupId],
    queryFn:  () => getExpenses(groupId),
    enabled:  !!groupId,
  });

  // Pull latest from GitHub whenever group is opened
  const syncOnline = useCallback(async () => {
    if (!onlineRef) return;
    setSyncing(true);
    try {
      const remote = await fetchOnlineGroup(onlineRef.code);
      setOnlineData(remote);
      setLastSynced(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      console.warn('[Lendr] sync failed:', e);
    } finally {
      setSyncing(false);
    }
  }, [onlineRef?.code]);

  // Auto-sync on mount
  React.useEffect(() => { syncOnline(); }, [syncOnline]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["lendr_group", groupId] });
    queryClient.invalidateQueries({ queryKey: ["lendr_expenses", groupId] });
    queryClient.invalidateQueries({ queryKey: ["lendr_groups"] });
  }, [queryClient, groupId]);

  if (loadingGroup) return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
  if (!group) return (
    <div className="text-center py-16 text-muted-foreground">Group not found.</div>
  );

  // Use online data if synced (authoritative), fall back to local
  const members      = onlineData?.members ?? group.members;
  const memberById   = Object.fromEntries(members.map(m => [m.id, m]));
  const activeExpenses = onlineData?.expenses ?? expenses;
  const settlements    = simplifyDebts(members, activeExpenses);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSaveExpense = async (data: any) => {
    if (!user) return;
    await saveExpense(user.id, { ...data, group_id: groupId });
    // Push to GitHub if this is an online group
    if (onlineRef) {
      try {
        if (data.id) {
          await updateOnlineExpense(onlineRef.code, data.id, data);
        } else {
          await pushExpense(onlineRef.code, { ...data, group_id: groupId, added_by: onlineRef.memberId });
        }
        await syncOnline();
      } catch (e) { console.warn('[Lendr] online push failed:', e); }
    }
    toast({ title: "Saved!", description: "Expense added." });
    invalidate();
  };

  const handleDeleteExpense = async (id: string) => {
    await deleteExpense(id);
    if (onlineRef) {
      try { await deleteOnlineExpense(onlineRef.code, id); await syncOnline(); }
      catch (e) { console.warn('[Lendr] online delete failed:', e); }
    }
    toast({ title: "Deleted", description: "Expense removed." });
    invalidate();
  };

  const handleDeleteGroup = async () => {
    await deleteGroup(groupId);
    toast({ title: "Group deleted" });
    queryClient.invalidateQueries({ queryKey: ["lendr_groups"] });
    onBack();
  };

  const handleSettleUp = async (s: SettlementEntry) => {
    await settleAllBetween(groupId, s.from_member_id, s.to_member_id);
    if (onlineRef) {
      try { await pushSettlement(onlineRef.code, s.from_member_id, s.to_member_id); await syncOnline(); }
      catch (e) { console.warn('[Lendr] online settle failed:', e); }
    }
    toast({ title: "Settled!", description: `${s.from_member_name} → ${s.to_member_name} settled.` });
    invalidate();
  };

  const handleWhatsApp = (s: SettlementEntry) => {
    if (!s.phone) { toast({ title: "No phone number", description: "Add a phone number for this member in group settings.", variant: "destructive" }); return; }
    const msg = encodeURIComponent(`Hi ${s.to_member_name}, settling ₹${s.amount.toLocaleString("en-IN")} for "${group.name}". 🙏\n\n— Sent via Lendr`);
    window.open(`https://wa.me/${s.phone}?text=${msg}`, "_blank");
  };

  const handleSaveGroup = async (data: any) => {
    if (!user) return;
    await saveGroup(user.id, data);
    toast({ title: "Group updated." });
    invalidate();
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack}
          className="h-9 w-9 rounded-xl bg-muted/40 hover:bg-muted flex items-center justify-center pointer-events-auto">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="h-10 w-10 rounded-2xl bg-primary/8 flex items-center justify-center text-2xl shrink-0">
          {group.emoji}
        </div>
        <div className="flex-1">
          <h2 className="font-bold text-lg text-foreground leading-tight">{group.name}</h2>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" /> {members.length} member{members.length !== 1 ? "s" : ""}
            {onlineRef && (
              <span className={cn("ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                syncing ? "bg-amber-100 text-amber-600" :
                lastSynced ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground"
              )}>
                {syncing ? "Syncing…" : lastSynced ? `Synced ${lastSynced}` : "Online"}
              </span>
            )}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-8 w-8 rounded-xl bg-muted/40 flex items-center justify-center pointer-events-auto">
              <MoreVertical className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-white/95 backdrop-blur-md border border-white/20 shadow-xl z-50">
            <DropdownMenuItem onClick={() => setShowEditGrp(true)} className="gap-2 cursor-pointer">
              <Edit3 className="h-3.5 w-3.5" /> Edit Group
            </DropdownMenuItem>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem onSelect={e => e.preventDefault()}
                  className="gap-2 cursor-pointer text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5" /> Delete Group
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{group.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>All expenses in this group will be permanently deleted.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteGroup} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Simplified balances */}
      <GlassCard className="p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">Balances</p>
        {settlements.length === 0 ? (
          <div className="text-center py-3">
            <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-1" />
            <p className="text-sm text-emerald-600 font-medium">All settled up!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {settlements.map((s, i) => (
              <div key={i} className={cn(
                "flex items-center gap-2 rounded-xl p-3 border",
                s.from_member_id === YOU_ID ? "bg-rose-50/60 border-rose-200/60" : "bg-blue-50/60 border-blue-200/60"
              )}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    <span className={s.from_member_id === YOU_ID ? "text-rose-600" : "text-blue-600"}>
                      {s.from_member_name}
                    </span>
                    {" owes "}
                    <span className={s.to_member_id === YOU_ID ? "text-emerald-600" : "text-foreground"}>
                      {s.to_member_name}
                    </span>
                  </p>
                  <p className="text-base font-bold text-foreground">{formatFullINR(s.amount)}</p>
                </div>
                <div className="flex gap-1.5">
                  {s.phone && (
                    <button type="button" onClick={() => handleWhatsApp(s)}
                      title="Send WhatsApp reminder"
                      className="h-8 w-8 rounded-xl bg-green-100 text-green-600 hover:bg-green-200 flex items-center justify-center transition-colors pointer-events-auto">
                      <MessageSquare className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button type="button" onClick={() => handleSettleUp(s)}
                    title="Mark as settled"
                    className="h-8 w-8 rounded-xl bg-emerald-100 text-emerald-600 hover:bg-emerald-200 flex items-center justify-center transition-colors pointer-events-auto">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Expenses */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">
            Expenses {activeExpenses.length > 0 && <span className="text-muted-foreground font-normal">({activeExpenses.length})</span>}
          </p>
          <Button size="sm" onClick={() => { setEditingExp(null); setShowAddExp(true); }}
            className="h-8 text-xs bg-gradient-primary text-primary-foreground gap-1 pointer-events-auto">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>

        {/* Use online data if available, else local */}
        {loadingExp ? (
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
          </div>
        ) : activeExpenses.length === 0 ? (
          <div className="text-center py-8">
            <Receipt className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No expenses yet</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">Tap "Add" to record the first expense</p>
          </div>
        ) : (
          <div className="space-y-2">
            {expenses.map(exp => {
              const payer = memberById[exp.paid_by_member_id];
              const allSettled = exp.splits.every(s => s.is_settled || s.member_id === exp.paid_by_member_id);
              return (
                <div key={exp.id} className={cn(
                  "rounded-xl border p-3 bg-background/60",
                  allSettled ? "opacity-60 border-border/30" : "border-border/50"
                )}>
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
                      allSettled ? "bg-emerald-100" : "bg-primary/8"
                    )}>
                      <Receipt className={cn("h-4 w-4", allSettled ? "text-emerald-500" : "text-primary")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground truncate">{exp.description}</p>
                          <p className="text-xs text-muted-foreground">
                            Paid by <span className="font-medium">{payer?.name ?? "?"}</span>
                            {" · "}{format(new Date(exp.date), "d MMM")}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-foreground">{formatFullINR(exp.total_amount)}</p>
                          {allSettled && (
                            <span className="text-[9px] text-emerald-600 font-semibold">Settled</span>
                          )}
                        </div>
                      </div>

                      {/* Per-member splits */}
                      <div className="mt-2 space-y-1">
                        {exp.splits.filter(s => s.member_id !== exp.paid_by_member_id).map(split => {
                          const m = memberById[split.member_id];
                          return (
                            <div key={split.member_id} className="flex items-center gap-1.5">
                              <div className={cn(
                                "h-1.5 w-1.5 rounded-full shrink-0",
                                split.is_settled ? "bg-emerald-400" : "bg-rose-400"
                              )} />
                              <span className="text-xs text-muted-foreground flex-1 truncate">{m?.name ?? "?"}</span>
                              <span className="text-xs font-medium">{formatFullINR(split.amount)}</span>
                              {split.is_settled && <span className="text-[9px] text-emerald-500">✓</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Actions */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="h-7 w-7 rounded-lg bg-muted/40 flex items-center justify-center pointer-events-auto shrink-0">
                          <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-white/95 backdrop-blur-md border border-white/20 shadow-xl z-50">
                        <DropdownMenuItem onClick={() => { setEditingExp(exp); setShowAddExp(true); }} className="gap-2 cursor-pointer">
                          <Edit3 className="h-3.5 w-3.5" /> Edit
                        </DropdownMenuItem>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={e => e.preventDefault()}
                              className="gap-2 cursor-pointer text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete expense?</AlertDialogTitle>
                              <AlertDialogDescription>"{exp.description}" will be permanently removed.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteExpense(exp.id)}
                                className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Dialogs */}
      <AddExpenseDialog
        open={showAddExp}
        onClose={() => { setShowAddExp(false); setEditingExp(null); }}
        members={members}
        onSave={handleSaveExpense}
        initial={editingExp ? {
          id: editingExp.id,
          description: editingExp.description,
          total_amount: editingExp.total_amount,
          paid_by_member_id: editingExp.paid_by_member_id,
          date: editingExp.date,
          splits: editingExp.splits,
        } : undefined}
      />

      <CreateGroupDialog
        open={showEditGrp}
        onClose={() => setShowEditGrp(false)}
        onSave={handleSaveGroup}
        initial={{ id: group.id, name: group.name, emoji: group.emoji, members: group.members.filter(m => m.id !== YOU_ID) }}
      />
    </div>
  );
};
