### Stable step headings
Step artifacts need stable headings and explicit refs that match the handoff Step Index and requirement mapping.

### Valid anchors and locators
Anchors, line locators, and insert positions must point at current repo surface or clearly described new files.

### Per-hunk labels
Each diff block within a step file needs its own `**Lines: ~start-end**` label. Full-file ranges are invalid for localized changes.

### Matching diff context
Diff context must match the referenced target file closely enough for an implementer to apply the change without rediscovery.

### Nested fence safety
When a fenced block contains another fenced block, the outer fence uses backticks and inner fences use tildes.

### No placeholders
Block TODO/TBD/FIXME stubs, `...` placeholders, missing snippets, and generic `update X` instructions where exact step content is required.
