# Generated architecture project

Edit `project.{{syntax}}`, then run `npm run scaffold`. Implement the generated
factories in the layer folders. Each named capability selects its actual export.
Factory ports come from a simple destructured parameter signature.

Templates throw `Not implemented` until filled in. Existing implementations,
project files and runtime files are preserved. Review scaffold warnings after
architecture changes. Runtime upgrades require updating those files explicitly.

Install dependencies with `npm install`. Startup reads the current factories;
`architecture.cache.json` is generated scaffold state, not a startup dependency.

The assembled application provides `run(args)`, `listen()` and `close()`.
Factories own their state. Close releases subscriptions and resources in reverse
order. The HTTP mode needs a presentation entry exposing `listen()`.

For JS-primary projects, `npm run sync` generates equivalent Lisp and Markdown
representations, and `npm run sync:check` detects semantic drift. When Lisp or
Markdown is the primary source, edit that file directly instead.
