# Contributing

## Setup

Use Node.js 20.19+, 22.12+, or 24+, then install the locked dependencies:

```sh
npm ci
```

Before opening a pull request, run:

```sh
npm run build
npm run typecheck
npm run lint
npm test
```

Keep analyzer behavior conservative when the supplied data is incomplete. Add focused tests for behavior changes and update the README, architecture guide, or validation report when their guidance changes. Validation fixtures are synthetic unless explicitly identified as upstream workflow snapshots; do not describe them as observed GitHub workflow runs.

Pull requests should explain the user-visible change, limitations, and the checks run. Avoid including credentials, generated local artifacts, or unrelated files.
