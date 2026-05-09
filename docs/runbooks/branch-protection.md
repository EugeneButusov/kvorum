# Branch Protection Runbook

One-time operator action after Epic C is merged and CI is green on `main`.

---

## Prerequisites

- CI workflow has run at least once on `main` (needed so GitHub offers it as a status check option).
- You have Owner or Admin access to `https://github.com/EugeneButusov/kvorum`.

---

## Steps

### 1. Open branch protection settings

Navigate to:

```
https://github.com/EugeneButusov/kvorum/settings/branches
```

Click **Add branch ruleset** (or **Add rule** if the classic UI is shown), targeting the `main` branch pattern.

### 2. Apply required settings

| Setting                                       | Value                                                              |
| --------------------------------------------- | ------------------------------------------------------------------ |
| **Require a pull request before merging**     | Enabled                                                            |
| — Required approvals                          | 0 (single-operator project)                                        |
| — Dismiss stale reviews on push               | Enabled                                                            |
| **Require status checks to pass**             | Enabled                                                            |
| — Required check                              | `Lint · Typecheck · Test · Build · Audit · Scan` (the CI job name) |
| — Require branches to be up to date           | Enabled                                                            |
| **Require conversation resolution**           | Enabled                                                            |
| **Do not allow bypassing the above settings** | Enabled (prevents admin force-merge)                               |
| **Allow force pushes**                        | Disabled                                                           |
| **Allow deletions**                           | Disabled                                                           |

### 3. Verify

Open a throwaway PR with an intentional CI failure (e.g., a lint error). Confirm:

1. The merge button is disabled while CI is failing.
2. After fixing and re-pushing, the merge button becomes available.

Close the PR and delete the branch.

---

## SHOULD: Set up SSH commit signing (~15 min, one-time)

Signed commits provide a tamper-evident audit trail and are strongly recommended for sole-operator projects. This is not required before applying branch protection — apply the rules first, then sign if desired.

### macOS / Linux (SSH key signing)

```bash
# 1. Generate a dedicated signing key (skip if you have an existing Ed25519 key)
ssh-keygen -t ed25519 -C "signing@kvorum" -f ~/.ssh/id_ed25519_signing

# 2. Add the public key to GitHub as a Signing Key
#    GitHub → Settings → SSH and GPG keys → New SSH key → Key type: Signing Key
cat ~/.ssh/id_ed25519_signing.pub

# 3. Configure git to use it
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519_signing.pub
git config --global commit.gpgsign true

# 4. Verify
git log --show-signature -1
```

GitHub will display a "Verified" badge on signed commits.

### Enabling "Require signed commits" in branch protection

Once signing is set up and you've verified at least one signed commit on `main`, return to the branch protection settings and enable **Require signed commits**. This is an optional hardening step.

---

## Troubleshooting

| Symptom                                | Cause                                   | Fix                                                             |
| -------------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| CI check not listed in dropdown        | CI has never run on `main`              | Push a commit to trigger the first run, then return to settings |
| Merge button disabled despite green CI | Branch is behind `main`                 | Click "Update branch" on the PR                                 |
| `git commit` fails with signing error  | SSH agent not running or key not loaded | `ssh-add ~/.ssh/id_ed25519_signing`                             |
