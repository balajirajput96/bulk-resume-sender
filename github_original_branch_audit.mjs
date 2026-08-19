import fs from 'node:fs/promises';

const token = process.env.GH_TOKEN;
if (!token) throw new Error('GH_TOKEN is required.');

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'manus-github-branch-audit',
};

async function get(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

const owner = await get('/user');
const repos = await get('/user/repos?affiliation=owner&per_page=100&sort=updated&direction=desc');
const audit = [];

for (const repo of repos.filter(item => !item.fork && !item.archived)) {
  const branches = await get(`/repos/${repo.full_name}/branches?per_page=100`);
  for (const branch of branches ?? []) {
    if (branch.name === repo.default_branch) continue;
    const commit = await get(`/repos/${repo.full_name}/commits/${branch.commit.sha}`);
    const authorLogin = commit?.author?.login ?? null;
    const committerLogin = commit?.committer?.login ?? null;
    if (authorLogin !== owner.login && committerLogin !== owner.login) continue;

    const comparison = await get(`/repos/${repo.full_name}/compare/${encodeURIComponent(repo.default_branch)}...${encodeURIComponent(branch.name)}`);
    audit.push({
      repo: repo.full_name,
      defaultBranch: repo.default_branch,
      branch: branch.name,
      sha: branch.commit.sha,
      authorLogin,
      committerLogin,
      relationship: comparison
        ? { status: comparison.status, aheadBy: comparison.ahead_by, behindBy: comparison.behind_by }
        : { status: 'unrelated_or_unavailable', aheadBy: null, behindBy: null },
    });
  }
}

await fs.writeFile('/home/ubuntu/github-original-branch-audit.json', JSON.stringify({ owner: owner.login, branches: audit }, null, 2));
console.log(JSON.stringify({
  owner: owner.login,
  accountAuthoredNonDefaultBranches: audit.length,
  byRelationship: audit.reduce((summary, item) => {
    summary[item.relationship.status] = (summary[item.relationship.status] ?? 0) + 1;
    return summary;
  }, {}),
  branches: audit,
}, null, 2));
