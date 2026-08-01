import type { MyDB } from '../db';
import { getAllByIndex, get, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

export type LendrGroup   = MyDB['lendr_groups']['value'];
export type LendrExpense = MyDB['lendr_expenses']['value'];
export type Member       = { id: string; name: string; phone: string };
export type Split        = { member_id: string; amount: number; is_settled: boolean };

// ─── Simplified balance between two members ────────────────────────────────
export interface SettlementEntry {
  from_member_id:   string;
  from_member_name: string;
  to_member_id:     string;
  to_member_name:   string;
  amount:           number;
  phone:            string; // phone of the person to pay (to_member)
}

// ─── Groups ────────────────────────────────────────────────────────────────

export async function getGroups(userId: string): Promise<LendrGroup[]> {
  const all = await getAllByIndex<LendrGroup>('lendr_groups', 'user_id', userId);
  return all.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export async function getGroup(groupId: string): Promise<LendrGroup | null> {
  return (await get<LendrGroup>('lendr_groups', groupId)) ?? null;
}

export async function saveGroup(
  userId: string,
  data: { id?: string; name: string; emoji: string; members: Member[] },
): Promise<LendrGroup> {
  const now = new Date().toISOString();

  let record: LendrGroup;
  if (data.id) {
    const existing = await get<LendrGroup>('lendr_groups', data.id);
    record = existing
      ? { ...existing, name: data.name, emoji: data.emoji, members: data.members, updated_at: now }
      : { id: data.id, user_id: userId, name: data.name, emoji: data.emoji, members: data.members, created_at: now, updated_at: now };
    await put('lendr_groups', record);
  } else {
    record = { id: uuidv4(), user_id: userId, name: data.name, emoji: data.emoji, members: data.members, created_at: now, updated_at: now };
    await put('lendr_groups', record);
  }
  return record;
}

export async function deleteGroup(groupId: string): Promise<void> {
  // Delete group + all its expenses (the old single-transaction cascade,
  // now expressed as separate repository calls).
  const expenses = await getExpenses(groupId);
  await remove('lendr_groups', groupId);
  for (const e of expenses) await remove('lendr_expenses', e.id);
}

// ─── Expenses ──────────────────────────────────────────────────────────────

export async function getExpenses(groupId: string): Promise<LendrExpense[]> {
  const all = await getAllByIndex<LendrExpense>('lendr_expenses', 'group_id', groupId);
  return all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function saveExpense(
  userId: string,
  data: {
    id?: string;
    group_id: string;
    description: string;
    total_amount: number;
    paid_by_member_id: string;
    date: string;
    splits: Split[];
  },
): Promise<LendrExpense> {
  const now = new Date().toISOString();

  let record: LendrExpense;
  if (data.id) {
    const existing = await get<LendrExpense>('lendr_expenses', data.id);
    record = existing
      ? { ...existing, ...data, updated_at: now }
      : { id: data.id, user_id: userId, created_at: now, updated_at: now, ...data };
    await put('lendr_expenses', record);
  } else {
    record = { id: uuidv4(), user_id: userId, created_at: now, updated_at: now, ...data };
    await put('lendr_expenses', record);
  }

  // Touch group updated_at so it bubbles to top of list
  const group = await get<LendrGroup>('lendr_groups', data.group_id);
  if (group) await put('lendr_groups', { ...group, updated_at: now });

  return record;
}

export async function deleteExpense(expenseId: string): Promise<void> {
  await remove('lendr_expenses', expenseId);
}

// ─── Settle a specific split (member pays their share) ────────────────────

export async function settleSplit(
  expenseId: string,
  memberId: string,
  settled: boolean,
): Promise<void> {
  const exp = await get<LendrExpense>('lendr_expenses', expenseId);
  if (!exp) { return; }

  exp.splits = exp.splits.map(s =>
    s.member_id === memberId ? { ...s, is_settled: settled } : s,
  );
  exp.updated_at = new Date().toISOString();
  await put('lendr_expenses', exp);
}

// ─── Settle ALL debts between two members in a group ──────────────────────

export async function settleAllBetween(
  groupId: string,
  debtorId: string,
  creditorId: string,
): Promise<void> {
  const expenses = await getExpenses(groupId);
  const now = new Date().toISOString();

  for (const exp of expenses) {
    if (exp.paid_by_member_id !== creditorId) continue;
    const split = exp.splits.find(s => s.member_id === debtorId);
    if (!split || split.is_settled) continue;
    exp.splits = exp.splits.map(s =>
      s.member_id === debtorId ? { ...s, is_settled: true } : s,
    );
    exp.updated_at = now;
    await put('lendr_expenses', exp);
  }
}

// ─── Debt Simplification ──────────────────────────────────────────────────
// Greedy algorithm: compute net balance per member, then match
// largest debtor to largest creditor until all settled.

export function simplifyDebts(
  members: Member[],
  expenses: LendrExpense[],
): SettlementEntry[] {
  // Net balance: positive = owed money, negative = owes money
  const net: Record<string, number> = {};
  for (const m of members) net[m.id] = 0;

  for (const exp of expenses) {
    for (const split of exp.splits) {
      if (split.is_settled) continue;
      if (!net[split.member_id] && net[split.member_id] !== 0) continue;
      // Payer gets credit
      net[exp.paid_by_member_id] = (net[exp.paid_by_member_id] ?? 0) + split.amount;
      // Each person with a split owes their share
      net[split.member_id] = (net[split.member_id] ?? 0) - split.amount;
    }
  }

  const memberById = Object.fromEntries(members.map(m => [m.id, m]));

  // Separate into creditors (net > 0) and debtors (net < 0)
  const creditors: Array<{ id: string; amount: number }> = [];
  const debtors:   Array<{ id: string; amount: number }> = [];

  for (const [id, amount] of Object.entries(net)) {
    if (amount > 0.5)  creditors.push({ id, amount });
    if (amount < -0.5) debtors.push({ id, amount: -amount });
  }

  // Sort descending by amount
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b)   => b.amount - a.amount);

  const settlements: SettlementEntry[] = [];

  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor   = debtors[di];
    const amount   = Math.min(creditor.amount, debtor.amount);

    if (amount > 0.5) {
      settlements.push({
        from_member_id:   debtor.id,
        from_member_name: memberById[debtor.id]?.name ?? debtor.id,
        to_member_id:     creditor.id,
        to_member_name:   memberById[creditor.id]?.name ?? creditor.id,
        amount:           Math.round(amount * 100) / 100,
        phone:            memberById[creditor.id]?.phone ?? '',
      });
    }

    creditor.amount -= amount;
    debtor.amount   -= amount;

    if (creditor.amount < 0.5) ci++;
    if (debtor.amount   < 0.5) di++;
  }

  return settlements;
}

// ─── Summary helpers ───────────────────────────────────────────────────────

export interface GroupSummary {
  total_spend:   number;
  you_owe:       number;   // how much "You" owes others
  you_receive:   number;   // how much others owe "You"
  expense_count: number;
}

// "You" is always the member whose name is "You"
export function getGroupSummary(
  members: Member[],
  expenses: LendrExpense[],
  youMemberId: string,
): GroupSummary {
  let total_spend = 0, you_owe = 0, you_receive = 0;

  for (const exp of expenses) {
    total_spend += exp.total_amount;
    for (const split of exp.splits) {
      if (split.is_settled) continue;
      if (split.member_id === youMemberId && exp.paid_by_member_id !== youMemberId) {
        you_owe += split.amount;
      }
      if (exp.paid_by_member_id === youMemberId && split.member_id !== youMemberId) {
        you_receive += split.amount;
      }
    }
  }

  return {
    total_spend,
    you_owe:       Math.round(you_owe * 100) / 100,
    you_receive:   Math.round(you_receive * 100) / 100,
    expense_count: expenses.length,
  };
}

// ─── Split calculation helpers ────────────────────────────────────────────

export type SplitMode = 'equal' | 'exact' | 'percent' | 'shares';

export function calculateSplits(
  members: Member[],
  total: number,
  mode: SplitMode,
  inputs: Record<string, number>, // memberId → value (amount / percent / shares)
  paidByMemberId: string,
): Split[] {
  const splits: Split[] = [];

  if (mode === 'equal') {
    const each = total / members.length;
    for (const m of members) {
      splits.push({
        member_id:  m.id,
        amount:     Math.round(each * 100) / 100,
        is_settled: m.id === paidByMemberId, // payer's own share is auto-settled
      });
    }
    return splits;
  }

  if (mode === 'exact') {
    for (const m of members) {
      splits.push({
        member_id:  m.id,
        amount:     inputs[m.id] ?? 0,
        is_settled: m.id === paidByMemberId,
      });
    }
    return splits;
  }

  if (mode === 'percent') {
    for (const m of members) {
      const pct = inputs[m.id] ?? 0;
      splits.push({
        member_id:  m.id,
        amount:     Math.round((total * pct / 100) * 100) / 100,
        is_settled: m.id === paidByMemberId,
      });
    }
    return splits;
  }

  if (mode === 'shares') {
    const totalShares = Object.values(inputs).reduce((s, v) => s + v, 0) || 1;
    for (const m of members) {
      const sh = inputs[m.id] ?? 1;
      splits.push({
        member_id:  m.id,
        amount:     Math.round((total * sh / totalShares) * 100) / 100,
        is_settled: m.id === paidByMemberId,
      });
    }
    return splits;
  }

  return splits;
}


// ═══════════════════════════════════════════════════════════════════════════
// ONLINE SYNC — GitHub via Vercel API routes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base URL for the shared-group API.
 *
 * On the web this is a same-origin relative path. Inside the Android app the
 * page is served from https://localhost, so a relative '/api/groups' resolves
 * to the WebView itself and every request 404s — the online-group feature
 * silently stops working. Native builds therefore need an absolute origin,
 * supplied at build time by VITE_API_BASE_URL (set it to the deployed Vercel
 * origin, e.g. https://acounted.vercel.app).
 */
const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const API_BASE = `${API_ORIGIN}/api/groups`;

export interface OnlineGroup {
  id:          string;
  code:        string;
  name:        string;
  emoji:       string;
  members:     Member[];
  expenses:    LendrExpense[];
  settlements: Array<{ from_member_id: string; to_member_id: string; settled_at: string }>;
  created_at:  string;
  updated_at:  string;
}

// ─── Create a new online group ────────────────────────────────────────────
export async function createOnlineGroup(
  name: string,
  emoji: string,
  members: Member[],
): Promise<{ groupId: string; code: string }> {
  const res = await fetch(`${API_BASE}/create`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name, emoji, members }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to create group.');
  }
  return res.json();
}

// ─── Fetch group by invite code ───────────────────────────────────────────
export async function fetchOnlineGroup(code: string): Promise<OnlineGroup> {
  const res = await fetch(`${API_BASE}/${code.toUpperCase()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Group not found.');
  }
  return res.json();
}

// ─── Join a group ─────────────────────────────────────────────────────────
export async function joinOnlineGroup(
  code: string,
  name: string,
  phone: string,
): Promise<{ memberId: string; group: OnlineGroup; alreadyMember: boolean }> {
  const res = await fetch(`${API_BASE}/${code.toUpperCase()}/join`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name, phone }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to join group.');
  }
  return res.json();
}

// ─── Push a new expense ───────────────────────────────────────────────────
export async function pushExpense(
  code: string,
  expense: Omit<LendrExpense, 'id' | 'user_id' | 'created_at' | 'updated_at'> & { added_by?: string },
): Promise<LendrExpense> {
  const res = await fetch(`${API_BASE}/${code}/expense`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(expense),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to add expense.');
  }
  return res.json();
}

// ─── Edit an expense ─────────────────────────────────────────────────────
export async function updateOnlineExpense(
  code: string,
  id: string,
  updates: Partial<LendrExpense>,
): Promise<LendrExpense> {
  const res = await fetch(`${API_BASE}/${code}/expense`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id, ...updates }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to update expense.');
  }
  return res.json();
}

// ─── Delete an expense ────────────────────────────────────────────────────
export async function deleteOnlineExpense(code: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${code}/expense`, {
    method:  'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to delete expense.');
  }
}

// ─── Mark all debts settled between two members ───────────────────────────
export async function pushSettlement(
  code: string,
  from_member_id: string,
  to_member_id: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/${code}/settle`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from_member_id, to_member_id }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to settle.');
  }
}

// ─── Store online group reference in local IndexedDB ─────────────────────
// We store just the code + memberId locally so the app knows
// which online groups this user is part of.
const ONLINE_GROUPS_KEY = 'lendr_online_groups';

export interface OnlineGroupRef {
  code:       string;
  groupId:    string;
  memberId:   string;
  name:       string;
  emoji:      string;
  lastSynced: string;
}

export function getOnlineGroupRefs(): OnlineGroupRef[] {
  try {
    return JSON.parse(localStorage.getItem(ONLINE_GROUPS_KEY) ?? '[]');
  } catch { return []; }
}

export function saveOnlineGroupRef(ref: OnlineGroupRef): void {
  const refs  = getOnlineGroupRefs().filter(r => r.code !== ref.code);
  refs.unshift(ref);
  localStorage.setItem(ONLINE_GROUPS_KEY, JSON.stringify(refs));
}

export function removeOnlineGroupRef(code: string): void {
  const refs = getOnlineGroupRefs().filter(r => r.code !== code);
  localStorage.setItem(ONLINE_GROUPS_KEY, JSON.stringify(refs));
}
