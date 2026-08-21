import fs from 'node:fs/promises';

const token = process.env.GH_TOKEN;
if (!token) throw new Error('GH_TOKEN is required.');

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'manus-github-workflow-audit',
};

async function request(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  }
  return response;
}

async function getJson(path) {
  return (await request(path)).json();
}

async function getAll(path) {
  const separator = path.includes('?') ? '&' : '?';
  const items = [];
  for (let page = 1; ; page += 1) {
    const response = await request(`${path}${separator}per_page=100&page=${page}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error(`${path}: expected an array response.`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

function loginOf(actor) {
  return typeof actor === 'string' ? actor : actor?.login ?? null;
}

function isDependabot(run) {
  return loginOf(run.actor) === 'dependabot[bot]' || loginOf(run.triggeringActor ?? run.triggering_actor) === 'dependabot[bot]';
}

function isBotAuthoredOrBranch(run) {
  const actor = loginOf(run.actor);
  const triggeringActor = loginOf(run.triggeringActor ?? run.triggering_actor);
  return actor === 'Copilot' || triggeringActor === 'Copilot' || run.headBranch?.startsWith('copilot/') === true;
}

function hasFailureOrIsActive(run) {
  return run.status !== 'completed' || ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion);
}

function isActionable(run) {
  return run.workflowCurrentlyDefined && !isDependabot(run) && !isBotAuthoredOrBranch(run) && hasFailureOrIsActive(run);
}

const owner = await getJson('/user');
const repositories = await getAll('/user/repos?affiliation=owner&visibility=all&sort=full_name&direction=asc');
const originalRepositories = repositories.filter((repository) => !repository.fork);
const audit = [];

for (const repository of originalRepositories) {
  const record = {
    repository: repository.full_name,
    defaultBranch: repository.default_branch,
    archived: repository.archived,
    workflowRunCount: 0,
    currentWorkflowCount: 0,
    latestRuns: [],
    actionableRuns: [],
    policyExcludedRuns: [],
    staleHistoricalRuns: [],
    error: null,
  };

  try {
    const workflowCatalog = await getJson(`/repos/${repository.full_name}/actions/workflows?per_page=100`);
    const activeWorkflowIds = new Set((workflowCatalog.workflows ?? [])
      .filter((workflow) => workflow.state === 'active')
      .map((workflow) => workflow.id));
    record.currentWorkflowCount = activeWorkflowIds.size;
    const response = await getJson(`/repos/${repository.full_name}/actions/runs?per_page=100`);
    const runs = response.workflow_runs ?? [];
    record.workflowRunCount = response.total_count ?? runs.length;

    const newestByWorkflow = new Map();
    for (const run of runs) {
      const existing = newestByWorkflow.get(run.workflow_id);
      if (!existing || Date.parse(run.created_at) > Date.parse(existing.created_at)) {
        newestByWorkflow.set(run.workflow_id, run);
      }
    }

    record.latestRuns = [...newestByWorkflow.values()].map((run) => ({
      id: run.id,
      name: run.name,
      workflowId: run.workflow_id,
      headBranch: run.head_branch,
      headSha: run.head_sha,
      status: run.status,
      conclusion: run.conclusion,
      actor: run.actor?.login ?? null,
      triggeringActor: run.triggering_actor?.login ?? null,
      createdAt: run.created_at,
      htmlUrl: run.html_url,
      dependabot: isDependabot(run),
      workflowCurrentlyDefined: activeWorkflowIds.has(run.workflow_id),
    })).map((run) => ({
      ...run,
      policyExcluded: isBotAuthoredOrBranch(run),
    }));
    record.actionableRuns = record.latestRuns.filter(isActionable);
    record.policyExcludedRuns = record.latestRuns.filter((run) => !run.dependabot && run.policyExcluded && hasFailureOrIsActive(run));
    record.staleHistoricalRuns = record.latestRuns.filter((run) => !run.dependabot && !run.workflowCurrentlyDefined && hasFailureOrIsActive(run));
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  }

  audit.push(record);
}

const actionableRuns = audit.flatMap((record) => record.actionableRuns.map((run) => ({ repository: record.repository, ...run })));
const policyExcludedRuns = audit.flatMap((record) => record.policyExcludedRuns.map((run) => ({ repository: record.repository, ...run })));
const staleHistoricalRuns = audit.flatMap((record) => record.staleHistoricalRuns.map((run) => ({ repository: record.repository, ...run })));
const summary = {
  owner: owner.login,
  repositoriesVisible: repositories.length,
  originalRepositories: originalRepositories.length,
  archivedOriginalRepositories: audit.filter((record) => record.archived).length,
  repositoriesWithWorkflowAccessErrors: audit.filter((record) => record.error).length,
  latestNonDependabotWorkflowFailuresOrActiveRuns: actionableRuns.length,
  actionableRuns,
  policyExcludedBotAuthoredRuns: policyExcludedRuns.length,
  policyExcludedRuns,
  staleHistoricalWorkflowFailuresOrActiveRuns: staleHistoricalRuns.length,
  staleHistoricalRuns,
  repositories: audit,
};

await fs.writeFile('/home/ubuntu/github-original-workflow-audit-current.json', `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({
  owner: summary.owner,
  repositoriesVisible: summary.repositoriesVisible,
  originalRepositories: summary.originalRepositories,
  archivedOriginalRepositories: summary.archivedOriginalRepositories,
  repositoriesWithWorkflowAccessErrors: summary.repositoriesWithWorkflowAccessErrors,
  latestNonDependabotWorkflowFailuresOrActiveRuns: summary.latestNonDependabotWorkflowFailuresOrActiveRuns,
  actionableRuns: summary.actionableRuns,
  policyExcludedBotAuthoredRuns: summary.policyExcludedBotAuthoredRuns,
  policyExcludedRuns: summary.policyExcludedRuns,
  staleHistoricalWorkflowFailuresOrActiveRuns: summary.staleHistoricalWorkflowFailuresOrActiveRuns,
  staleHistoricalRuns: summary.staleHistoricalRuns,
}, null, 2));
