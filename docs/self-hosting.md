# Self-hosting

Run one Node service with persistent disk for one trusted studio. The SQLite database owns immutable images, versions, comments, request snapshots, approval history and hashed credentials. No external database or model-provider account is required.

For local Docker use:

```sh
docker compose up --build -d
docker compose exec gallery cat /data/owner-secret
```

The compose file binds to localhost and keeps `/data` in a named volume. Enter its private owner secret at <http://localhost:4199>. Docker execution was not part of the local verification receipt; the native production server was verified.

## Share remotely

Configure an HTTPS reverse proxy and persistent volume on your own server. Set these environment values privately:

```sh
HOST=0.0.0.0
PORT=4199
STATE_GALLERY_DATA=/private/persistent/gallery
STATE_GALLERY_HOSTED=true
STATE_GALLERY_ORIGIN=https://review.example.com
STATE_GALLERY_OWNER_SECRET=a-long-random-secret
```

Hosted mode refuses startup without an HTTPS origin and explicit owner secret. Terminate TLS at the proxy, forward to the Node service, and allow at least a 40 MB JSON request limit. Keep the backend private, preserve the browser Origin, and disable request-body/Authorization logging. No permissive CORS is enabled; browser writes require the exact origin. Secure HttpOnly SameSite=Strict cookies protect hosted sessions. The app does not trust arbitrary forwarded IP headers; behind a proxy failed-login rate limits therefore share the proxy socket address.

A reviewer link is a journey-scoped capability with expiry/revocation, not a verified user account. An agent credential is a separate capability and cannot approve or manage access. Protect the database and installation secret as sensitive files. Expose only the service's HTTP endpoint, never the data directory. Avoid a logging proxy that records fragment exchanges or bearer credentials.

Public deployment, domain provisioning and real external client sharing are subsequent operator actions. The release implements shared links against a real locally verified server; it has not been publicly hosted or published.

## Backup and restore

Stop the service first, then copy the **entire private data directory**, including `gallery.sqlite`, any WAL/SHM files and `owner-secret`, to encrypted/protected backup storage. Copying only a live main SQLite file can lose uncheckpointed data. Restart after the copy.

To restore, stop the service, replace its private data directory from the backup, restore private ownership/permissions, and restart with the same origin/configuration. Existing grants, sessions and decisions are restored too. Revoke any access that should no longer be valid. Database reopen tests verify retained images, discussions, requests and approval history.

Updating the installation secret changes future owner login; stored owner sessions last up to 24 hours. To invalidate all sessions immediately, stop the service and clear the `auth` table using a trusted local SQLite administration tool, then restart. This also removes reviewer/agent grants; reissue intentionally.
