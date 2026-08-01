/**
 * taxSimulationService.ts
 *
 * Manages named tax simulations — up to 5 per user.
 * Each simulation is a pair of records: one in ai_tax_planner_input
 * and one in ai_tax_planner_output, linked by a shared simulation_id.
 *
 * Uses localStorage as a lightweight index so we can list simulations
 * without scanning the stores (fast reads, no extra store needed).
 */

import { get, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

export const MAX_SIMULATIONS = 5;

// ── Simulation index stored in localStorage ───────────────────────────────────
export interface SimulationMeta {
  simulation_id: string;
  name: string;
  created_at: string;
  input_id: string;    // id in ai_tax_planner_input
  output_id: string;   // id in ai_tax_planner_output
  // Quick-preview fields (no need to fetch full record)
  regime: 'new' | 'old' | '';
  gross_income: number;
  tax_saved?: number;
}

const indexKey = (userId: string) => `acounted_simulations_${userId}`;

export function listSimulations(userId: string): SimulationMeta[] {
  try {
    const raw = localStorage.getItem(indexKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SimulationMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveIndex(userId: string, sims: SimulationMeta[]) {
  localStorage.setItem(indexKey(userId), JSON.stringify(sims));
}

// ── Save a new simulation ─────────────────────────────────────────────────────
export async function saveSimulation(
  userId: string,
  name: string,
  inputData: Record<string, any>,
  outputData: any,
  preview: Pick<SimulationMeta, 'regime' | 'gross_income' | 'tax_saved'>
): Promise<{ ok: boolean; error?: string }> {
  const existing = listSimulations(userId);
  if (existing.length >= MAX_SIMULATIONS) {
    return { ok: false, error: `You've reached the ${MAX_SIMULATIONS} simulation limit. Delete an old one to save a new simulation.` };
  }

  const simulation_id = uuidv4();
  const now           = new Date().toISOString();

  // Save input record
  const inputId = uuidv4();
  const inputRecord = {
    ...inputData,
    id:            inputId,
    user_id:       userId,
    simulation_id,
    created_at:    now,
    updated_at:    now,
  };
  await put('ai_tax_planner_input', inputRecord);

  // Save output record
  const outputId = uuidv4();
  const outputRecord = {
    id:                  outputId,
    user_id:             userId,
    simulation_id,
    recommendations_json: outputData,
    created_at:           now,
    updated_at:           now,
  };
  await put('ai_tax_planner_output', outputRecord);

  // Update index
  const meta: SimulationMeta = {
    simulation_id,
    name:       name.trim(),
    created_at: now,
    input_id:   inputId,
    output_id:  outputId,
    ...preview,
  };
  saveIndex(userId, [...existing, meta]);

  return { ok: true };
}

// ── Load a simulation (returns input + output) ────────────────────────────────
export async function loadSimulation(
  userId: string,
  simulation_id: string
): Promise<{ input: any; output: any } | null> {
  const sims = listSimulations(userId);
  const meta = sims.find(s => s.simulation_id === simulation_id);
  if (!meta) return null;

  const inputRecord  = await get<Record<string, any>>('ai_tax_planner_input',  meta.input_id);
  const outputRecord = await get<Record<string, any>>('ai_tax_planner_output', meta.output_id);

  if (!inputRecord || !outputRecord) return null;
  return { input: inputRecord, output: outputRecord.recommendations_json };
}

// ── Delete a simulation ───────────────────────────────────────────────────────
export async function deleteSimulation(
  userId: string,
  simulation_id: string
): Promise<void> {
  const sims = listSimulations(userId);
  const meta = sims.find(s => s.simulation_id === simulation_id);
  if (!meta) return;

  // Delete both records
  try {
    await remove('ai_tax_planner_input', meta.input_id);
  } catch { /* record may not exist */ }

  try {
    await remove('ai_tax_planner_output', meta.output_id);
  } catch { /* record may not exist */ }

  // Remove from index
  saveIndex(userId, sims.filter(s => s.simulation_id !== simulation_id));
}
