# Build the site into dist/ (see scripts/build.mjs).
FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN node scripts/build.mjs

FROM caddy:2
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist/ /srv/orbit/

# A CDN in front of the site caches scripts and styles. Version each URL by content hash
# so a changed file is always fetched fresh. The build fails
# if a rewrite did not apply.
RUN cd /srv/orbit \
 && for page in $(find . -name index.html); do \
      for f in style.css main.js contact.js vendor/three.module.min.js; do \
        h=$(md5sum "$f" | cut -c1-10); \
        sed -i "s|\"/$f\"|\"/$f?v=$h\"|" "$page"; \
        grep -q "/$f?v=$h" "$page" || { echo "version rewrite failed for $f in $page"; exit 1; }; \
      done; \
    done
