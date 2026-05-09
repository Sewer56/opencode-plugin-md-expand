# Rule import contract

Agents and commands import rule groups, not individual cards.

- `rules/cards/**` contains reusable rule cards. Cards define judgment only: what to flag, what to allow, severity, and compact examples.
- `rules/groups/**` is the public import API. Groups define category, read scope, repo-search allowance, ownership, and card bundle.
- Legacy category-specific wrapper directories have been removed; add new rules as cards and expose them through groups.

Read-scope prefixes:

- `self-`: passed artifact text only; no repo search.
- `target-`: referenced target files/ranges only; no broad repo search.
- `set-`: selected artifact set; no broad repo search.
- `search-`: repo search allowed, scoped to the group's purpose.

Prompt rule: reviewers own their groups; callers pass paths, Delta, and scope instead of restating rule text.
