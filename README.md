# iTube

A browser-local, mixed YouTube + X discovery app with explicit interests, saved videos and publication-aware recommendations. This is a clean, generic source release, not a copy of a particular person's feed or research history.

## Run

Use Node.js 22 or newer.

```sh
npm ci
cp .env.example .env.local
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Edit `.env.local`: choose a strong private `ITUBE_PASSWORD` and use a separately generated random value for `ITUBE_SESSION_SECRET`. The checked-in example contains placeholders, not working credentials. Never commit either real value. Then run:

```sh
npm start
```

Open http://localhost:4187. Missing or placeholder credentials fail closed. Sign-in is remembered for 30 days with a signed HttpOnly cookie. This shared-password gate is for casual privacy, not a multiuser identity system.

## Make it yours

Open **Preferences & data** to set an optional name, an optional X username, and explicit interests. Profile settings stay in that browser; exports are deliberate. Resetting the profile must not erase saves or history. Clearing browser storage does remove local settings.

Name and handle identify your local profile; they do not connect an X account, import follows/bookmarks, verify ownership, or automatically create a new feed. Interests rerank the available library. Original-source links and third-party embeds remain controlled by YouTube and X; X's widget is trusted third-party JavaScript, not an isolated private processing boundary.

The mixed feed supports **Recent + relevant**, **For you**, **Newest**, and original-publication windows. Chronological sorting is global across both sources. Existing browser preference keys are retained for compatibility; legacy URL aliases are not default identities.

## Data is separate from code

Only a tiny, intentionally public editorial demo is included. Its labels and summaries are original explanatory notes around credited original links. It is not a complete HN archive, platform metadata dump, or a personal research trail. See [DATA-SOURCES.md](DATA-SOURCES.md).

To use a private edition, place its JSON files in the ignored `private-data/` directory and set `ITUBE_DATA_DIR=private-data` in local configuration. This overrides the demo for local serving/builds without committing a personal collection. Expected files are `videos.json` (array), `fresh-youtube.json` (array), `discoveries.json` (edition object), `areas.json` and `manifest.json`; optional `comments/VIDEO_ID.json` contains evidence you are authorized to use. Supply your own appropriately sourced data. Keep credentials out of data folders. For hosted builds, set the data directory in the build environment and provide the private data through a private deployment input—not through this public repository.

The HackerTube project provides a separately licensed source dataset at https://hackertube.org/data. Its database attribution, individual-content rights and platform metadata terms are separate concerns. This release does not bundle its archive, copied comments, enrichment cache or raw creator descriptions.

## Tests and builds

```sh
npm test
npm audit --omit=dev
node scripts/build.mjs
```

The build copies only browser assets and the selected data folder into `dist`. The local server, auth source and environment files are not static browser assets.

## Hosting and security

The included Vercel configuration gates every route through `proxy.js`. Set independent production auth variables before deploying. Keep preview deployments protected and verify anonymous asset/data requests are denied. Do not publish `dist` on an ordinary static host expecting the password to protect it: the gate requires the server/middleware. The public source does not grant access to anyone's private hosted edition.

A password change alone does not revoke existing sessions; rotate the session signing secret for global revocation. See [SECURITY.md](SECURITY.md).

## Licensing

No general application-code reuse license has been granted yet. Public visibility is not a blanket license for code or third-party content. Platform videos remain their creators' work. The separately distributed HackerTube database has its own ODC-By attribution requirements, which do not automatically license every underlying comment or platform field. Dependencies retain their stated licenses. No video or image binaries are rehosted here.
