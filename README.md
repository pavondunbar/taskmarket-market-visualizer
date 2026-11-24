# Taskmarket market visualizer

A read-only dashboard of Taskmarket's public API for Tempo (4217) and Base (8453).
Made for a paid Taskmarket bounty. Not an official Taskmarket product.

## How it works
- `scripts/fetch-data.mjs` runs on a server (no dependencies, Node 20+). It reads the public API and writes `public/data.json`.
- `public/` is a static site (HTML, CSS, vanilla JS, SVG). The browser only loads `data.json`; it never calls the API.
- `.github/workflows/refresh.yml` refreshes `data.json` every hour and commits it. Vercel redeploys on each commit.

## Deploy (one command)
```
npm run deploy
```
This fetches fresh data and runs `vercel deploy --prod`. Any static host works: serve `public/`.
For hourly refresh on another host, run `npm run refresh` on a schedule.

## Run locally
```
npm run dev
```

## Rules it follows
Read-only. No wallet. No analytics or cookies. No names attached to addresses. Every number is computed from the endpoints listed in the Methods section of the page.
