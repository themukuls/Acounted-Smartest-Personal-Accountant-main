const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

function getRepo() {
  const raw = process.env.GITHUB_REPO ?? '';
  const [owner, repo] = raw.split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPO env var must be "owner/repo"');
  return { owner, repo };
}

const DATA_PATH = 'data/groups';

async function readGroup(groupId) {
  const { owner, repo } = getRepo();
  try {
    const res = await octokit.repos.getContent({
      owner, repo,
      path: `${DATA_PATH}/${groupId}.json`,
    });
    const file = res.data;
    const content = Buffer.from(file.content, 'base64').toString('utf-8');
    return { data: JSON.parse(content), sha: file.sha };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function writeGroup(groupId, data, sha) {
  const { owner, repo } = getRepo();
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  await octokit.repos.createOrUpdateFileContents({
    owner, repo,
    path:    `${DATA_PATH}/${groupId}.json`,
    message: `[lendr] update group ${groupId}`,
    content,
    sha,
  });
}

async function findGroupByCode(code) {
  const { owner, repo } = getRepo();
  try {
    const res = await octokit.repos.getContent({ owner, repo, path: DATA_PATH });
    const files = res.data.filter(f => f.name.endsWith('.json'));
    for (const file of files) {
      const groupId = file.name.replace('.json', '');
      const group   = await readGroup(groupId);
      if (group && group.data.code === code.toUpperCase()) return group;
    }
    return null;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = { readGroup, writeGroup, findGroupByCode, generateCode, CORS };
