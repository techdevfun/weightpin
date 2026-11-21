# Contributing

## Development

```sh
npm install
npm run build
npm test        # unit + e2e (fixture Rubies built in tmp)
npm run test:live  # live smoke; soft-skips on network failure
npm run lint    # eslint + prettier
node scripts/preflight.js  # ASCII-only + no-internal-names scan
```

## Rules

- Zero runtime dependencies. TypeScript strict, Node 20+.
- Every figure cited in the README must come from a live source fetched
  during the build or a recorded fixture labelled as such. No invented
  numbers.
- All public content is English only (ASCII). No em dash anywhere. The
  sharp-s character appears in code and tests only as the escape
  `\u00DF`, never as a literal glyph. The preflight script blocks
  anything else, including text inside the demo transcript.
- The tool reports; it never deletes or changes anything on the host.
  Never add a mode that edits a Ruby install or a Ruby launcher.
- The tool reads only `ruby -v` output and the app files the user
  points at (Gemfile.lock, config.ru, Dockerfile, .ruby-version).
  Never add a network call to scan/check.
- Never add exploit code, a crashing input, or a mode that sends a
  sharp-s payload to a live app. Verdicts come from version +
  framework + reachability evidence only.
- Keep the fixed-build table and the vendor-product table pinned to
  their check date (2026-11-20). When a vendor ships a new fixed
  release, update the table and the check date together.
- The demo fixtures are labelled recorded / representative / synthetic
  in the transcript, the GIF title card, and examples/README.md. Never
  present fixture numbers as measurements of a real machine. Live
  checks against real sources go in the build note and README, with the
  date recorded.
- A version the comparator cannot place is UNKNOWN, never SAFE.
