### Undefined jargon
Flag: technical, project-specific, or internal taxonomy terms the intended reader cannot resolve nearby.
Allow: inline definition, plain-language rewrite, glossary/link/path pointer, tooltip, or comment appropriate to the artifact.
Severity: BLOCKING when the reader could act incorrectly; otherwise ADVISORY.
Bad: `Enable the hydration seam.`
Good: `Enable the startup hook that initializes state before rendering.`

### Ambiguous language
Flag: phrases with multiple plausible interpretations where a reader could act incorrectly.
Severity: BLOCKING.
Bad: `Update the nearby config when needed.`
Good: `Update config/app.toml when the new flag is enabled.`

### Compound-term compression
Flag: compressed phrases that sacrifice comprehension.
Severity: ADVISORY unless the compressed phrase blocks action.
Bad: `hot-reload DX pipeline`
Good: `developer workflow that reloads the app after source changes`

### Opaque reference
Flag: references to patterns, conventions, pages, or internal systems that are not standard and not defined nearby.
Allow: inline the convention or point to a path when navigation is enough.
Bad: `Follow the adapter convention.`
Good: `Wrap external calls in an adapter module so callers depend on one local interface.`

### Acronym without expansion
Flag: acronyms not expanded on first use.
Severity: BLOCKING for project-specific acronyms; ADVISORY for widely known acronyms.
Bad: `SSR must stay enabled.`
Good: `Server-side rendering (SSR) must stay enabled.`

### Readability exclusions
Do not flag common programming terms, exact code identifiers, path pointers, terms defined earlier in the same artifact, headings, section names, non-prescriptive prose, or standard domain terms.
