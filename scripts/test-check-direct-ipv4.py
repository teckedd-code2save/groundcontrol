"""Offline tests for the external rehearsal verifier."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location("verify_ipv4", pathlib.Path(__file__).with_name("check-direct-ipv4.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.ip = "8.8.8.8"
        origin = "https://" + self.ip
        self.responses = {
            "/api/auth/claim": {"instanceId": "known", "claimed": True},
            "/.well-known/oauth-authorization-server": {
                "issuer": origin,
                "authorization_endpoint": origin + "/oauth/authorize",
                "token_endpoint": origin + "/oauth/token",
                "registration_endpoint": origin + "/oauth/register",
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": ["none"],
            },
            "/.well-known/oauth-protected-resource": {"resource": origin + "/mcp", "authorization_servers": [origin]},
            "/mcp": {"id": "ipv4-check", "result": {"tools": [{"name": "deployment.list"}]}},
            "/api/instance/direct-ipv4-proof": {"proof": "f" * 64},
        }
        self.calls = []

    def request(self, ip, path, method="GET", headers=None, body=None, *, status=200, challenge_url=None):
        self.assertEqual(ip, self.ip)
        self.calls.append(path)
        if path.endswith("/direct-ipv4-proof"):
            self.assertEqual(method, "POST")
            self.assertEqual(headers, {"X-GroundControl-IP-Challenge": "1" * 64})
        else:
            self.assertNotIn("X-GroundControl-IP-Challenge", headers or {})
        if status == 401:
            self.assertEqual(path, "/mcp")
            self.assertEqual(challenge_url, f"https://{self.ip}/.well-known/oauth-protected-resource")
            return {"id": "ipv4-auth-check", "result": {"isError": True}}
        return self.responses[path]

    def test_proof_is_last(self):
        self.assertEqual(module.verify(self.ip, "known", "1" * 64, self.request), "f" * 64)
        self.assertTrue(self.calls[-1].endswith("/direct-ipv4-proof"))

    def test_bad_issuer_resource_identity_and_discovery_prevent_proof(self):
        cases = [
            ("/api/auth/claim", "instanceId", "elsewhere"),
            ("/.well-known/oauth-authorization-server", "issuer", "https://other.example"),
            ("/.well-known/oauth-protected-resource", "resource", "https://other.example/mcp"),
            ("/mcp", "id", "wrong"),
        ]
        for path, field, value in cases:
            with self.subTest(path=path):
                saved = self.responses[path][field]
                self.responses[path][field] = value
                with self.assertRaises(ValueError):
                    module.verify(self.ip, "known", "1" * 64, self.request)
                self.assertNotIn("/api/instance/direct-ipv4-proof", self.calls)
                self.responses[path][field] = saved

    def test_rejects_redirect_and_uses_tls_hostname_verification(self):
        conn = MagicMock()
        conn.getresponse.return_value.status = 302
        conn.sock.getpeercert.return_value = {
            "notAfter": "Nov 27 16:00:00 2026 GMT",
            "notBefore": "Nov 21 00:00:00 2026 GMT",
        }
        with patch.object(module.http.client, "HTTPSConnection", return_value=conn) as https:
            with self.assertRaisesRegex(ValueError, "redirects are not accepted"):
                module.request_json(self.ip, "/test")
            self.assertTrue(https.call_args.kwargs["context"].check_hostname)
            self.assertEqual(https.call_args.args, (self.ip, 443))
            conn.request.assert_called_once()
            conn.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
