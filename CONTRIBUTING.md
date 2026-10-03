# Contributing

Thanks for taking a look. This plugin reads configuration that other agent
tools own, so correctness and read-only behaviour matter more than feature
count.

## Prerequisites

- Node `^22.19 || >=24`
- Nothing else for `npm run build` and `npm test`: the build is a
  `tsc --noCheck` emit, and the tests run against the emitted JavaScript with
  the built-in test runner.

## Layout

```
src/       host half (TypeScript, emitted to lib/)
client/    browser half (hand-written lazy-CJS bundle, no build step)
tests/     unit tests over the emitted lib/
scripts/   development checks and the workspace linker
```

## Checks

```sh
npm install
npm run build     # emits lib/
npm test          # parser, naming, masking, and skill-name tests
```

`npm run typecheck` checks the source against the real DeepSeek Harness plugin
APIs. Those packages are not on npm at the version a current harness uses, so
point the package at a harness checkout once:

```sh
npm run link-workspace -- ../deepseek-harness   # after building that checkout
npm run typecheck
```

Three development checks run the plugin against real inputs instead of
fixtures. They need a harness checkout, because they load the harness's own
registry packages by path:

```sh
npm run verify:discovery    # scans this machine's real tool configuration
npm run verify:activation   # mounts on a real tool and skill registry, runs the tools
npm run verify:management   # serves the management route over real HTTP
```

## Rules that the code follows

- **Never write to another tool's files.** Every read path is read-only; the
  only file this plugin owns is its own state document.
- **Redact credentials in anything a model can see.** Tool results and the
  management route both mask credential-looking values; add a test when you add
  a new field that can carry one.
- **Narrow the model-visible surface deliberately.** Anything a tool returns
  becomes durable transcript content.
- **Fail loud on configuration.** A mistyped `config` field must throw at
  activation rather than fall back to a default the operator did not choose.
- **Keep `lib/` committed.** The repository is installed straight from git, so
  the emitted JavaScript is part of the deliverable; CI fails when it is stale.

## Commit messages

Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`) are
welcome but not enforced.

## Releasing

1. Update `CHANGELOG.md`.
2. Bump `version` in `package.json`.
3. `npm run build && npm test`, then commit `lib/` with the version bump.
4. Tag: `git tag v<version> && git push --tags`.
