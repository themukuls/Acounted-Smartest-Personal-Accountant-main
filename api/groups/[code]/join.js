const { v4: uuidv4 } = require('uuid');
const { findGroupByCode, writeGroup, CORS } = require('../../_github');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  CORS['Access-Control-Allow-Origin']);
  res.setHeader('Access-Control-Allow-Methods', CORS['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', CORS['Access-Control-Allow-Headers']);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code is required.' });

  const { name, phone } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required to join.' });

  try {
    const result = await findGroupByCode(code);
    if (!result) return res.status(404).json({ error: 'Group not found. Check the invite code.' });
    const { data: group, sha } = result;
    const now = new Date().toISOString();

    const existing = group.members.find(m =>
      (phone && m.phone && m.phone === phone.replace(/\D/g, '')) ||
      m.name.toLowerCase() === name.trim().toLowerCase()
    );

    if (existing) return res.status(200).json({ memberId: existing.id, group, alreadyMember: true });

    const memberId = uuidv4();
    group.members.push({ id: memberId, name: name.trim(), phone: phone ? phone.replace(/\D/g, '') : '', joined_at: now });
    group.updated_at = now;
    await writeGroup(group.id, group, sha);
    return res.status(201).json({ memberId, group, alreadyMember: false });
  } catch (e) {
    console.error('[join]', e);
    return res.status(500).json({ error: e.message ?? 'Failed to join group.' });
  }
};
