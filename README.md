# Sydney, Side by Side

A private two-person trip planner.

## Stack

- Next.js (static export)
- Supabase (Postgres, Auth, Storage, Realtime)
- GitHub Pages (deployed with GitHub Actions)

## Local development

Requires Node 24 (see `.nvmrc`).

```bash
cp .env.example .env.local   # then fill in the values
npm install
npm run dev
```

## Deployment

Pushing to `main` builds the static site and deploys it to GitHub Pages through GitHub Actions.
Build-time public settings are stored as GitHub Actions variables. Secret keys are never committed.
