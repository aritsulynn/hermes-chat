# Contributing

Thanks for looking. This is a **client only** — there is no backend here, so
everything you can verify locally is client-side behaviour against a gateway you
already run.

## The bar for a change

```bash
npm run typecheck   # tsc --noEmit
npm test            # node's test runner, no framework
npm run lint        # eslint
npm run format:check
npm run build       # proves the bundle compiles
```

CI runs exactly these, so a green PR and a green laptop mean the same thing.

Two things the bar cannot see, because they need a real gateway:

- Anything touching sessions or the turn engine needs a manual pass — run
  `npm run dev`, log in, and exercise the flow you touched.
- Anything that authenticates. If login itself is what you changed, read
  [docs/troubleshooting.md](docs/troubleshooting.md) first; the failure mode is a
  browser that reports `Failed to fetch` for reasons that have nothing to do with
  the network.

`npm run lint` currently reports 62 `react-hooks/exhaustive-deps` **warnings**.
They are known, not endorsed — several are deliberate (slices write refs during
render so callbacks frozen inside `openWs()` read the latest values). Do not fix
one in passing unless it is the file you are already working in.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), scoped where it
helps:

```
feat(asks): answer queued requests from the inbox
fix(chat): stop clipping the model name on wide screens
refactor(store): extract live-turn slice
```

## Tests

Plain `.mjs` files run by Node's built-in runner — no test framework is
installed. Two things to know before you add one:

- **The glob in `package.json` is explicit.** A test outside those four paths
  will silently never run:
  ```
  src/services/*.test.mjs   src/utils/*.test.mjs
  src/features/*/*.test.mjs   src/store/*.test.mjs
  ```
- Node's type stripping needs explicit extensions, so a test imports source with
  the suffix: `import { mergeUsage } from './usage.ts'`.

## Style

Prettier owns formatting; ESLint owns everything else and is configured with
`eslint-config-prettier` last, so the two never argue. Match the file you are in
rather than reaching for a new pattern — the code is comment-heavy on purpose,
and the comments carry the reasoning a future reader would otherwise have to
rediscover.

## Where things are documented

- [README.md](README.md) — features, every route, architecture
- [docs/troubleshooting.md](docs/troubleshooting.md) — a failure you can
  reproduce, and how to tell it apart from the others
- [docs/backlog.md](docs/backlog.md) — work that was found and not done
- [docs/feature-parity-roadmap.md](docs/feature-parity-roadmap.md) — what this
  client still lacks relative to the full desktop dashboard

If a change makes one of those wrong, fix the document in the same commit. The
route table, the slice count and the Node floor have all drifted before; they are
checkable against the code, so they are expected to be right.
