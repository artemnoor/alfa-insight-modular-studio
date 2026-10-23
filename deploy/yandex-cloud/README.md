# Alfa Insight Studio on one Yandex Cloud VM

This deployment keeps the existing VM and Nginx installation. It serves the
Vite build as static files, runs the existing Python API on loopback only, and
places an Nginx Basic Auth gate in front of both. No CSV, SQLite, RAG index,
`.env`, or AI credentials are included in the release.

## Runtime layout

- API source: `/home/yc-user/deploy/alfa-insight/app`
- Python environment: `/home/yc-user/deploy/alfa-insight/venv`
- Frontend: `/var/www/alfa-insight/dist`
- API: `127.0.0.1:8097`, managed by `alfa-insight-api.service`
- Public entry: HTTPS Nginx virtual host

The default deployment has external AI disabled and uses the module fixture
scenarios. To enable manual external calls later, configure the approved model
and an API key in a root-readable systemd environment file; do not put secrets
in the repository. Do not copy client data to this VM without a separate
explicit data-transfer decision.

The small VM is shared with another service. Keep API concurrency low and do
not run local model servers, Streamlit, or a second database server here.
The News Intelligence fixture adapter starts the existing JavaScript T08/T09
pipeline with `node`; install the official Node.js 22 runtime even though the
frontend is already built. The deployment currently uses Node.js 22.23.4
(`node-v22.23.4-linux-x64.tar.xz`, SHA-256
`1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce`), verified
against the [official Node.js release](https://nodejs.org/en/blog/release/v22.23.4/).
Runtime npm packages are not installed globally.

Nginx protects the Studio and API with Basic Auth and redirects HTTP to HTTPS.
The Let's Encrypt certificate is renewed by Certbot. To rotate the viewer
password, run `sudo htpasswd -B /etc/nginx/.htpasswd-alfa-insight alfa-viewer`
and reload Nginx.

