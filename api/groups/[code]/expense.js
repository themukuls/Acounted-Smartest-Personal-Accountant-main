const { v4: uuidv4 } = require('uuid');
const { findGroupByCode, writeGroup, CORS } = require('../../_github');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  CORS['Access-Control-Allow-Origin']);
  res.setHeader('Access-Control-Allow-Methods', CORS['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', CORS['Access-Control-Allow-Headers']);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['POST','PUT','DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code is required.' });

  try {
    const result = await findGroupByCode(code);
    if (!result) return res.status(404).json({ error: 'Group not found.' });
    const { data: group, sha } = result;
    const now = new Date().toISOString();

    if (req.method === 'POST') {
      const expense = {
        id: uuidv4(), description: req.body.description,
        total_amount: req.body.total_amount, paid_by_member_id: req.body.paid_by_member_id,
        date: req.body.date ?? now, splits: req.body.splits ?? [],
        added_by: req.body.added_by ?? '', created_at: now, updated_at: now,
      };
      group.expenses.push(expense);
      group.updated_at = now;
      await writeGroup(group.id, group, sha);
      return res.status(201).json(expense);
    }
    if (req.method === 'PUT') {
      const { id, ...updates } = req.body;
      if (!id) return res.status(400).json({ error: 'Expense id required.' });
      const idx = group.expenses.findIndex(e => e.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Expense not found.' });
      group.expenses[idx] = { ...group.expenses[idx], ...updates, updated_at: now };
      group.updated_at = now;
      await writeGroup(group.id, group, sha);
      return res.status(200).json(group.expenses[idx]);
    }
    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Expense id required.' });
      group.expenses = group.expenses.filter(e => e.id !== id);
      group.updated_at = now;
      await writeGroup(group.id, group, sha);
      return res.status(200).json({ deleted: id });
    }
  } catch (e) {
    console.error('[expense]', e);
    return res.status(500).json({ error: e.message ?? 'Failed to update expense.' });
  }
};
