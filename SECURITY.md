# Security boundaries

Do not put passwords, API keys or signing secrets in source, issue reports or feedback exports. `.env.example` contains only placeholders. Configure independent credentials privately; the server refuses missing or placeholder configuration.

The app uses a shared-password gate, 30-day signed HttpOnly cookies, same-origin mutation checks and no-store responses. It is not a full account system. Runtime-local throttling is best effort; choose a strong password and use edge-level abuse protection for exposed installations.

Changing the password does not revoke existing signed sessions. Rotate `ITUBE_SESSION_SECRET` as well for global revocation. Logging out clears only that browser's cookie. Protect all deployment aliases/previews and test unauthenticated asset/data access.

Profile, feedback and saved/history state are browser-local until explicitly exported. YouTube/X playback has its own network and tracking behavior. X's top-level widget script is trusted third-party JavaScript and can access the app's origin; local storage is not an isolation guarantee against that script. Do not store sensitive material there.

Keep personal datasets, research trails and feedback exports out of public Git history. Report a suspected security issue privately to the repository owner; do not publish exploit credentials or private user data in an issue.
