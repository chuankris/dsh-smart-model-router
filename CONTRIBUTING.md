# Contributing

1. Install Node.js 22.19 or newer.
2. Run `npm ci --ignore-scripts`.
3. Add tests for every routing or threshold change.
4. Run `npm run check`, `npm run smoke:real-dsh`, and `npm run pack:check`.
5. Keep model routes and deployment thresholds configurable rather than hard-coded in request logic.
6. Preserve explicit model selections and call `next()` in the `agent/request` waterfall.
7. Keep model-visible routing reconstructable through DSH's normal `request/header` logging.

Issues and pull requests are welcome. For upstream work, prefer provider-neutral quota and virtual-route APIs over additional provider-specific branches in this package.
