# Start GroundControl from your computer

Choose where GroundControl should run, run setup, then open your personal setup link.

## 1. Download and start

Open Terminal on macOS or Linux, or a WSL terminal on Windows:

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/start -o groundcontrol-start
bash groundcontrol-start
```

Setup asks you to choose **this computer** or **a remote Linux server**. You can also choose directly:

```bash
# This computer
bash groundcontrol-start --local

# Your server, using the same address you use for SSH
bash groundcontrol-start --remote root@YOUR_SERVER
```

## 2. Open the link

Setup checks that GroundControl is reachable and prints one link. On a new installation, open it and choose your administrator username and password. The link expires after 30 minutes and can be used once. Run setup again if you need a new link.

If you already have an account, setup prints a login link and leaves your account in place. In macOS Terminal, hold Command and click the URL, or copy it into your browser. Set `GC_TERMINAL_LINKS=0` if your terminal does not handle clickable links correctly.

## This computer

Install and start Docker Desktop on macOS/Windows, or Docker Engine on Linux. Docker must be using Linux containers and a local Docker context. On Apple Silicon, the published AMD64 image runs through Docker Desktop's emulation; startup may be slower. Native ARM server installation is a separate, currently unsupported path.

Local mode gives you a Docker workspace. It can inspect and operate Docker containers, and you can add remote Linux servers in Connections. It does not manage native Mac/Windows services or enter Docker Desktop's internal Linux host. Operations requiring a Linux host should use a remote server target.

- The browser link is private to your computer; no domain is needed.
- You can close the setup terminal after receiving the link. Keep Docker running.
- Settings and login data live in the `groundcontrol-desktop-db` Docker volume.
- Encryption keys live in `~/.groundcontrol-desktop/.env`; preserve this file with database backups.
- The shared workspace is `~/.groundcontrol-desktop/workspace`. Its path is mounted unchanged so Docker can resolve project paths.
- Run `bash groundcontrol-start --local` again to start/reconnect to an existing installation and obtain its login link.
- This launcher does not upgrade an existing desktop instance. Desktop version upgrades require a separate validated backup/update path.

Windows currently uses WSL for the launcher; a native PowerShell launcher is not included.

## A remote server

Use an AMD64 Linux server, such as an Intel/AMD Ubuntu or Debian VPS. Connect as root or an account with passwordless sudo. The server needs Bash and either curl or wget; the server installer handles Docker installation if required.

The launcher uses your normal SSH configuration. Existing host aliases, SSH-agent keys, and default keys work. Interactive remote setup asks for an optional SSH private-key file path. Press Enter to keep your existing SSH settings, or enter the path to the key for that server (for example `~/.ssh/server_key`). Do not paste the key contents. Your SSH private key stays on your computer.

```bash
# Saved SSH host
bash groundcontrol-start --remote production

# Specific key and SSH port
bash groundcontrol-start --remote ubuntu@YOUR_SERVER -i ~/.ssh/server_key -p 2222
```

The launcher downloads and verifies the canonical installer on the server. By default, a fresh server setup creates an outbound temporary HTTPS tunnel, verifies that it reaches this GroundControl instance, and prints your one-time setup link. The command then exits: you can close Terminal and finish setup in the browser. No inbound management port is opened.

Keep the setup link private. Its fragment contains the one-time owner claim; do not show it in recordings, screenshots or shared terminal logs. After choosing your account, use the sign-in URL without the claim fragment.

**Temporary access: configure a permanent domain.** The HTTPS address is public, with account-protected management access. It is not a private network link. Its connector does not automatically restart after a server reboot; recreating it changes the URL and requires updating bookmarks and agent connections. [Quick tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) have no uptime guarantee and do not support server-sent event streams. Finish permanent-domain setup using a named Cloudflare Tunnel or HTTPS proxy for ongoing use.

Rerunning setup reuses a working published URL rather than rotating it. It preserves an existing permanent domain and any deliberately saved private-only configuration. If temporary access cannot be established, the installer leaves the healthy instance in place and tells you how to reconnect privately; it does not claim public access succeeded.

### Moving to a permanent address

The temporary tunnel is an initial bridge, not a permanent GroundControl address. A GC-provided subdomain (similar to a hosted platform's default application domain) is a separate product capability and is **not available yet**. Recreating a quick tunnel does not provide that guarantee.

The implemented permanent options use a domain you control:

- **Direct HTTPS with Caddy:** create a DNS-only A record pointing to the server's public IPv4 address. Allow inbound TCP 80 and 443 in both cloud and host firewalls, with your operator's approval. GC installs/configures Caddy on supported Linux hosts but does not open those firewall rules. The current setup check does not support IPv6-only or proxied DNS. Keep the GC management port loopback-only.
- **Named Cloudflare Tunnel:** use a zone in your Cloudflare account and a securely supplied token with zone read, DNS edit and account tunnel edit permissions. Supply the account ID when the token can see more than one account. GC configures tunnel/DNS and keeps the origin private; no inbound management port is needed.

Existing access is retained until replacement HTTPS, instance identity and OAuth/MCP discovery checks pass. Discovery is not a substitute for testing a real agent login and operation. Verify that yourself before treating the permanent route as production-ready.

### Private-only access and recovery

```bash
bash groundcontrol-start --remote ubuntu@YOUR_SERVER --private
```

This skips public tunnel creation and opens an SSH-only browser link. Keep Terminal open while using that private link; Ctrl+C closes the connection without stopping GroundControl. Existing public access is not disabled by this flag. If you want to remove it, use the authenticated access settings after signing in.

Make one access change at a time. If setup is interrupted or reports incomplete
cleanup, reconnect privately and inspect the connector/DNS state before retrying.
Access changes are not yet durable, crash-recoverable operations.


## Add projects already on your computer

Open **Projects → Add project → Choose a folder**. Select a location, browse its folders, and choose your project. Review its detected technology, name, and purpose, then add it. You do not need to paste a path. With a remote connection selected, the picker browses that server instead of your computer.

For GitHub, choose **Import from GitHub**. Select a repository from your connected GitHub App, browse a public user or organization, or use a repository URL. Private repositories require a connection with access. Importing records the repository and default branch; it does not clone or execute the project.

A project is the home for an application or product. It can have several source folders and deployments, or no deployment yet. Open the project and choose **Add deployment** to connect an existing app or launch a new instance. See [Projects and deployments](./projects-and-deployments.md).

Discovery recognizes common JavaScript/TypeScript, Python, .NET, Go, Rust, Java/Kotlin, PHP, Ruby, static-site, Docker, and Git markers. Compose is optional. The scan checks filenames up to three directories below the selected folder, skips dependency/build directories, and does not follow nested symlinks or execute project code. Native Windows drive-letter paths are not supported by this folder picker yet; use the locations available through WSL/Docker.

Desktop scans use a temporary, read-only Docker mount for the exact folder selected. If Docker cannot access it, add that folder in Docker Desktop’s file-sharing settings and retry. Source files remain in place. Adding a source does not deploy it. Local launches accept a ready-to-use Docker image and app port. Builds from source, multi-service applications and custom environment configuration use the Linux-server template workflow.

Suggestions group Compose services into one app. **Dismiss** hides an unwanted suggestion on that connection without deleting or stopping anything. **Undo** and **Restore hidden** bring suggestions back. Dismissals persist after refresh and restart. GroundControl’s own containers and helpers are excluded.

## If setup stops

| Message | What to do |
|---|---|
| Docker is missing or stopped | Install/start Docker, then rerun local setup. |
| SSH connection failed | Check the same address and key with ordinary SSH first. |
| Account needs passwordless sudo | Use the server's root account or an appropriately configured administrator account. |
| Server requires AMD64 | Use an Intel/AMD Linux server. ARM servers are not supported by the published image yet. |
| Local port is busy | Setup normally chooses another port. For a chosen port, retry with `--local-port 43003`. |
| Existing database has no matching `.env` | Restore the original configuration or supply its directory with `--dir`; do not generate replacement encryption keys. |
| Image predates desktop setup | Publish/use a desktop-capable GroundControl image; an older image cannot run this mode correctly. |
| Remote link stopped working | Keep the setup terminal open, or rerun the same command to reconnect. |

For contributors testing an unpublished image:

```bash
docker build -t groundcontrol-desktop:test .
bash scripts/start --local --image groundcontrol-desktop:test --dir /path/to/test-config
```

The launcher and the desktop-capable image must be released together. Do not advertise the new public download command before `scripts/start` exists on `main` and the published image has passed the desktop acceptance checks.

## Testing a candidate remote release

The normal command above uses the installer from `main`. `--version` selects only
the container image; it does not select the installer source. To test an unreleased
installer from your computer, download the launcher from the reviewed commit and
pin its installer explicitly:

```bash
# Replace these with a reviewed full commit and its published image tag.
COMMIT=FULL_40_CHARACTER_COMMIT_SHA
IMAGE_TAG=PUBLISHED_IMAGE_TAG
curl -fSL "https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/$COMMIT/scripts/start" -o groundcontrol-start
bash groundcontrol-start --remote YOUR_SSH_ALIAS \
  --version "$IMAGE_TAG" --installer-ref "$COMMIT"
```

`--installer-ref` accepts `main` or a full commit SHA, not a branch name or short SHA.
Setup downloads the installer and its SHA256 sidecar from that same revision and
checks the checksum before running it. It does not upgrade an existing healthy
instance. Use a disposable host or an explicitly reset test instance for fresh-install
acceptance; retaining Docker means this is not an absent-Docker prerequisite test.
Keep the one-time owner setup link, passwords and SSH key contents out of recordings.
