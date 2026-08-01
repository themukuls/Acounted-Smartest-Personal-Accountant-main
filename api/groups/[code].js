const { findGroupByCode, CORS } = require('../_github');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  CORS['Access-Control-Allow-Origin']);
  res.setHeader('Access-Control-Allow-Methods', CORS['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', CORS['Access-Control-Allow-Headers']);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code is required.' });

  try {
    const result = await findGroupByCode(code);
    if (!result) return res.status(404).json({ error: 'Group not found. Check the invite code.' });
    return res.status(200).json(result.data);
  } catch (e) {
    console.error('[fetch group]', e);
    return res.status(500).json({ error: e.message ?? 'Failed to fetch group.' });
  }
};
