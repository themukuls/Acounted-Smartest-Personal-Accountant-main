const { v4: uuidv4 } = require('uuid');
const { writeGroup, generateCode, CORS } = require('../_github');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  CORS['Access-Control-Allow-Origin']);
  res.setHeader('Access-Control-Allow-Methods', CORS['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', CORS['Access-Control-Allow-Headers']);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, emoji, members } = req.body;
    if (!name?.trim())           return res.status(400).json({ error: 'Group name is required.' });
    if (!Array.isArray(members)) return res.status(400).json({ error: 'Members must be an array.' });

    const groupId = uuidv4();
    const code    = generateCode();
    const now     = new Date().toISOString();

    const groupData = {
      id: groupId, code, name: name.trim(), emoji: emoji ?? '🎉',
      members, expenses: [], settlements: [], created_at: now, updated_at: now,
    };

    await writeGroup(groupId, groupData);
    return res.status(201).json({ groupId, code });
  } catch (e) {
    console.error('[create group]', e);
    return res.status(500).json({ error: e.message ?? 'Failed to create group.' });
  }
};
