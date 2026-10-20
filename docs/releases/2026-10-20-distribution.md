# GroundControl distribution update · 20 October 2026

Start from your computer, choose local Docker or a Linux server, then open the setup link. Add a project from a folder picker or GitHub and connect existing deployments or launch a new instance.

## Included

- Local/remote launcher with private links and reconnect support.
- Desktop onboarding that describes the Docker workspace accurately.
- Application-centered projects with separate sources, deployment names and environments.
- Folder browsing, non-Compose project discovery and GitHub repository import.
- Grouped Compose suggestions with persistent Dismiss, Undo and Restore hidden.
- Local single-image launches and the existing Linux template deployment flow.
- Current main’s image build/publish and digest-based release features.

## Existing installations

Publishing this release does not upgrade existing instances. The production deployment job is explicitly opt-in. The two project migrations preserve the legacy workload records, IDs, release history and grants, add source records, and allow separate instances to share a source directory. Back up and rehearse a production upgrade against a copy before using the canonical server upgrade path. Desktop launcher reruns reconnect; they do not upgrade.

## Validation

The merged application suite and production build passed locally. Nine launcher tests pass. A synthetic migration rehearsal preserves every old column across 48 existing tables, checks foreign keys and integrity, migrates source records, and permits separate instances sharing a source directory. Server and desktop image acceptance run in GitHub Actions before `latest` is promoted; consult the release’s workflow results for the published-image result.

## Try it and share it

- [Start from your computer](../start-from-your-computer.md)
- [Projects and deployments](../projects-and-deployments.md)
- [Announcement and demonstration guide](../LAUNCH-PLAYBOOK.md)
- [Public installation guide](https://trygroundcontrol.serendepify.com/docs/getting-started)
