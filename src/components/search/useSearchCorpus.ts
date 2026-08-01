/**
 * useSearchCorpus — flattens every searchable store into one list.
 *
 * Transactions are the point of the feature; udhar entries and Recall products
 * are here because a user searching "Rahul" or "washing machine" has no idea
 * which screen the app filed it under, and being told "no results" while the
 * record exists two tabs away is the worst possible answer.
 *
 * Loaded once per open and cached by react-query. The repository already holds
 * these stores in memory after first touch, so this is an array copy rather
 * than disk I/O.
 */

import { useQuery } from '@tanstack/react-query';
import { getAllByIndex } from '@/integrations/storage/repository';
import { useAuth } from '@/contexts/AuthContext';
import { categoryLabel } from '@/lib/categories';
import { amountForms, buildSearchText, type SearchRecord } from './searchCore';

export const SEARCH_CORPUS_QUERY_KEY = 'globalSearchCorpus';

const PAYMENT_LABELS: Record<string, string> = {
  upi: 'UPI',
  cash: 'Cash',
  'bank-transfer': 'Bank transfer',
  'credit-card': 'Credit card',
  'debit-card': 'Debit card',
};

const paymentLabel = (slug: string | null): string =>
  slug ? (PAYMENT_LABELS[slug] ?? slug.replace(/-/g, ' ')) : '';

/** Strip the sanitised HTML the app stores descriptions as. */
const plain = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';

function toTransactionRecord(row: Record<string, unknown>): SearchRecord {
  const amount = Number(row.amount) || 0;
  const category = String(row.category ?? 'others');
  const account = row.account ? String(row.account) : null;
  const description = plain(row.description);
  const type = row.type === 'income' ? 'income' : 'expense';

  return {
    id: `txn:${String(row.id)}`,
    kind: 'transaction',
    // Descriptions are optional in this app; falling back to the category label
    // means a row without a note is still findable and still readable.
    title: description || categoryLabel(category),
    subtitle: buildSearchText([categoryLabel(category), paymentLabel(account)]),
    amount,
    date: String(row.transaction_date),
    type,
    category,
    account,
    // Slug AND label for both category and payment method: users type "bank"
    // or "Bank transfer", never "bank-transfer".
    searchText: buildSearchText([
      description,
      category,
      categoryLabel(category),
      account,
      paymentLabel(account),
      type,
    ]),
    amountText: amountForms(amount),
  };
}

function toUdharRecord(row: Record<string, unknown>): SearchRecord {
  const amount = Number(row.amount) || 0;
  const paid = Number(row.amount_paid) || 0;
  const outstanding = Math.max(0, amount - paid);
  const isGiven = row.type === 'given';
  const person = plain(row.person_name) || plain(row.lender_name) || 'Someone';
  const settled = !!row.is_settled || outstanding === 0;

  return {
    id: `udhar:${String(row.id)}`,
    kind: 'udhar',
    title: person,
    subtitle: buildSearchText([
      isGiven ? 'Lent' : 'Borrowed',
      settled ? 'settled' : 'outstanding',
    ]),
    amount: outstanding,
    date: String(row.due_date ?? row.created_at ?? new Date().toISOString()),
    type: null,
    category: null,
    account: null,
    searchText: buildSearchText([
      person,
      plain(row.description),
      plain(row.phone_number),
      isGiven ? 'lent given udhar' : 'borrowed taken udhar',
      settled ? 'settled' : 'pending outstanding',
    ]),
    amountText: amountForms(outstanding),
  };
}

function toRecallRecord(row: Record<string, unknown>): SearchRecord {
  const price = Number(row.purchase_price) || 0;
  const name = plain(row.name) || 'Product';

  return {
    id: `recall:${String(row.id)}`,
    kind: 'recall',
    title: name,
    subtitle: buildSearchText([plain(row.brand), plain(row.category)]),
    amount: price,
    date: String(row.purchase_date ?? row.created_at ?? new Date().toISOString()),
    type: null,
    category: null,
    account: null,
    searchText: buildSearchText([
      name,
      plain(row.brand),
      plain(row.model_number),
      plain(row.serial_number),
      plain(row.purchased_from),
      plain(row.category),
      plain(row.notes),
      'warranty product recall',
    ]),
    amountText: amountForms(price),
  };
}

export function useSearchCorpus(enabled: boolean) {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: [SEARCH_CORPUS_QUERY_KEY, userId],
    enabled: enabled && !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<SearchRecord[]> => {
      // Fetched together so one slow store doesn't stagger the list in.
      const [transactions, udhar, recall] = await Promise.all([
        getAllByIndex<Record<string, unknown>>('transactions', 'user_id', userId!),
        getAllByIndex<Record<string, unknown>>('udhar_entries', 'user_id', userId!),
        getAllByIndex<Record<string, unknown>>('recall_products', 'user_id', userId!),
      ]);

      return [
        ...transactions.map(toTransactionRecord),
        ...udhar.map(toUdharRecord),
        ...recall.map(toRecallRecord),
      ];
    },
  });
}
