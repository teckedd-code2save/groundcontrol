"""Isolated wire-level tests of the installed Hermes OAuth client.

All HTTP responses and tokens are fixtures in memory. This never contacts
GroundControl, reads the user's token files, or opens a consent window.
"""
import asyncio
import base64
import hashlib
import json
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path.home() / '.hermes/hermes-agent'))
import httpx
from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata, OAuthMetadata, OAuthToken
from tools.mcp_oauth_manager import _HERMES_PROVIDER_CLS

ORIGIN = 'https://oauth-fixture.invalid'
CHALLENGE = f'Bearer resource_metadata="{ORIGIN}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Missing Bearer token", scope="deployment:read"'
METADATA = {
    'issuer': ORIGIN, 'authorization_endpoint': ORIGIN + '/oauth/authorize',
    'token_endpoint': ORIGIN + '/oauth/token', 'response_types_supported': ['code'],
    'grant_types_supported': ['authorization_code', 'refresh_token'],
    'code_challenge_methods_supported': ['S256'], 'token_endpoint_auth_methods_supported': ['none'],
    'scopes_supported': ['deployment:read'],
}

class MemoryStorage:
    def __init__(self, expired=False):
        self.tokens = OAuthToken(access_token='fixture-expired', refresh_token='fixture-rejected-refresh', token_type='Bearer', expires_in=0) if expired else None
        self.client = OAuthClientInformationFull(client_id='fixture-client', redirect_uris=['http://localhost:8765/callback'], token_endpoint_auth_method='none', grant_types=['authorization_code','refresh_token'], response_types=['code'])
    async def get_tokens(self): return self.tokens
    async def set_tokens(self, tokens): self.tokens = tokens
    async def get_client_info(self): return self.client
    async def set_client_info(self, client): self.client = client

async def exercise(status, expired=False):
    storage = MemoryStorage(expired)
    seen = {'consent': 0, 'refresh_rejected': 0, 'authorized_reads': 0, 'pkce_verified': False, 'state': None, 'challenge': None}
    async def redirect(url):
        params = parse_qs(urlsplit(url).query)
        assert params['scope'] == ['deployment:read']
        seen['consent'] += 1
        seen['state'] = params['state'][0]
        seen['challenge'] = params['code_challenge'][0]
    async def callback(): return 'fixture-code', seen['state']
    def transport(request):
        path = request.url.path
        if path.startswith('/.well-known/oauth-protected-resource'):
            return httpx.Response(200, json={'resource':ORIGIN+'/mcp','authorization_servers':[ORIGIN],'scopes_supported':['deployment:read']})
        if path.startswith('/.well-known/oauth-authorization-server'):
            return httpx.Response(200, json=METADATA)
        if path == '/oauth/token':
            params = parse_qs(request.content.decode())
            if params['grant_type'] == ['refresh_token']:
                seen['refresh_rejected'] += 1
                return httpx.Response(400, json={'error':'invalid_grant'})
            verifier = params['code_verifier'][0]
            seen['pkce_verified'] = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=') == seen['challenge']
            assert seen['pkce_verified']
            return httpx.Response(200, json={'access_token':'fixture-fresh','token_type':'Bearer','expires_in':3600,'scope':'deployment:read'})
        if path == '/mcp':
            if request.headers.get('Authorization') == 'Bearer fixture-fresh':
                seen['authorized_reads'] += 1
                return httpx.Response(200, json={'jsonrpc':'2.0','id':1,'result':{'isError':False,'structuredContent':{'deployments':[]}}})
            return httpx.Response(status, headers={'WWW-Authenticate':CHALLENGE}, json={'jsonrpc':'2.0','id':1,'result':{'isError':True,'content':[{'type':'text','text':'Missing Bearer token'}],'_meta':{'mcp/www_authenticate':[CHALLENGE]}}})
        raise AssertionError('Unexpected fixture endpoint: ' + path)
    provider = _HERMES_PROVIDER_CLS(server_url=ORIGIN+'/mcp', client_metadata=OAuthClientMetadata(redirect_uris=['http://localhost:8765/callback'], scope='deployment:read'), storage=storage, redirect_handler=redirect, callback_handler=callback)
    provider.context.oauth_metadata = OAuthMetadata(**METADATA)
    async with httpx.AsyncClient(auth=provider, transport=httpx.MockTransport(transport)) as client:
        response = await client.post(ORIGIN+'/mcp', json={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'deployment.list','arguments':{}}})
    return seen, response.json()

class HermesOAuthTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_old_200_tool_error_does_not_start_oauth(self):
        seen, data = await exercise(200)
        self.assertTrue(data['result']['isError'])
        self.assertEqual(seen['consent'], 0)
        self.assertEqual(seen['authorized_reads'], 0)

    async def test_401_starts_pkce_and_retries_with_new_token(self):
        seen, data = await exercise(401)
        self.assertFalse(data['result']['isError'])
        self.assertEqual(seen['consent'], 1)
        self.assertEqual(seen['authorized_reads'], 1)
        self.assertTrue(seen['pkce_verified'])

    async def test_rejected_refresh_followed_by_200_remains_broken(self):
        seen, data = await exercise(200, expired=True)
        self.assertEqual(seen['refresh_rejected'], 1)
        self.assertTrue(data['result']['isError'])
        self.assertEqual(seen['consent'], 0)

    async def test_rejected_refresh_then_401_recovers_with_fresh_consent(self):
        seen, data = await exercise(401, expired=True)
        self.assertEqual(seen['refresh_rejected'], 1)
        self.assertFalse(data['result']['isError'])
        self.assertEqual(seen['consent'], 1)
        self.assertEqual(seen['authorized_reads'], 1)
        self.assertTrue(seen['pkce_verified'])

if __name__ == '__main__': unittest.main(verbosity=2)
