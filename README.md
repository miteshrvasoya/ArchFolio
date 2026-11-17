# .PLN architects — portfolio

Portfolio site for .PLN architects (Ar. Ayush Vasoya, Surat). Plain static HTML/CSS/JS with no build step.

## Run locally

ES modules need a server, so open it through one rather than double-clicking `index.html`:

    python3 -m http.server 8000

## Deploy

Publish the repository root as a static site (GitHub Pages, Vercel, Netlify, Cloudflare Pages). No build command; output directory is `/`.

## Editing

- `js/projects.js` — project list, photo captions and contact details. Projects with `images` appear as featured works.
- `assets/img/` — photographs.
- `plan-to-3d.html`, `js/plan-tool.js`, `css/tool.css` — the Plan to 3D page (linked from the home page).
- `js/plan3d.js` — its engine: reads walls, doors, windows and rooms from an uploaded plan image and builds the model (massing, 1.2 m cut plan or full 3D), entirely in the browser. Exports PNG and GLB.
- `vendor/addons/` — Three.js OrbitControls and GLTFExporter, used only by the Plan to 3D page.
- `js/scene.js` — the 3D study model (Three.js, vendored in `vendor/`).
- `index.html`, `css/style.css` — page copy and styling.
