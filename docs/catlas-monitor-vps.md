# Monitor on the existing VPS

Monitor runs as an unprivileged Node 24+ process on `127.0.0.1:3001`. The existing Cloudflare Tunnel forwards a dedicated HTTPS hostname to that address. The Pages Function at `/api/monitor/*` authenticates to the backend; the browser never receives the token. Existing Tailscale Funnel routing on port 8644 is unrelated and must remain unchanged.

The server owner runs the commands below. No remote commands or SSH permission changes are required from Codex. This setup does not subscribe to Workers Paid or deploy Cloudflare Containers. The bridge is an API credential boundary, not end-user authentication: the enabled public Catlas site can request public feeds. Existing acquisition/cache bounds and per-client rate limits still apply.

## 1. Install the application as your normal VPS user

Node 24+, npm, Git and Python 3 must be available. Do not run npm as root. For a new checkout:

```sh
mkdir -p ~/apps
git clone https://github.com/vineetsarpal/catlas.git ~/apps/catlas
cd ~/apps/catlas
npm ci --omit=dev --workspace=@catlas/backend --workspace=@catlas/shared
node scripts/init-monitor-env.mjs
```

The initializer creates `~/.config/catlas-monitor.env` with a random 32-byte token and file mode 0600; it refuses to overwrite an existing file. Keep that file outside Git and never post its contents in chat. Optional AISStream and NASA FIRMS keys can be entered with `nano ~/.config/catlas-monitor.env`. Missing keys leave the corresponding feeds explicitly unconfigured; keyless sources remain usable.

## 2. Review and install the service

Generate the unit using the same Node binary and unprivileged user that will run it:

```sh
cd ~/apps/catlas
node scripts/monitor-service.mjs > "$HOME/.config/catlas-monitor.service"
cat "$HOME/.config/catlas-monitor.service"
sudo systemd-analyze verify "$HOME/.config/catlas-monitor.service"
sudo install -m 0644 "$HOME/.config/catlas-monitor.service" /etc/systemd/system/catlas-monitor.service
sudo systemctl daemon-reload
sudo systemctl enable --now catlas-monitor
systemctl is-active catlas-monitor
```

The unit restarts after failure and on reboot, uses read-only application/home files, a private temporary directory, and a 1 GiB memory limit. This is an initial resource bound, not a measured peak requirement. Review memory under a real wind-decoding request before changing it. Node upgrades that change its absolute path require regenerating the unit. The backend always binds loopback, including authenticated mode; no firewall port needs opening.

## 3. Verify authentication locally

Unauthenticated health must return **401**, including on localhost:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/monitor/health
```

Verify the matching credential without putting it in shell arguments or printing it:

```sh
node --env-file="$HOME/.config/catlas-monitor.env" --input-type=module - <<'NODE'
const response = await fetch('http://127.0.0.1:3001/api/monitor/health', {
  headers: { authorization: `Bearer ${process.env.CATLAS_MONITOR_TOKEN}` },
});
console.log('HTTP', response.status);
if (!response.ok) process.exitCode = 1;
else console.log(await response.json());
NODE
```

Expected: HTTP 200, status `ok`; `vesselsConfigured` may be false without an AIS key. `systemctl is-active` and these responses are safe to share. Do not post full environment files or startup commands containing credentials.

## 4. Connect the existing Cloudflare Tunnel

In the healthy VPS tunnel, save a published hostname such as `catlas-monitor-api.<your-domain>` pointing to **HTTP / 127.0.0.1:3001**. Preserve other tunnel routes and the separate Funnel configuration. Do not override the HTTP Host header to bypass local checks; hosted requests use bearer authentication. The tunnel connector must run on the VPS host, as the inspected system service does; a connector inside a different container would have a different loopback address.

Open `https://<your-monitor-hostname>/api/monitor/health` without a token: **401** confirms the tunnel reaches the authenticated service. A 502 means the connector cannot reach Monitor. A Cloudflare Access login page indicates an additional Access policy that needs a service-token integration; do not disable an existing Access policy to get around it.

## 5. Configure and enable the Pages bridge

In **catlas-workbench → Settings → Variables and Secrets → Production**, set:

| Name | Type | Value |
| --- | --- | --- |
| `MONITOR_API_ORIGIN` | Plain text | `https://<your-monitor-hostname>`; no API path |
| `MONITOR_API_TOKEN` | Secret | The exact `CATLAS_MONITOR_TOKEN` from the private VPS file |
| `VITE_CATLAS_BACKEND` | Plain text | `true` |

Copy the token privately from the VPS environment file into the encrypted Cloudflare field yourself. Do not send it through chat, put it in a URL, or use a `VITE_` variable for it. Keep preview Monitor disabled until a trusted preview setup is explicitly configured.

Change the Pages build command from `npm run package:offline` to **`npm run package:pages`**, preserving build root and output `release/pages`, then redeploy. This packages the offline ZIP with backend integration disabled, then builds the enabled hosted UI separately into Pages. Host-only application bundles may coexist with the offline bundles in Pages assets; the ZIP and its manifest remain unchanged by the hosted build.

Check `https://catlas-workbench.pages.dev/api/monitor/health` returns 200. Then enable wind in Monitor and verify a real NOAA decode and forecast time. Verify keyless fire/weather feeds and, when configured, real AIS observations. Missing provider keys must not be presented as live data. No browser portfolio or reinsurance data is sent by this bridge; vessel queries send public viewer identifiers and map bounds.

## Updates and rollback

An opt-in [GitHub Actions deployment](catlas-monitor-deploy.md) is available using Tailscale and SSH. It requires the one-time release-based systemd setup and repository settings described there. Until enabled, use the manual checkout deployment below. Do not run these manual checkout updates against a release directory managed by the workflow. Record the current `git rev-parse HEAD`, then in the checkout run:

```sh
git pull --ff-only
npm ci --omit=dev --workspace=@catlas/backend --workspace=@catlas/shared
sudo systemctl restart catlas-monitor
systemctl is-active catlas-monitor
```

Repeat health and relevant provider checks. For rollback, check out the previously recorded release commit, reinstall its pinned dependencies, and restart. In-memory caches and vessel trails reset; browser-local portfolios and saved investigations are unaffected. Disable hosted Monitor with `VITE_CATLAS_BACKEND=false` and a Pages rebuild if needed. Stop the VPS process with `sudo systemctl stop catlas-monitor`; do not change unrelated services.
