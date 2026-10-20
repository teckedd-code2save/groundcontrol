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

If you already have an account, setup prints a login link and leaves your account in place.

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

The launcher uses your normal SSH configuration. Existing host aliases, SSH-agent keys, and default keys work. Your SSH private key stays on your computer.

```bash
# Saved SSH host
bash groundcontrol-start --remote production

# Specific key and SSH port
bash groundcontrol-start --remote ubuntu@YOUR_SERVER -i ~/.ssh/server_key -p 2222
```

The launcher downloads and verifies the canonical installer on the server, then creates the secure connection back to your computer automatically. You do not need to open a second terminal or expose a management port.

Keep the setup terminal open while using the link. Press Ctrl+C when finished; GroundControl continues running on the server. Run the same command later to reconnect.

After claiming the instance, the browser can guide you through a permanent HTTPS domain or supported publishing option. You can also keep using the private link.

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
