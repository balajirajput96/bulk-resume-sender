# Dependency Security Triage

The application dependency graph was reviewed with a local package audit because repository security-alert metadata was not authorized for the available GitHub token. The initial audit reported **3 critical** and **49 high** findings. Remediation was limited to compatible direct upgrades and explicit patched transitive overrides, rather than untested framework-major upgrades.

| Area | Validated remediation |
|---|---|
| Application and tooling dependencies | Updated the tRPC packages, Axios, Drizzle ORM, NanoID, pnpm, PostCSS, Vite, and Vitest to compatible patched releases. |
| Critical AWS XML parser path | Updated both AWS S3 packages to a current compatible release. |
| Critical Tailwind tar path | Updated Tailwind CSS and its Vite integration to a compatible current release. |
| Remaining transitive paths | Pinned Lodash, Lodash ES, and path-to-regexp to current patched releases through pnpm overrides. |
| Package-manager consistency | Updated the `packageManager` pin to pnpm 10.34.5. |

The final local audit reported **0 critical** and **0 high** findings. The application then passed all nine Vitest assertions and a production build. A peer-range warning for the development-only `@builder.io/vite-plugin-jsx-loc` package remains visible because it advertises Vite 4–5 support while the project uses Vite 7; no runtime or build failure was observed.
