"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Edit3, Save, X, Trash2, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { getExpenseCategories, saveExpenseCategory, deleteExpenseCategory } from "@/integrations/indexeddb/services/onboardingService";
import { cn } from "@/lib/utils";

interface Category {
  id?: string; // Optional, as default categories might not have an ID initially
  category_name: string; // Internal/DB value (e.g., "food")
  displayLabel: string; // Frontend display value (e.g., "🍽️ Food & Dining")
  category_type: string; // 'fixed' or 'variable'
  amount?: number; // Optional, as dynamic categories might not have an amount initially
  frequency?: string; // Optional
}

interface CategoryManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCategoriesUpdated: () => void; // Callback to notify parent of changes
}

// Hardcoded default expense categories with display labels
const defaultExpenseCategories: Omit<Category, 'id' | 'amount' | 'frequency'>[] = [
  { category_name: "food", displayLabel: "🍽️ Food & Dining", category_type: "variable" },
  { category_name: "fuel", displayLabel: "⛽ Fuel & Transport", category_type: "variable" },
  { category_name: "entertainment", displayLabel: "🎬 Entertainment", category_type: "variable" },
  { category_name: "investment", displayLabel: "💰 Investment", category_type: "variable" },
  { category_name: "health", displayLabel: "🏥 Health & Medical", category_type: "variable" },
  { category_name: "medicine", displayLabel: "💊 Medicine", category_type: "variable" },
  { category_name: "clothing", displayLabel: "👕 Clothing & Fashion", category_type: "variable" },
  { category_name: "household", displayLabel: "🏠 Household Items", category_type: "variable" },
  { category_name: "books", displayLabel: "📚 Books & Education", category_type: "variable" },
  { category_name: "education", displayLabel: "🎓 Education & Courses", category_type: "variable" },
  { category_name: "recharge", displayLabel: "📱 Recharge & Bills", category_type: "variable" },
  { category_name: "rent", displayLabel: "🏘️ Rent & Housing", category_type: "variable" },
  { category_name: "vehicle", displayLabel: "🚗 Vehicle Maintenance", category_type: "variable" },
  { category_name: "tech-products", displayLabel: "💻 Tech Products", category_type: "variable" },
  { category_name: "professional-fee", displayLabel: "💼 Professional Fees", category_type: "variable" },
  { category_name: "trips-outings", displayLabel: "✈️ Trips & Outings", category_type: "variable" },
  { category_name: "emis", displayLabel: "💳 EMIs & Loans", category_type: "variable" },
  { category_name: "others", displayLabel: "📦 Others", category_type: "variable" },
];

export const CategoryManagementDialog = ({ isOpen, onClose, onCategoriesUpdated }: CategoryManagementDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchCategories = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const dbCategories = await getExpenseCategories(user.id);
      
      const combinedCategoriesMap = new Map<string, Category>();

      // Add DB categories first
      dbCategories.forEach(cat => {
        const defaultMatch = defaultExpenseCategories.find(d => d.category_name === cat.category_name);
        combinedCategoriesMap.set(cat.category_name.toLowerCase(), {
          id: cat.id,
          category_name: cat.category_name,
          displayLabel: defaultMatch ? defaultMatch.displayLabel : `🏷️ ${cat.category_name.replace(/-/g, ' ')}`, // Simplified here
          category_type: cat.category_type,
          amount: cat.amount,
          frequency: cat.frequency,
        });
      });

      // Add default categories if they don't already exist in the map (from DB)
      defaultExpenseCategories.forEach(defaultCat => {
        if (!combinedCategoriesMap.has(defaultCat.category_name.toLowerCase())) {
          combinedCategoriesMap.set(defaultCat.category_name.toLowerCase(), {
            ...defaultCat,
            amount: 0, // Default amount
            frequency: 'monthly', // Default frequency
          });
        }
      });

      // Filter out ALL 'fixed' categories from the display
      const filteredCategories = Array.from(combinedCategoriesMap.values()).filter(cat => 
        cat.category_type === 'variable'
      );

      // Sort categories alphabetically by displayLabel
      filteredCategories.sort((a, b) => a.displayLabel.localeCompare(b.displayLabel));

      setCategories(filteredCategories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      toast({
        title: "Error",
        description: "Failed to load categories.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (isOpen) {
      fetchCategories();
      setNewCategoryName(""); // Reset new category input
      setEditingCategoryId(null); // Reset editing state
    }
  }, [isOpen, fetchCategories]);

  const handleAddCategory = async () => {
    if (!user) return;
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) {
      toast({ title: "Error", description: "Category name cannot be empty.", variant: "destructive" });
      return;
    }
    const formattedCategoryNameForDb = trimmedName.toLowerCase().replace(/\s/g, '-');

    if (categories.some(cat => cat.category_name.toLowerCase() === formattedCategoryNameForDb)) {
      toast({ title: "Error", description: "Category with this name already exists.", variant: "destructive" });
      return;
    }

    try {
      await saveExpenseCategory(user.id, {
        category_name: formattedCategoryNameForDb,
        category_type: 'variable', // Mark as user-added/variable
        amount: 0, // Default amount
        frequency: 'monthly', // Default frequency
      });
      setNewCategoryName("");
      await fetchCategories();
      onCategoriesUpdated(); // Notify parent
      toast({ title: "Success", description: `Category '🏷️ ${trimmedName}' added.` });
    } catch (error) {
      console.error("Error adding category:", error);
      toast({ title: "Error", description: "Failed to add category.", variant: "destructive" });
    }
  };

  const handleStartEdit = (category: Category) => {
    setEditingCategoryId(category.id || category.category_name); // Use name as ID if no DB ID
    setEditingCategoryName(category.displayLabel); // Edit the display label
  };

  const handleSaveEdit = async (categoryId: string) => {
    if (!user) return;
    const trimmedName = editingCategoryName.trim();
    if (!trimmedName) {
      toast({ title: "Error", description: "Category name cannot be empty.", variant: "destructive" });
      return;
    }
    // Strip emoji and format for DB storage
    const formattedNameForDb = trimmedName.replace(/^[^\p{L}\p{N}]*\s*/u, '').toLowerCase().replace(/\s/g, '-');

    if (categories.some(cat => (cat.id || cat.category_name) !== categoryId && cat.category_name.toLowerCase() === formattedNameForDb)) {
      toast({ title: "Error", description: "Category with this name already exists.", variant: "destructive" });
      return;
    }

    try {
      const categoryToEdit = categories.find(cat => (cat.id || cat.category_name) === categoryId);
      if (!categoryToEdit) {
        toast({ title: "Error", description: "Category not found.", variant: "destructive" });
        return;
      }

      // If it's a default category without an ID, save it as a new entry first
      if (!categoryToEdit.id) {
        await saveExpenseCategory(user.id, {
          category_name: formattedNameForDb, // Save the clean internal name
          category_type: categoryToEdit.category_type,
          amount: categoryToEdit.amount || 0,
          frequency: categoryToEdit.frequency || 'monthly',
        });
      } else {
        // Otherwise, update the existing entry
        await saveExpenseCategory(user.id, {
          id: categoryToEdit.id,
          category_name: formattedNameForDb, // Save the clean internal name
          category_type: categoryToEdit.category_type,
          amount: categoryToEdit.amount,
          frequency: categoryToEdit.frequency,
        });
      }
      
      setEditingCategoryId(null);
      setEditingCategoryName("");
      await fetchCategories();
      onCategoriesUpdated(); // Notify parent
      toast({ title: "Success", description: `Category renamed to '${trimmedName}'.` });
    } catch (error) {
      console.error("Error renaming category:", error);
      toast({ title: "Error", description: "Failed to rename category.", variant: "destructive" });
    }
  };

  const handleDeleteCategory = async (categoryId: string, categoryDisplayLabel: string) => {
    if (!user) return;
    const categoryToDelete = categories.find(cat => (cat.id || cat.category_name) === categoryId);

    if (!categoryToDelete) {
      toast({ title: "Error", description: "Category not found.", variant: "destructive" });
      return;
    }

    // Only delete from DB if it has an actual DB ID
    if (categoryToDelete.id) {
      try {
        await deleteExpenseCategory(categoryToDelete.id);
        await fetchCategories();
        onCategoriesUpdated(); // Notify parent
        toast({ title: "Success", description: `Category '${categoryDisplayLabel}' deleted.` });
      } catch (error) {
        console.error("Error deleting category:", error);
        toast({ title: "Error", description: "Failed to delete category.", variant: "destructive" });
      }
    } else {
      // If it's a default category without a DB ID, just remove it from local state
      // This is handled by `fetchCategories` re-evaluating the combined list
      await fetchCategories(); // Re-fetch to remove the default category from the displayed list if it was not in DB
      onCategoriesUpdated(); // Notify parent
      toast({ title: "Success", description: `Default category '${categoryDisplayLabel}' removed from list.` });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-gradient-to-br from-white via-white to-destructive/5 border border-destructive/20 shadow-xl pointer-events-auto">
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-destructive to-destructive/70 bg-clip-text text-transparent flex items-center gap-2">
            <FolderOpen className="h-5 w-5" /> Manage Expense Categories
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Add, rename, or delete your custom expense categories.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Add New Category */}
          <div className="flex gap-2">
            <Input
              placeholder="New category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="flex-1 pointer-events-auto"
            />
            <Button onClick={handleAddCategory} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 pointer-events-auto">
              <Plus className="h-4 w-4 mr-2" /> Add
            </Button>
          </div>

          {/* Category List */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : categories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No custom categories yet. Add one above!</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
              {categories.map((category) => (
                <div key={category.id || category.category_name} className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/50">
                  {editingCategoryId === (category.id || category.category_name) ? (
                    <Input
                      value={editingCategoryName}
                      onChange={(e) => setEditingCategoryName(e.target.value)}
                      className="flex-1 mr-2 text-sm pointer-events-auto"
                    />
                  ) : (
                    <span className="font-medium text-foreground text-sm">
                      {category.displayLabel}
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    {editingCategoryId === (category.id || category.category_name) ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => handleSaveEdit(category.id || category.category_name)} className="h-8 w-8 p-0 text-green-600 pointer-events-auto">
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingCategoryId(null)} className="h-8 w-8 p-0 pointer-events-auto">
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => handleStartEdit(category)} className="h-8 w-8 p-0 pointer-events-auto">
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive pointer-events-auto">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="pointer-events-auto">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Category</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{category.displayLabel}"? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="pointer-events-auto">Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDeleteCategory(category.id || category.category_name, category.displayLabel)}
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
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t border-border/50">
          <Button onClick={onClose} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 pointer-events-auto">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};