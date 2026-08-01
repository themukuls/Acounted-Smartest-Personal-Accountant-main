const { findGroupByCode, writeGroup, CORS } = require('../../_github');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  CORS['Access-Control-Allow-Origin']);
  res.setHeader('Access-Control-Allow-Methods', CORS['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', CORS['Access-Control-Allow-Headers']);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code is required.' });

  const { from_member_id, to_member_id } = req.body;
  if (!from_member_id || !to_member_id) return res.status(400).json({ error: 'from_member_id and to_member_id required.' });

  try {
    const result = await findGroupByCode(code);
    if (!result) return res.status(404).json({ error: 'Group not found.' });
    const { data: group, sha } = result;
    const now = new Date().toISOString();
    let settledCount = 0;

    for (const exp of group.expenses) {
      if (exp.paid_by_member_id !== to_member_id) continue;
      for (const split of exp.splits) {
        if (split.member_id === from_member_id && !split.is_settled) {
          split.is_settled = true;
          exp.updated_at = now;
          settledCount++;
        }
      }
    }
    if (settledCount > 0) group.settlements.push({ from_member_id, to_member_id, settled_at: now });
    group.updated_at = now;
    await writeGroup(group.id, group, sha);
    return res.status(200).json({ settled: settledCount });
  } catch (e) {
    console.error('[settle]', e);
    return res.status(500).json({ error: e.message ?? 'Failed to settle.' });
  }
};
