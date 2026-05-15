# opencode-plugin-md-expand

OpenCode plugin that expands `{{...}}` templates in `.md` agent, command, mode,
skill files, and user messages before the LLM sees them.

> Expand every `{{...}}` in your markdown files.

File includes, environment variables, scoped arguments, and inline conditionals:
all resolved before the LLM reads.

## At a glance

**Include shared rules files in any prompt:**

```md
You must follow these rules:
{{ file="./rules/general.md" }}
{{ file="./rules/style.md" }}
```

**Inject environment variables at runtime:**

```md
Base API URL: {{env:API_URL}}
{{ if=env:CI }}Skip interactive prompts.{{ endif }}
```

**Switch instructions by mode (a custom arg):**

```md
{{ file="./review.md" mode=cached }}
```

Inside `review.md`:

```md
{{ if=mode==cached }}
Reuse previous analysis results.
{{ else }}
Run a fresh analysis.
{{ endif }}
```

**Pass args into a reusable template:**

```md
{{ file="./template.md" title="Plan Review" domain=correctness }}
```

Inside `template.md`:

```md
# {{arg:title}}

Domain: {{arg:domain}}
```

## Install in OpenCode

Add to `opencode.json` (or `.opencode/opencode.json`):

```jsonc
{
  "plugin": ["opencode-plugin-md-expand@^0.1.0"],
}
```

OpenCode auto-installs npm packages into its cache directory on first
load - no manual `npm install` needed.

With options:

```jsonc
{
  "plugin": [
    [
      "opencode-plugin-md-expand@^0.1.0",
      {
        "debug": true,
      },
    ],
  ],
}
```

## Configuration

The plugin auto-derives fallback directories from standard OpenCode
paths:

1. `<project>/.opencode`
2. `<cwd>/.opencode`
3. `$XDG_CONFIG_HOME/opencode` (e.g. `~/.config/opencode`)

If your config lives in a non-standard location, override with
`configDirs`:

```jsonc
{
  "plugin": [
    [
      "opencode-plugin-md-expand@^0.1.0",
      {
        "configDirs": ["./my-custom-config"],
      },
    ],
  ],
}
```

> `configDirs` **replaces** the three auto-derived defaults entirely.
> If you only want to _add_ directories while keeping the defaults
> (project root, current working directory, `$XDG_CONFIG_HOME`), use `extraConfigDirs` instead:

```jsonc
{
  "plugin": [
    [
      "opencode-plugin-md-expand@^0.1.0",
      {
        "extraConfigDirs": ["{env:HOME}/.config/opencode/extra-md"],
      },
    ],
  ],
}
```

OpenCode applies `{env:VAR}` substitution to the raw JSON before the
plugin processes it, so `{env:HOME}` expands to your home directory at
config-load time.

The CLI and wrapper scripts also respect `OPENCODE_CONFIG_DIR` for
runtime overrides.

## Options

| Option            | Description                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configDirs`      | `string[]` · default `["<project>/.opencode", "<cwd>/.opencode", "$XDG_CONFIG_HOME/opencode"]`. Ordered fallback dirs for relative `{{ file="./..." }}` includes. Replaces defaults entirely. See [Configuration](#configuration). |
| `extraConfigDirs` | `string[]` · default `[]`. Additional dirs **appended** to auto-derived defaults. Ignored when `configDirs` is set. See [Configuration](#configuration).                                                                           |
| `maxDepth`        | `number` · default `10`. Maximum recursive file include depth. At limit, file templates stay literal; env/arg/if still expand.                                                                                                     |
| `debug`           | `boolean` · env-based. Write debug logs. Also enabled by `OPENCODE_PLUGIN_MD_EXPAND_DEBUG=1`.                                                                                                                                      |
| `logDir`          | `string` · default `<configDirs[0]>/plugins/.logs/opencode-plugin-md-expand`. Debug log directory.                                                                                                                                 |
| `initialArgs`     | `Record<string, string>` · default `{}`. Key-value pairs injected as `{{arg:*}}` variables for every expansion. Useful for global defaults like `mode` or `domain`.                                                                |
| `cache`           | `boolean` · default `false`. Cache raw and recursively-expanded file content across plugin transform calls. Also enabled by `OPENCODE_PLUGIN_MD_EXPAND_CACHE=1`; leave off while editing config files.                             |

## Template grammar

### File includes

```md
{{ file="./rules/general.md" }}
{{ file="~/.secrets/project-context" }}
{{ file="./template.md" domain=correctness mode="cached review" }}
```

Path rules:

- `~/...` resolves to `$HOME`
- `./...` and `../...` resolve relative to `<project>/` or `<cwd>/`
- other relative paths resolve relative to `<project>/` or `<cwd>/`
- if `configDirs` is set, missing `./...` / `../...` paths fall back to those directories in order

### Args

```md
{{ file="./template.md" title="Plan Review" }}
```

In `template.md`:

```md
# {{arg:title}}
```

Arg rules:

- undefined `{{arg:key}}` expands to an empty string
- args are scoped to one file include
- nested file includes do not inherit parent args unless the parent
  `{{ file=... }}` directive includes them as `key=value` pairs
- arg values are literal for env/file tokens, but `{{arg:...}}`
  references can be nested within arg values and are resolved recursively

### Conditionals

```md
{{ if=mode==cached }}
Use cached review scope.
{{ else }}
Use cacheless review scope.
{{ endif }}

{{ if=mode!=cached }}
Use cacheless review scope.
{{ endif }}

{{ if=env:CI }}
CI-only instructions.
{{ endif }}

{{ if=env:CI!=true }}
Local-only instructions.
{{ endif }}
```

Condition operators:

- `==` - exact equality (`if=arg==value` includes when arg equals value)
- `!=` - inequality (`if=arg!=value` includes when arg differs from value; `if=arg!=` includes when arg is empty or absent)

## CLI

Install globally or locally:

```sh
npm install -g opencode-plugin-md-expand
opencode-plugin-md-expand --help
```

Or add to `devDependencies` and use via `npx`:

```jsonc
{
  "devDependencies": {
    "opencode-plugin-md-expand": "^0.1.0",
  },
  "scripts": {
    "validate": "opencode-plugin-md-expand validate --config-dir config",
  },
}
```

To run from source (without publishing), use `bun src/cli/cli.ts`
instead.

### Validate templates

Useful in git hooks and CI:

```sh
opencode-plugin-md-expand validate --config-dir config config/agent config/command config/rules
```

Validation fails on:

- missing file includes
- empty file include paths
- file include cycles (circular references where A includes B which
  includes A)
- unexpanded `{{ file=... }}` tokens
- unexpanded `{{ if=... }}` / `{{ endif }}` markers
- unexpanded `{{arg:...}}` or `{{env:...}}` tokens

Git hook example:

```sh
#!/usr/bin/env sh
set -eu
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
opencode-plugin-md-expand validate --config-dir config config/agent config/command config/rules
```

### Render one template

Useful for prompt debugging:

```sh
opencode-plugin-md-expand render --config-dir config agent/_plan/finalize.md
opencode-plugin-md-expand render --config-dir config rules/groups/style/self-wording.md -o /tmp/rendered.md
```

Pass top-level args manually:

```sh
opencode-plugin-md-expand render --config-dir config --arg mode=cached agent/example.md
```

Enable debug:

```sh
opencode-plugin-md-expand render --config-dir config --debug agent/example.md
cat config/plugins/.logs/opencode-plugin-md-expand/debug.log
```

## Development

Requires [Bun](https://bun.sh).

```sh
bun install            # install dependencies
bun run typecheck      # check TypeScript types (no runtime)
bun test               # run tests
bun run build          # compile TypeScript to dist/
bun run check          # run all checks (typecheck + test + format + build)
bun run format         # auto-format all files
bun run format:check   # check formatting (CI enforces this)
```

Editor setup: `.vscode/settings.json` enables format-on-save with oxc.

### Local path

For development or private forks, reference the plugin directory directly:

```jsonc
{
  "plugin": ["plugins/opencode-plugin-md-expand"],
}
```

No wrapper `.ts` file needed: OpenCode detects local plugin directories
and loads them directly from `index.ts` or `package.json`.

### Publishing

GitHub Actions publishes the package to npm when you push a `v*` tag.

Release workflow:

```sh
npm version patch|minor|major # bumps package.json + creates matching git tag
git push --follow-tags        # pushes commit + tag → triggers publish.yml
```

The CI workflow runs a full check (`typecheck`, `test`,
`format:check`, `build`) before publishing with `--provenance`,
creating a cryptographically signed link between the published version
and its originating git commit.

Manual fallback:

```sh
npm login
npm publish --provenance --access public
```

### Benchmark prompt transforms

The benchmark harness uses Tinybench and copied fixtures from a real OpenCode config:

```sh
bun run bench
```

It measures the `experimental.chat.system.transform` hook for simple
imports, deep/complex imports, and no-op static markdown. Override run
length when needed:

```sh
MD_EXPAND_BENCH_TIME_MS=5000 MD_EXPAND_BENCH_MIN_ITERATIONS=512 bun run bench
```

## Package shape

OpenCode npm plugin entrypoint is the default export:

```ts
export default {
  id: "opencode-plugin-md-expand",
  server: MdExpandPlugin,
};
```

## License

MIT
