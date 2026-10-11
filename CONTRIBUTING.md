# Contributing

Install with `npm ci`, build with `npm run build`, then run `npm start`. The server serves the built client; rebuild after client changes. `npm run dev` runs server TypeScript directly against that same built client.

Use synthetic data in tests. Keep local credentials, databases, exported requests, and private screenshots out of Git. Runtime data belongs in `.data` or an explicitly configured private directory. Capture setup remains in the caller's project; the service never executes project scripts or reviewer text.

All interfaces use the shared manifest schema and domain transitions. Preserve immutable versions, exact image anchors, role boundaries, idempotent submissions, and generation-bound owner approvals. A reviewer or agent cannot make an owner's decision.

Run the verification commands in README before proposing a change. Use focused tests for persistence, invalid inputs, concurrent/stale decisions, access revocation, and observable browser behavior. Format with `npm run format`. Browser tests write private local evidence under `.evidence` and isolated fixture data under `.data/e2e`.

The source galleries used to design import adapters remain separate projects. Do not copy their business logic or client data here. Test adapter changes with synthetic records of their observed formats.
