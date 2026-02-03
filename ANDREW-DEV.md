# Andrew's Cinny Fork Strategy

This documents how we maintain a personal development branch while contributing clean PRs upstream.

## Branch Structure

```
upstream/dev (cinnyapp/cinny)        # Upstream development branch
    │
    ├── origin/dev                    # Our fork's dev, tracks upstream
    │
    ├── fix/mute-unread-badge         # PR #2581 - clean, single-purpose
    ├── fix/some-other-thing          # Future PR - clean, single-purpose
    ├── feat/my-feature               # Future PR - clean, single-purpose
    │
    └── andrew-dev                    # DEPLOY BRANCH - merges ALL our changes
```

## Workflow

### Starting a new fix/feature (for upstream contribution)

```bash
# Always branch from latest upstream dev
git fetch upstream
git checkout -b fix/descriptive-name upstream/dev

# Make changes, commit
git add .
git commit -m "Fix descriptive summary of change"

# Push to our fork, create PR
git push -u origin fix/descriptive-name
gh pr create -R cinnyapp/cinny --base dev
```

### Updating andrew-dev (our deploy branch)

```bash
# After creating a new feature branch, merge it into andrew-dev
git checkout andrew-dev
git merge fix/descriptive-name
git push origin andrew-dev
```

### When a PR gets merged upstream

```bash
# Fetch latest upstream
git fetch upstream

# Update our dev
git checkout dev
git merge upstream/dev
git push origin dev

# Rebase andrew-dev to remove the now-merged commits
git checkout andrew-dev
git rebase upstream/dev

# If conflicts, the merged PR's changes are already in upstream/dev,
# so you can drop those commits during rebase

git push origin andrew-dev --force-with-lease

# Delete the merged feature branch
git branch -d fix/merged-feature
git push origin --delete fix/merged-feature
```

### Syncing with upstream (periodic maintenance)

```bash
git fetch upstream
git checkout dev
git merge upstream/dev
git push origin dev

# Rebase andrew-dev onto latest upstream
git checkout andrew-dev
git rebase upstream/dev
git push origin andrew-dev --force-with-lease
```

## Current Branches

| Branch | Purpose | PR | Status |
|--------|---------|----|---------|
| `fix/mute-unread-badge` | Fix muted rooms showing badges | #2581 | Open |
| `andrew-dev` | Deploy branch (all changes) | N/A | Deploy to Unraid |

## Deployment

`andrew-dev` is deployed to Unraid via Docker. See docker-compose or container config.

## Rules

1. **Never PR from andrew-dev** - Always create clean branches from `upstream/dev`
2. **Keep PRs small and focused** - One fix/feature per PR
3. **PR titles start with verb** - "Fix", "Add", "Change", "Remove" (per CONTRIBUTING.md)
4. **Sign the CLA** - Comment "I have read the CLA Document and I hereby sign the CLA"
5. **Run ESLint** - `npm run lint` before pushing
