"use client";

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Trash2, Plus, Edit3, Save, X, TrendingUp } from "lucide-react"; // Added TrendingUp
import { formatFullINR } from "@/lib/currency";
import { format } from "date-fns";

interface VariableBudgetEntry {
  id: string;
  category_name: string;
  allocated_amount: number;
  budget_month: string;
  notes?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

interface EditingBudgetData {
  category_name: string;
  allocated_amount: string;
  notes: string;
}

interface VariableBudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variableBudgetEntries: VariableBudgetEntry[];
  budgetDateRange: { startDate: Date; endDate: Date };
  newVariableBudgetEntry: { category_name: string; allocated_amount: string; notes: string };
  setNewVariableBudgetEntry: React.Dispatch<React.SetStateAction<{ category_name: string; allocated_amount: string; notes: string }>>;
  handleAddVariableBudgetEntry: () => Promise<void>;
  handleDeleteVariableBudgetEntry: (id: string, categoryName: string) => Promise<void>;
  handleStartEditBudgetEntry: (entry: VariableBudgetEntry) => void;
  handleCancelEditBudgetEntry: () => void;
  handleSaveEditBudgetEntry: (id: string) => Promise<void>;
  editingBudgetEntry: string | null;
  editingBudgetData: EditingBudgetData;
  onEditingBudgetDataChange: (field: keyof EditingBudgetData, value: string) => void; // NEW PROP
}

export const VariableBudgetDialog = ({
  open,
  onOpenChange,
  variableBudgetEntries,
  budgetDateRange,
  newVariableBudgetEntry,
  setNewVariableBudgetEntry,
  handleAddVariableBudgetEntry,
  handleDeleteVariableBudgetEntry,
  handleStartEditBudgetEntry,
  handleCancelEditBudgetEntry,
  handleSaveEditBudgetEntry,
  editingBudgetEntry,
  editingBudgetData,
  onEditingBudgetDataChange, // Destructure new prop
}: VariableBudgetDialogProps) => {

  const getBudgetPeriodLabel = () => {
    return `${format(budgetDateRange.startDate, 'MMM dd')} - ${format(budgetDateRange.endDate, 'MMM dd, yyyy')}`;
  };

  const renderVariableBudgetEntry = (entry: VariableBudgetEntry) => {
    const isEditing = editingBudgetEntry === entry.id;

    return (
      <div key={entry.id} className="flex items-center justify-between p-3 rounded-lg bg-background/50">
        {isEditing ? (
          <div className="flex-1 flex flex-col sm:grid sm:grid-cols-2 gap-2 mr-3">
            <Input
              value={editingBudgetData.category_name}
              onChange={(e) => onEditingBudgetDataChange('category_name', e.target.value)} // Use new prop
              className="text-sm pointer-events-auto"
              placeholder="Category name"
            />
            <Input
              type="number"
              value={editingBudgetData.allocated_amount}
              onChange={(e) => onEditingBudgetDataChange('allocated_amount', e.target.value)} // Use new prop
              className="text-sm pointer-events-auto"
              placeholder="Amount"
            />
          </div>
        ) : (
          <div>
            <div className="font-medium text-foreground">{entry.category_name}</div>
            <div className="text-sm text-muted-foreground">{formatFullINR(entry.allocated_amount)}</div>
            {entry.notes && <div className="text-xs text-muted-foreground opacity-70">{entry.notes}</div>}
          </div>
        )}
        
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-green-600 pointer-events-auto">
                    <Save className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="pointer-events-auto">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to save these changes to "{editingBudgetData.category_name}"?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="pointer-events-auto">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleSaveEditBudgetEntry(entry.id)} className="pointer-events-auto">
                      Save Changes
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancelEditBudgetEntry}
                className="h-8 w-8 p-0 pointer-events-auto"
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleStartEditBudgetEntry(entry)}
                className="h-8 w-8 p-0 pointer-events-auto"
              >
                <Edit3 className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive pointer-events-auto"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="pointer-events-auto">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Budget Entry</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{entry.category_name}" budget entry? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="pointer-events-auto">Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => handleDeleteVariableBudgetEntry(entry.id, entry.category_name)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90 pointer-events-auto"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-md max-h-[80vh] overflow-y-auto bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl pointer-events-auto"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold gradient-text">Variable Budget for {format(budgetDateRange.startDate, 'MMMM yyyy')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Manage your flexible spending categories for the current period.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Add New Variable Budget Entry */}
          <div className="bg-primary/5 p-4 rounded-lg border border-primary/10">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2 mb-3">
              <Plus className="h-4 w-4" />
              Add New Entry
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label htmlFor="new-budget-category-name" className="text-sm">Category Name</Label>
                <Input
                  id="new-budget-category-name"
                  value={newVariableBudgetEntry.category_name}
                  onChange={(e) => setNewVariableBudgetEntry({...newVariableBudgetEntry, category_name: e.target.value})}
                  placeholder="e.g., Groceries, Entertainment"
                  className="glass-input pointer-events-auto"
                />
              </div>

              <div>
                <Label htmlFor="new-budget-amount" className="text-sm">Allocated Amount (₹)</Label>
                <Input
                  id="new-budget-amount"
                  type="number"
                  value={newVariableBudgetEntry.allocated_amount}
                  onChange={(e) => setNewVariableBudgetEntry({...newVariableBudgetEntry, allocated_amount: e.target.value})}
                  placeholder="0"
                  className="glass-input pointer-events-auto"
                />
              </div>

              <div>
                <Label htmlFor="new-budget-notes" className="text-sm">Notes (Optional)</Label>
                <Input
                  id="new-budget-notes"
                  value={newVariableBudgetEntry.notes}
                  onChange={(e) => setNewVariableBudgetEntry({...newVariableBudgetEntry, notes: e.target.value})}
                  placeholder="Additional notes"
                  className="glass-input pointer-events-auto"
                />
              </div>

              <Button 
                onClick={handleAddVariableBudgetEntry} 
                variant="outline"
                className="w-full glass-nav text-sm h-9 px-3 pointer-events-auto"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Budget Entry
              </Button>
            </div>
          </div>

          {/* Existing Variable Budget Entries */}
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Current Entries
            </h3>
            {variableBudgetEntries.length > 0 ? (
              variableBudgetEntries.map((entry) => renderVariableBudgetEntry(entry))
            ) : (
              <div className="text-center py-8">
                <div className="text-2xl mb-2">💰</div>
                <p className="text-sm text-muted-foreground">No variable budget entries yet</p>
                <p className="text-xs text-muted-foreground mt-1">Add your budget entries for {format(budgetDateRange.startDate, 'MMMM yyyy')} above</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={() => onOpenChange(false)} className="pointer-events-auto">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};