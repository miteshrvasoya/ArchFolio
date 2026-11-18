# .PLN architects — portfolio and practice dashboard

- **Portfolio** — the original static site (HTML/CSS/JS, Three.js) in `public/`, served at `/`.
- **Plan to 3D** — `public/plan-to-3d.html`, an in-browser floor-plan-to-3D tool.
- **Practice dashboard** — `/dashboard`, a private Next.js app for clients, projects, agreements and
  payments, with shareable agreements at `/agreement/[token]`. See **[docs/dashboard.md](docs/dashboard.md)**.

## Run locally

```bash
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_DASHBOARD_PASSCODE
npm run dev                    # portfolio: http://localhost:3000  ·  dashboard: /dashboard
npm run check                  # lint + type-check + unit tests + production build
```

## Deploy

Deploy as a Next.js app (Vercel or Netlify, no extra configuration). Set the environment variable
`NEXT_PUBLIC_DASHBOARD_PASSCODE`. (The site is no longer a plain static folder: the public agreement
route accepts any share token.)

## Editing the portfolio

- `public/js/projects.js` — project list, photo captions and contact details.
- `public/assets/img/` — photographs.
- `public/index.html`, `public/css/style.css` — page copy and styling.
- `public/js/scene.js` — the 3D study model on the home page.
- Plan to 3D: `public/plan-to-3d.html`, `public/js/plan-tool.js`, `public/css/tool.css`, and the engine in
  `public/js/plan/` (`analyse.js`, `linework.js`, `furnish.js`, `viewer.js`, `sample.js`).

## Dashboard code

`app/dashboard/**`, `app/agreement/[token]`, `components/**`, `lib/{schemas,repositories,storage,sharing,logic,format,hooks}`,
sample data in `data/seed/` (fake data only — never commit real client data; `data/real/` is git-ignored).
