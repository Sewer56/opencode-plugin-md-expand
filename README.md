# opencode-plugin-md-expand

OpenCode plugin that expands `{{...}}` templates in `.md` agent, command, mode, and skill files before the LLM sees them.

> Expand every `{{...}}` in your markdown files.

File includes, environment variables, scoped arguments, and inline conditionals: all resolved before the LLM reads.

## Install in OpenCode

Add to `opencode.json` (or `.opencode/opencode.json`):

```jsonc
{
  "plugin": ["plugins/opencode-plugin-md-expand"],
}
```

The plugin auto-derives fallback directories from standard OpenCode paths:

1. `<project>/.opencode`
2. `<cwd>/.opencode`
3. `$XDG_CONFIG_HOME/opencode` (e.g. `~/.config/opencode`, symlinked on NixOS)

If your config lives in a non-standard location, override with `configDirs`:

```jsonc
{
  "plugin": [
    [
      "plugins/opencode-plugin-md-expand",
      {
        "configDirs": ["./my-custom-config"],
      },
    ],
  ],
}
```

The CLI and wrapper scripts also respect `OPENCODE_CONFIG_DIR` for runtime overrides.

No wrapper `.ts` file needed: OpenCode's `resolvePathPluginTarget()` detects the submodule directory, finds `index.ts`, and loads the plugin directly.

## Options

| Option       | Type       | Default                                                        | Purpose                                                                                                               |
| ------------ | ---------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `configDirs` | `string[]` | `["<project>/.opencode", "<cwd>/.opencode", "<xdg>/opencode"]` | Ordered fallback directories for relative `{{ file="./..." }}` includes when not found in project dir.                |
| `maxDepth`   | `number`   | `10`                                                           | Maximum recursive file-include depth. At limit, file templates stay literal; env/arg/if still expand.                 |
| `debug`      | `boolean`  | env-based                                                      | Write debug logs. Also enabled by `FILE_INTERP_DEBUG=1`, `MD_EXPAND_DEBUG=1`, or `OPENCODE_PLUGIN_MD_EXPAND_DEBUG=1`. |
| `logDir`     | `string`   | `<configDirs[0]>/plugins/.logs/opencode-plugin-md-expand`      | Debug log directory.                                                                                                  |

## Template grammar

### File includes

```md
{{ file="./rules/general.md" }}
{{ file="~/.secrets/project-context" }}
{{ file="./template.md" domain=correctness mode="cached review" }}
```

Path rules:

- `~/...` resolves under `$HOME`
- `./...` and `../...` resolve relative to current project/base dir
- other relative paths resolve relative to current project/base dir
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

- undefined `{{arg:key}}` expands empty
- args are scoped to one file include
- nested file includes do not inherit parent args unless explicitly passed
- arg values are literal for env/file tokens, but `{{arg:...}}` can cascade in arg values

### Conditionals

```md
{{ if=mode==cached }}
Use cached review scope.
{{ else }}
Use cacheless review scope.
{{ endif }}

{{ if=env:CI }}
CI-only instructions.
{{ endif }}
```

## CLI

Build first for published-package bin use:

```sh
bun run build
opencode-plugin-md-expand --help
```

From source:

```sh
bun src/cli/cli.ts --help
```

### Validate templates

Useful in git hooks and CI:

```sh
opencode-plugin-md-expand validate --config-dir config config/agent config/command config/rules
```

Validation fails on:

- missing file includes
- empty file include paths
- file include cycles
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

## Library API

```ts
import { expand, expandWithDiagnostics, resolvePath, MAX_DEPTH } from "opencode-plugin-md-expand";

// configDirs auto-derives to OpenCode-standard paths
const text = await expand(source, projectDir, {
  maxDepth: 10,
});

const result = await expandWithDiagnostics(source, projectDir);
```

## Development

```sh
bun install
bun run typecheck
bun test
bun run build
bun run check
bun run format        # auto-format all files
bun run format:check  # check formatting (CI enforces this)
```

Editor setup: `.vscode/settings.json` enables format-on-save with oxc.

## Package shape

OpenCode npm plugin entrypoint is the default export:

```ts
export default {
  id: "opencode-plugin-md-expand",
  server: MdExpandPlugin,
};
```

The package also exports the library API for tests, validation scripts, and benchmarks.

## License

MIT
