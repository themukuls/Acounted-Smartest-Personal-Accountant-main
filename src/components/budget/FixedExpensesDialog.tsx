"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Trash2, Plus, Edit3, Save, X } from "lucide-react";
import { formatFullINR } from "@/lib/currency";

interface ExpenseCategory {
  id: string;
  category_name: string;
  amount: number;
  frequency: string;
  category_type: string;
}

interface EditingData {
  category_name: string;
  amount: string;
}

interface FixedExpensesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixedExpenses: ExpenseCategory[];
  editingCategory: string | null;
  editingData: EditingData;
  handleStartEdit: (category: ExpenseCategory) => void;
  handleCancelEdit: () => void;
  handleSaveEdit: (id: string) => Promise<void>;
  handleDeleteCategory: (id: string, categoryName: string) => Promise<void>;
  onEditingDataChange: (field: keyof EditingData, value: string) => void; // NEW PROP
}

export const FixedExpensesDialog = ({
  open,
  onOpenChange,
  fixedExpenses,
  editingCategory,
  editingData,
  handleStartEdit,
  handleCancelEdit,
  handleSaveEdit,
  handleDeleteCategory,
  onEditingDataChange, // Destructure new prop
}: FixedExpensesDialogProps) => {

  const renderExpenseItem = (category: ExpenseCategory) => {
    const isEditing = editingCategory === category.id;

    return (
      <div key={category.id} className="flex items-center justify-between p-3 rounded-lg bg-background/50">
        {isEditing ? (
          <div className="flex-1 flex flex-col sm:grid sm:grid-cols-2 gap-2 mr-3">
            <Input
              value={editingData.category_name}
              onChange={(e) => onEditingDataChange('category_name', e.target.value)} // Use new prop
              className="text-sm pointer-events-auto"
              placeholder="Category name"
            />
            <Input
              type="number"
              value={editingData.amount}
              onChange={(e) => onEditingDataChange('amount', e.target.value)} // Use new prop
              className="text-sm pointer-events-auto"
              placeholder="Amount"
            />
          </div>
        ) : (
          <div>
            <div className="font-medium text-foreground">{category.category_name}</div>
            <div className="text-sm text-muted-foreground">{formatFullINR(category.amount)}</div>
            <div className="text-xs text-muted-foreground opacity-70">From onboarding</div>
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
                      Are you sure you want to save these changes to "{editingData.category_name}"?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="pointer-events-auto">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleSaveEdit(category.id)} className="pointer-events-auto">
                      Save Changes
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancelEdit}
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
                onClick={() => handleStartEdit(category)}
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
                    <AlertDialogTitle>Delete Category</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{category.category_name}"? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="pointer-events-auto">Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => handleDeleteCategory(category.id, category.category_name)}
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
          <DialogTitle className="text-2xl font-bold gradient-text">Fixed Expenses</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            These are your recurring expenses set during onboarding.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          {fixedExpenses.length > 0 ? (
            fixedExpenses.map((category) => renderExpenseItem(category))
          ) : (
            <div className="text-center py-8">
              <div className="text-2xl mb-2">🏠</div>
              <p className="text-sm text-muted-foreground">No fixed expenses found.</p>
              <p className="text-xs text-muted-foreground mt-1">Complete onboarding to set up fixed expenses.</p>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button onClick={() => onOpenChange(false)} className="pointer-events-auto">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};