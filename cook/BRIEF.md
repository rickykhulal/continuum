# Brief: Continuum local UI upgrade

Target: upgrade Continuum to a professional, modern, high-contrast dashboard and make Laika autonomous. Stack: React, TypeScript, Vite, Three.js and MapLibre.
References: current public app at https://continuum-6ofw.onrender.com, captured in `cook/refs/`; these are the Before baseline, not an external design to reproduce.
Bar, eyeballed rubric out of 100: layout and spacing 90; surface hierarchy 90; color and readability 90; typography and components 90; information density 90; motion 90. Favor deep space dark surfaces, restrained glass, readable typography and functional interactions. Do not claim similarity percentages.
Calibration offset: none; no user scores yet.
Rules: reuse existing models, fonts, data and graphics. Preserve all provenance labels and derived metrics. Respect light/high-contrast/reduced-motion settings. No external decorative assets or sound. Laika speaks every 45 seconds, stays visible for 10 seconds, and remains draggable.
Time: hard cap 90 minutes, explicitly accepted by user. Started: 2026-11-15 07:18 UTC / 13:03 Asia/Katmandu. No demo time floor.
Usage: budget telemetry unavailable; do not claim a measured utilization percentage.
Hardware: local Windows; keep rendering cheap and test desktop and mobile.
Deliverable: approved app, build/test evidence, Before/After stills and Cook ledger. User approved the stills and explicitly waived the final video on 2026-11-15.
Permissions: install skill globally and ffmpeg; code edits and local dev/test servers; screenshots of the public current site. Initially local only and uncommitted for review. On 2026-11-15 the user explicitly approved committing all changes, pushing origin main and verifying Render deployment. This approval supersedes the initial local-only restriction. External posts are outside this release.
User's words: "professional, modern, and high-contrast"; "Laika Fully Autonomous"; "All changes must remain local for user review."

Baseline: npm ci exit 0 after releasing preview file locks; build exit 0; tests 249 total, 245 passed, 0 failed, 4 skipped. Browser baseline partial: 76/102 before the existing null focus exception, with static-preview API 404s. See `baseline-e2e-report.json`.
