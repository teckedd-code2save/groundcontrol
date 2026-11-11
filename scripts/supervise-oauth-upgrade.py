#!/usr/bin/env python3
"""Single approved upgrade. Private evidence stays on the host; no secrets in stdout."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

REVISION = 'e57f9bdfb200d2e8be905c49c1358d39bce25c08'
PRIOR_REVISION = '25202bc11fc09b41c6d8a88c5b22721ca0e9a38c'
IMAGE = 'ghcr.io/teckedd-code2save/groundcontrol@sha256:2bf1b55f1158c822fdc5d2ca5f54d23e7efd3cd19d1787727d65028a17769153'
PRIOR_IMAGE = 'ghcr.io/teckedd-code2save/groundcontrol@sha256:839199545a59aaae397e78819a51ff0e8437b7b45da8412d9a4a9fac087a0e1c'
STAGE = Path('/opt/gc-upgrade-staging/e57f9bd-20261111-systemd')
BACKUP = Path('/opt/groundcontrol/backups/oauth-e57f9bd-20261111')
UNIT = 'gc-upgrade-e57f9bd-20261111.service'
CONTAINER = 'groundcontrol-web'
ACTIVE = {'pending', 'running', 'verifying'}

def run(args, timeout=120):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError('command_failed:' + args[0] + ':' + str(p.returncode))
    return p.stdout.strip()

def inspect():
    return json.loads(run(['docker', 'inspect', CONTAINER]))[0]

def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def private_json(path, value):
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(value, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)

def manifest_matches(manifest, current):
    labels = current['Config'].get('Labels') or {}
    assert current['Config']['Image'] == PRIOR_IMAGE
    assert current['Image'] == manifest['imageId']
    assert labels.get('com.docker.compose.service') == 'web'
    assert labels.get('com.docker.compose.project') == manifest['composeProject']
    assert labels.get('com.docker.compose.project.working_dir') == manifest['composeWorkingDir']
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    assert files == [item['path'] for item in manifest['composeFiles']]
    assert files and all(Path(path).is_absolute() for path in files)
    assert all(sha(item['path']) == item['sha256'] for item in manifest['composeFiles'])
    env = Path(manifest['composeWorkingDir']) / '.env'
    assert env.exists() == manifest['envFile']['exists']
    assert not env.exists() or sha(env) == manifest['envFile']['sha256']
    mounts = [{'type': m['Type'], 'source': m['Source'], 'destination': m['Destination']}
              for m in current['Mounts'] if m['Destination'].startswith('/app/prisma')]
    assert mounts == manifest['persistentMounts'] and len(mounts) == 1
    assert current['State']['Running'] and current['State'].get('Health', {}).get('Status') == 'healthy'

def check_operations(root, expected_names):
    assert expected_names
    for name in expected_names:
        path = root / name
        assert path.is_file() and not path.is_symlink()
        db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=10)
        try:
            states = dict(db.execute('SELECT status,count(*) FROM AgentOperation GROUP BY status').fetchall())
            assert not any(states.get(status, 0) for status in ACTIVE), 'active_operation'
        finally:
            db.close()

def wait_healthy(expected_image, expected_revision, timeout=150):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        current = inspect()
        assert current['Config']['Image'] == expected_image, 'unexpected_image'
        if current['State'].get('Health', {}).get('Status') == 'healthy':
            image = json.loads(run(['docker', 'image', 'inspect', current['Image']]))[0]
            assert (image['Config'].get('Labels') or {}).get('org.opencontainers.image.revision') == expected_revision
            return current
        time.sleep(2)
    raise RuntimeError('health_timeout')

def http(url, body=None):
    headers = {'Content-Type': 'application/json', 'MCP-Protocol-Version': '2026-07-28'}
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()

def verify_public(require_fixed_auth):
    assert http('https://groundcontrol.serendepify.com/login')[0] == 200
    status, _, payload = http('https://groundcontrol.serendepify.com/mcp', {
        'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list', 'params': {}})
    assert status == 200
    data = json.loads(payload)['result']
    assert 'deployment.list' in {tool['name'] for tool in data['tools']}
    if require_fixed_auth:
        assert data['_meta']['io.groundcontrol/toolsetRevision'] == '2026-11-11.1'
        status, headers, payload = http('https://groundcontrol.serendepify.com/mcp', {
            'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
            'params': {'name': 'deployment.list', 'arguments': {}}})
        assert status == 401
        data = json.loads(payload)['result']
        challenge = headers.get('WWW-Authenticate', '')
        assert 'invalid_token' in challenge and data['isError'] is True
        assert data['_meta']['mcp/www_authenticate'] == [challenge]

def compose_base(manifest):
    result = ['docker', 'compose', '--project-directory', manifest['composeWorkingDir'],
              '--project-name', manifest['composeProject']]
    for item in manifest['composeFiles']:
        result += ['-f', item['path']]
    return result

def write_override(path, image):
    assert re.fullmatch(r'ghcr\.io/teckedd-code2save/groundcontrol@sha256:[a-f0-9]{64}', image)
    path.write_text('services:\n  web:\n    image: "' + image + '"\n    pull_policy: never\n')
    path.chmod(0o600)

def stop_if_running():
    current = inspect()
    assert current['Config']['Image'] in {IMAGE, PRIOR_IMAGE}, 'unexpected_rollback_target'
    if current['State']['Running']:
        run(['docker', 'stop', '-t', '30', CONTAINER], timeout=60)

def upgrade():
    os.umask(0o077)
    assert os.geteuid() == 0 and os.getppid() == 1
    assert ('/system.slice/' + UNIT) in Path('/proc/self/cgroup').read_text()
    assert STAGE.is_dir() and not (STAGE / 'result.json').exists(), 'inspect_previous_outcome_before_retry'
    with open('/opt/groundcontrol/.oauth-upgrade.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert not (STAGE / 'result.json').exists(), 'inspect_previous_outcome_before_retry'
        return perform_upgrade()

def perform_upgrade():
    manifest = json.loads((STAGE / 'preflight.json').read_text())
    current = inspect()
    manifest_matches(manifest, current)
    dbroot = Path(manifest['persistentMounts'][0]['source'])
    assert dbroot.is_dir() and dbroot.is_absolute()
    assert not any(path.is_symlink() for path in dbroot.rglob('*')), 'unexpected_storage_symlink'
    data_size = sum(path.stat().st_size for path in dbroot.rglob('*') if path.is_file())
    assert shutil.disk_usage(dbroot).free > data_size * 3 + 1024 ** 3, 'insufficient_backup_space'
    check_operations(dbroot, manifest['operationStates'])
    target = json.loads(run(['docker', 'image', 'inspect', IMAGE]))[0]
    assert target['Architecture'] == 'amd64' and target['Os'] == 'linux'
    assert (target['Config'].get('Labels') or {}).get('org.opencontainers.image.revision') == REVISION
    assert IMAGE in target.get('RepoDigests', [])
    base = compose_base(manifest)
    config = json.loads(run(base + ['config', '--format', 'json']))
    assert config['services']['web'].get('container_name') == CONTAINER
    old_env = dict(item.split('=', 1) for item in current['Config']['Env'])
    for key, value in config['services']['web'].get('environment', {}).items():
        assert old_env.get(key) == value, 'compose_environment_drift'
    # Resolve extra env files without printing their contents.
    unresolved = json.loads(run(base + ['config', '--no-env-resolution', '--format', 'json']))
    extras = unresolved['services']['web'].get('env_file', [])
    env_paths = [Path(item['path'] if isinstance(item, dict) else item) for item in extras]
    env_paths.append(Path(manifest['composeWorkingDir']) / '.env')
    BACKUP.mkdir(mode=0o700)
    private_json(BACKUP / 'container.json', current)
    private_json(BACKUP / 'resolved-compose.json', config)
    private_json(BACKUP / 'manifest.json', manifest)
    saved = []
    for index, source in enumerate([Path(item['path']) for item in manifest['composeFiles']] + env_paths):
        if source.is_file():
            destination = BACKUP / ('config-' + str(index))
            shutil.copy2(source, destination)
            destination.chmod(0o600)
            saved.append({'source': str(source), 'backup': str(destination), 'sha256': sha(source)})
    private_json(BACKUP / 'config-map.json', saved)
    new_override, old_override = STAGE / 'new-image.yml', STAGE / 'prior-image.yml'
    write_override(new_override, IMAGE)
    write_override(old_override, PRIOR_IMAGE)
    result = {'status': 'preflight_complete', 'revision': REVISION, 'backup': str(BACKUP)}
    def phase(value):
        result['status'] = value
        result['updatedAt'] = time.time()
        private_json(STAGE / 'result.json', result)
    def best_effort_phase(value):
        try:
            phase(value)
        except Exception:
            # A full disk must never prevent restarting/restoring the service.
            result['status'] = value
    def interrupted(_signum, _frame):
        raise RuntimeError('supervisor_interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    stopped = replaced = False
    try:
        manifest_matches(manifest, inspect())
        check_operations(dbroot, manifest['operationStates'])
        phase('stopping')
        run(['docker', 'stop', '-t', '30', CONTAINER], timeout=60)
        stopped = True
        assert not inspect()['State']['Running']
        check_operations(dbroot, manifest['operationStates'])
        phase('backing_up')
        run(['tar', '--acls', '--xattrs', '--numeric-owner', '-cpf', str(BACKUP / 'database.tar'), '-C', str(dbroot), '.'])
        verify_dir = BACKUP / 'database-check'
        verify_dir.mkdir(mode=0o700)
        run(['tar', '--acls', '--xattrs', '--numeric-owner', '-xpf', str(BACKUP / 'database.tar'), '-C', str(verify_dir)])
        for name in manifest['operationStates']:
            db = sqlite3.connect((verify_dir / name).as_uri() + '?mode=ro', uri=True)
            try:
                assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
            finally:
                db.close()
        result['databaseBackupSha256'] = sha(BACKUP / 'database.tar')
        result['backupComplete'] = True
        phase('backup_complete')
        replaced = True
        phase('replacing')
        run(base + ['-f', str(new_override), 'up', '-d', '--no-deps', '--no-build', 'web'], timeout=180)
        phase('verifying')
        wait_healthy(IMAGE, REVISION)
        verify_public(True)
        result['image'] = IMAGE
        result['publicOAuthChallengeVerified'] = True
        phase('upgrade_complete')
        print('UPGRADE_COMPLETE; BACKUP_COMPLETE; PUBLIC_OAUTH_CHALLENGE_VERIFIED', flush=True)
        return 0
    except BaseException as failure:
        result['failureType'] = type(failure).__name__
        try:
            best_effort_phase('rolling_back')
            if replaced:
                stop_if_running()
                # Keep the failed state; never destroy it during rollback.
                failed = BACKUP / 'failed-database'
                failed.mkdir(mode=0o700)
                for path in dbroot.iterdir():
                    shutil.move(str(path), str(failed / path.name))
                run(['tar', '--acls', '--xattrs', '--numeric-owner', '-xpf', str(BACKUP / 'database.tar'), '-C', str(dbroot)])
                for item in saved:
                    assert sha(item['source']) == item['sha256'], 'configuration_drift_during_upgrade'
                run(base + ['-f', str(old_override), 'up', '-d', '--no-deps', '--no-build', 'web'], timeout=180)
            elif stopped or not inspect()['State']['Running']:
                run(['docker', 'start', current['Id']], timeout=60)
            wait_healthy(PRIOR_IMAGE, PRIOR_REVISION)
            verify_public(False)
            best_effort_phase('upgrade_rolled_back')
            print('UPGRADE_FAILED; PRIOR_SERVICE_RESTORED', flush=True)
        except BaseException as rollback_failure:
            result['rollbackFailureType'] = type(rollback_failure).__name__
            best_effort_phase('manual_recovery_required')
            print('UPGRADE_FAILED; MANUAL_RECOVERY_REQUIRED', flush=True)
        return 1

if __name__ == '__main__':
    try:
        sys.exit(upgrade())
    except Exception:
        print('UPGRADE_PREFLIGHT_BLOCKED; NO_REPLACEMENT_STARTED', flush=True)
        sys.exit(2)
