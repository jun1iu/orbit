# orbit

A portfolio site example: one dark page whose WebGL point cloud (Three.js) reshapes itself as you
scroll. Live at <https://orbit.jun-liu.net>.

The person on the page, **Sol Arden**, is fictional, and so are the projects, employers and
school. Links point at `example.com`.

## The scene

One cloud of points forms a different picture behind each section:

| Section | Picture |
| --- | --- |
| Hero, Contact | The Earth, drawn from real coastlines, with an arc from Phoenix to Hong Kong |
| About | Victoria Harbour at night |
| Work | The Sonoran desert at sunset |
| Expertise | The New York skyline |
| Experience | Paris |
| Toolkit | A star field |

## Run locally

    node scripts/build.mjs                  # writes dist/ and the sitemap
    python3 -m http.server -d dist 8000     # then visit http://localhost:8000

No dependencies to install. The contact form needs a server, so locally it reports that it could
not send.

## Make it yours

- **Words:** everything visible is in `index.html`. The logo (`Sol.A`) appears in the loader and
  the header.
- **Address:** replace `orbit.jun-liu.net` in `index.html`, `robots.txt` and the `SITE` constant
  in `scripts/build.mjs`.
- **Preview image:** `og-image.png` (1200 x 630) carries the name, so replace it.
- **Scenes:** the `THEMES` array at the top of `main.js` sets each section's colours and picture.
  The pictures are drawn by `harbour()`, `desert()`, `newYork()` and `paris()`; each landmark is a
  line or two, so they are easy to change. The arc's two cities are `PHX` and `HKG`.
- **Contact form:** it posts JSON to `/api/contact` and expects `{ ok: true }` back, or `422`
  with `{ errors: { field: message } }`. Point it at your own service, or swap the form for a
  `mailto:` link.
- **Languages:** English only for now. Add a `locales/<language>.json` file of
  `[English, translated]` pairs with `"published": true`, and the build writes a page for it.

## Files

- `index.html`, `style.css`, `main.js`: the site
- `contact.js`: the contact form, kept separate so it works even if WebGL fails
- `vendor/three.module.min.js`: Three.js r160 (MIT licence)
- `scripts/build.mjs`: the build
- `vercel.json`, or `Dockerfile` with `Caddyfile`: two ways to deploy

## Deploying

- **Vercel:** import the repo. `vercel.json` runs the build and serves `dist/`. There is no
  contact API there until you add one.
- **Docker:** the `Dockerfile` builds the site into a Caddy image that serves it on port 8080 and
  forwards `/api/contact` to `contact-api:3001` (a placeholder for your own service).

## Built to hold up

- If the script fails or is blocked, the loader steps aside after 8 seconds and the content
  shows. With JavaScript off, it shows straight away.
- Motion respects `prefers-reduced-motion`.
- Phones and slow machines get fewer points and a lower resolution.

## Licence

[MIT](LICENSE): free to use, change and share, including commercially, as long as the licence
notice stays with it. Three.js (in `vendor/`) is also MIT; the coastline data comes from Natural
Earth, which is public domain.
