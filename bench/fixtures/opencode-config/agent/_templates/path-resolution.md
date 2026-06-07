## Path Resolution Template

Run the following scripts:

- Verify script: `{{path:.cargo/verify.sh}}`
- Build script: `{{path:./scripts/build.sh}}`
- Source entry: `{{gitpath:src/index.ts}}`
- Config path: `{{path:./config/settings.json}}`

After running `{{path:.cargo/verify.sh}}`, check `{{gitpath:src/main.ts}}` for changes.
