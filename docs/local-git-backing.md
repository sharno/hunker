# Local Git backing design

## Decision

Hunker should use Git object databases as its backing service. It should not
switch a shared checkout when a browser tab changes, and it should not require
Jujutsu for the read-only review path.

Each view resolves to a typed target:

- `RepositoryTarget(repository, ref, oid)`
- `PullTarget(repository, number, baseOid, headOid)`
- `CompareTarget(repository, baseOid, headOid)`
- `CommitTarget(repository, oid, parentOid)`
- `WorkingCopyTarget(repositoryPath, branch, headOid, dirtyFingerprint)`

The URL stores the human-readable ref or GitHub resource. The server resolves
it to immutable OIDs for one response, so concurrent tabs never depend on a
mutable process-wide checkout.

## Storage and commands

Hunker should discover an existing checkout below `HUNKER_REPOS_ROOT` first.
Otherwise it should use a cached clone below `HUNKER_CACHE_ROOT`. PR and commit
data can then be generated locally:

- file lists and patches: `git diff --find-renames <baseOid> <headOid>`
- file revisions: `git show <oid>:<path>`
- commits: `git log <baseOid>..<headOid>`
- repository files: `git ls-tree -r <oid>`

GitHub remains responsible for PR metadata, review threads, and posting review
actions. It is also the fallback while a local clone or required object is not
available.

## Freshness

Visible repository views should poll status every two minutes. The server may
run `git fetch --prune` when its last successful fetch is older than two
minutes. It must not automatically run `git pull` in a user checkout.

The UI should show the tracked branch, current OID, dirty state, upstream, and
ahead/behind counts. When a clean checkout is behind, it can offer an explicit
`git pull --ff-only`, followed by a view refresh. Cached clones can advance
their remote refs automatically because no user working copy is being changed.

An already-rendered PR or commit view stays pinned to its resolved OIDs. If a
fetch moves the relevant branch or PR head, Hunker should offer “New revision
available” instead of silently replacing the diff.

## Worktrees

Most views do not need a worktree. Git can diff commits and read blobs directly.
FFF is the exception because it indexes a filesystem tree. For fuzzy search on
a target other than the user's current checkout, Hunker may create a detached,
read-only worktree keyed by repository and target OID. These worktrees are cache
entries with leases and idle-time cleanup; they are not assigned one-for-one to
browser tabs.

## Why not Jujutsu yet

Jujutsu workspaces and its operation log become useful if Hunker grows into an
editing, rebasing, or stacked-change tool. Today they would add a second VCS
model and installation requirement around data Git already exposes directly.
Keeping the backing interface typed makes a future Jujutsu implementation
possible without coupling the UI to it.

## Implementation status

The read-only review path is now wired in:

- Existing checkouts and Hunker cache clones are discovered without changing
  their checked-out branch.
- Pull request metadata resolves to immutable base/head OIDs. Local Git supplies
  the patch, blobs, semantic inputs, move-analysis inputs, and commit log when
  those objects are available; GitHub is the fallback.
- PR heads are fetched into `refs/hunker/pull/<number>/head` at most once every
  two minutes. The browser remains pinned and offers a refresh when that ref
  advances.
- Follow-up browser requests carry the pinned OIDs, so full-file and analysis
  requests cannot drift to a newer PR revision.

Repository branch status, dirty/upstream/ahead/behind presentation, explicit
`git pull --ff-only`, and detached worktrees for indexing historical OIDs remain
future work.
