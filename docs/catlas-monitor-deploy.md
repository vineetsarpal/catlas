# GitHub deployment of Monitor to the VPS

`.github/workflows/deploy-monitor-vps.yml` runs type checks, tests, deployment rollback tests and the build on relevant pushes and pull requests. Deployment is **disabled until `MONITOR_VPS_DEPLOY_ENABLED=true`** is set as a repository variable. Only `main` can deploy; pull requests never get deployment credentials. The GitHub environment is `monitor-production`; optional required reviewers can be configured there.

The GitHub-hosted runner joins Tailscale temporarily, uploads a source archive over SSH with pinned host keys, installs production dependencies in a new release directory, switches `current`, restarts only `catlas-monitor.service`, and verifies unauthenticated requests get 401 and authenticated health gets 200. A failed health check restores the previous release and restarts it. On a failed first release the service is stopped. Database/archive services and existing tunnel/Funnel routes are not changed.

## Repository settings to fill in

Add these under **Settings → Secrets and variables → Actions**. Secrets must never be pasted into chat or committed.

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `MONITOR_VPS_HOST` | VPS Tailscale IPv4 address or MagicDNS name, e.g. `100.114.222.6` |
| Variable | `MONITOR_VPS_USER` | Unprivileged SSH/service user, e.g. `vineet` |
| Variable | `MONITOR_VPS_PORT` | SSH port; optional, defaults to `22` |
| Variable | `MONITOR_VPS_DEPLOY_DIR` | Dedicated absolute release root, e.g. `/home/vineet/apps/catlas-monitor`; no trailing slash or spaces |
| Variable | `MONITOR_VPS_NODE_PATH` | Absolute Node 24+ binary path from `readlink -f "$(command -v node)"` on the VPS |
| Variable | `MONITOR_VPS_DEPLOY_ENABLED` | Leave absent/false during setup; set `true` last |
| Secret | `TS_OAUTH_CLIENT_ID` | Dedicated Tailscale OAuth client ID |
| Secret | `TS_OAUTH_SECRET` | That client's secret |
| Secret | `MONITOR_VPS_SSH_KEY` | Dedicated, unencrypted deployment SSH private key; its public key must be authorized for the VPS user |
| Secret | `MONITOR_VPS_KNOWN_HOSTS` | Pinned SSH host public-key line for the exact host/port above |

Runtime `CATLAS_MONITOR_TOKEN`, AIS and FIRMS keys remain in the VPS user's owner-only `~/.config/catlas-monitor.env`. GitHub does not need them. The deployed process and authenticated health check read this local file. Do not copy it into release archives.

## One-time VPS preparation (you run these commands)

First complete the checkout and private environment creation in [the VPS guide](catlas-monitor-vps.md), or use an existing checkout containing these scripts. Keep the private environment file when switching to automated releases.

From that checkout, as the same normal user who will deploy:

```sh
mkdir -p "$HOME/apps/catlas-monitor/incoming" "$HOME/apps/catlas-monitor/releases"
CATLAS_MONITOR_DEPLOY_ROOT="$HOME/apps/catlas-monitor" \
  node scripts/monitor-service.mjs > "$HOME/.config/catlas-monitor.service"
cat "$HOME/.config/catlas-monitor.service"
```

The unit must use `WorkingDirectory=<release-root>/current/backend`, not the bootstrap checkout. It uses the absolute Node binary that generated the file. The `current` symlink will be created by the first deployment. If changing an existing running Monitor installation, stop that service before installing the new unit; the bootstrap checkout remains available for manual recovery.

Review the unit, then install and enable it without starting it yet:

```sh
sudo install -m 0644 "$HOME/.config/catlas-monitor.service" /etc/systemd/system/catlas-monitor.service
sudo systemctl daemon-reload
sudo systemctl enable catlas-monitor
```

Use `sudo visudo -f /etc/sudoers.d/catlas-monitor-deploy` to grant the deployment user just these two passwordless commands (replace `vineet` if necessary):

```sudoers
vineet ALL=(root) NOPASSWD: /usr/bin/systemctl restart catlas-monitor.service, /usr/bin/systemctl stop catlas-monitor.service
```

Do not grant unrestricted passwordless sudo. The service runs as the unprivileged deployment user. Node, npm, tar, util-linux `flock`, and systemd must be installed on the VPS. Node's directory must also contain the npm executable; standard Node/NVM installations do. The deployment rejects root SSH users, a mismatched service directory/user, symlinked release directories, missing/weak runtime credentials and incomplete existing releases.

## Tailscale and SSH access

Create a dedicated Tailscale OAuth client with **Auth Keys: Write** and tag **`tag:catlas-ci`**. Ensure your tailnet policy defines that tag and permits its devices to reach only this VPS's SSH TCP port. Preserve existing tailnet policy; do not replace it with broad access. With Tailscale SSH enabled on the destination, an appropriate SSH policy is also required. Otherwise normal OpenSSH authentication with the dedicated key is used. See the [official Tailscale GitHub Action setup](https://tailscale.com/docs/integrations/github/github-action).

Create the SSH key on a trusted computer, authorize its **public** key in the VPS user's `~/.ssh/authorized_keys`, and save only its **private** key as the GitHub secret. An OpenSSH `restrict` prefix on the authorized key disables forwarding and PTY while still allowing the noninteractive command/SFTP deployment. This key intentionally allows application deployment commands as that user; it is not a root key.

Pin the server's SSH host key from the already trusted VPS terminal, rather than trusting `ssh-keyscan` from a new connection. For port 22, this command prints a public known-hosts line (substitute the exact configured Tailscale IP/name):

```sh
awk -v host='100.114.222.6' '{print host " " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

For a nonstandard port, use `host='[100.114.222.6]:2222'` with your actual port. Save the line as `MONITOR_VPS_KNOWN_HOSTS`. It contains a public host key, not a tunnel token or private key. The workflow will refuse a mismatched host key. No public SSH port or self-hosted GitHub runner is needed.

## Enable and verify

After filling the settings and preparing the service, set the repository variable `MONITOR_VPS_DEPLOY_ENABLED=true`. Open **Actions → Check and deploy Monitor to VPS → Run workflow**, selecting `main`. Subsequent relevant pushes to `main` deploy automatically after checks. Deployments are serialized; `flock` also prevents overlapping remote activation.

Successful health verifies process startup and authentication, not live provider availability. Complete the tunnel/Pages bindings and actual wind/feed checks in [the VPS guide](catlas-monitor-vps.md). No hostname or Pages secrets are changed by this workflow.

Releases and source archives are retained in the dedicated release root. Monitor disk usage and remove old, unused releases manually only after confirming they are not `current` or needed for rollback. A failed dependency install leaves the active release untouched. An interrupted SSH session can require checking the active service/current pointer before retrying; the workflow does not promise zero-downtime deployment or automatic recovery from a VPS/network outage.

To disable automatic deployment, set the enable variable to `false`. This does not stop the existing running service.
