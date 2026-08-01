import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2, Play, Plus, Lock, ChevronRight, Sparkles } from "lucide-react";
import { formatCompactINR } from "@/lib/currency";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  listSimulations, deleteSimulation, MAX_SIMULATIONS, SimulationMeta,
} from "@/integrations/indexeddb/services/taxSimulationService";
import { useToast } from "@/hooks/use-toast";

interface SimulationListCardProps {
  userId: string;
  onLoad:   (simulationId: string) => void;
  onNew:    () => void;
  onRefresh?: () => void;
}

export const SimulationListCard = ({
  userId, onLoad, onNew, onRefresh,
}: SimulationListCardProps) => {
  const { toast } = useToast();
  const [sims,        setSims]        = useState<SimulationMeta[]>(() => listSimulations(userId));
  const [confirmDel,  setConfirmDel]  = useState<string | null>(null);
  const [deleting,    setDeleting]    = useState<string | null>(null);

  const refresh = () => {
    setSims(listSimulations(userId));
    onRefresh?.();
  };

  const handleDelete = async (sim: SimulationMeta) => {
    setDeleting(sim.simulation_id);
    try {
      await deleteSimulation(userId, sim.simulation_id);
      toast({ title: `"${sim.name}" deleted` });
      refresh();
    } catch {
      toast({ title: "Couldn't delete simulation", variant: "destructive" });
    } finally {
      setDeleting(null);
      setConfirmDel(null);
    }
  };

  const atLimit   = sims.length >= MAX_SIMULATIONS;
  const remaining = MAX_SIMULATIONS - sims.length;

  return (
    <div className="space-y-3">

      {/* Saved simulations */}
      {sims.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Saved simulations ({sims.length}/{MAX_SIMULATIONS})
          </p>
          <AnimatePresence>
            {sims.map((sim, idx) => (
              <motion.div key={sim.simulation_id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: idx * 0.06 }}
                className="rounded-xl border border-border/50 bg-background/60 overflow-hidden"
              >
                {/* Main row */}
                <div className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{sim.name}</p>
                      {sim.regime && (
                        <span className={cn(
                          "text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0",
                          sim.regime === "new"
                            ? "bg-primary/10 text-primary"
                            : "bg-amber-100 text-amber-700"
                        )}>
                          {sim.regime === "new" ? "New regime" : "Old regime"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        Income {formatCompactINR(sim.gross_income)}
                      </span>
                      {sim.tax_saved != null && sim.tax_saved > 0 && (
                        <>
                          <span className="text-[10px] text-muted-foreground">·</span>
                          <span className="text-[10px] text-emerald-600 font-medium">
                            Saved {formatCompactINR(sim.tax_saved)}
                          </span>
                        </>
                      )}
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(sim.created_at), "d MMM yyyy")}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <motion.button
                      onClick={() => onLoad(sim.simulation_id)}
                      whileTap={{ scale: 0.9 }}
                      className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center pointer-events-auto hover:bg-primary/20 transition-colors"
                    >
                      <Play className="h-3.5 w-3.5 text-primary fill-primary" />
                    </motion.button>
                    <motion.button
                      onClick={() => setConfirmDel(
                        confirmDel === sim.simulation_id ? null : sim.simulation_id
                      )}
                      whileTap={{ scale: 0.9 }}
                      disabled={deleting === sim.simulation_id}
                      className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center pointer-events-auto hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </motion.button>
                  </div>
                </div>

                {/* Inline delete confirm */}
                <AnimatePresence>
                  {confirmDel === sim.simulation_id && (
                    <motion.div
                      className="flex items-center justify-between gap-3 px-3 py-2.5 bg-destructive/5 border-t border-destructive/10"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                    >
                      <p className="text-xs text-destructive font-medium">Delete "{sim.name}"?</p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmDel(null)}
                          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 pointer-events-auto">
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDelete(sim)}
                          disabled={deleting === sim.simulation_id}
                          className="text-xs font-semibold text-white bg-destructive rounded-lg px-3 py-1 pointer-events-auto"
                        >
                          {deleting === sim.simulation_id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* New simulation button */}
      <motion.button
        onClick={atLimit ? undefined : onNew}
        whileTap={atLimit ? {} : { scale: 0.97 }}
        className={cn(
          "w-full flex items-center justify-between gap-3 rounded-2xl border-2 p-4 transition-all pointer-events-auto",
          atLimit
            ? "border-border/40 bg-muted/30 cursor-default opacity-70"
            : "border-dashed border-primary/30 hover:border-primary/50 hover:bg-primary/5"
        )}
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
            atLimit ? "bg-muted" : "bg-primary/10"
          )}>
            {atLimit
              ? <Lock className="h-4 w-4 text-muted-foreground" />
              : <Plus className="h-4 w-4 text-primary" />
            }
          </div>
          <div className="text-left">
            <p className={cn("text-sm font-semibold", atLimit ? "text-muted-foreground" : "text-foreground")}>
              {atLimit ? "Simulation limit reached" : "New simulation"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {atLimit
                ? `Delete an existing simulation to create a new one`
                : `${remaining} of ${MAX_SIMULATIONS} slots available`}
            </p>
          </div>
        </div>
        {!atLimit && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </motion.button>

      {/* Empty state */}
      {sims.length === 0 && (
        <div className="text-center py-2">
          <p className="text-xs text-muted-foreground">
            Run your first tax simulation — compare new vs old regime,
            find deductions, and see exactly what you owe.
          </p>
        </div>
      )}
    </div>
  );
};
