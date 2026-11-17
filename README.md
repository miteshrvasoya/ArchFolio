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
- `js/plan/analyse.js` — reads walls, doors, windows, rooms and the footprint from an uploaded plan image.
- `js/plan/furnish.js` — guesses room types and lays out furniture, plants and lamps per room.
- `js/plan/viewer.js` — builds and renders the model (massing, cut plan or full 3D; finishes, lighting, styles, sections, site) and exports PNG/GLB.
- `js/plan/sample.js` — the built-in sample plan.
- `vendor/addons/` — Three.js OrbitControls and GLTFExporter, used only by the Plan to 3D page.
- `js/scene.js` — the 3D study model (Three.js, vendored in `vendor/`).
- `index.html`, `css/style.css` — page copy and styling.
