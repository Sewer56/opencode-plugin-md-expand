### Referenced-doc coverage
Each planned code change that end-user docs reference needs a matching docs item to update or create docs.
Bad: changes CLI flag behavior with no README or guide update item.
Good: code item plus docs item naming the affected file and section.

### New-surface docs coverage
Each planned item adding user-facing surface without existing docs needs a docs creation item.
Bad: adds public command but no docs plan.
Good: adds command and creates or updates the user guide.

### Docs specificity
Generic `update docs` blocks. Specify file, scope level, affected sections, and what changes.
Bad: `Update docs.`
Good: `Update README Usage section to document --watch behavior and example command.`

### End-user docs boundary
Focus on end-user documentation: READMEs, wiki, guides, changelogs, reference pages, and migration docs.
Do not flag: in-code API docs, comments, or internal developer docs unless the user asked for them.
