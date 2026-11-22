#!/usr/bin/env python3
"""Run on a separate machine. No admin cookies, OAuth tokens or redirects."""
import argparse
import getpass
import hashlib
import http.client
import ipaddress
import json
from pathlib import Path
import re
import ssl
import sys

MAX_RESPONSE = 1024 * 1024
# Let's Encrypt production roots, https://letsencrypt.org/certificates/.
ISRG_ROOTS = {
    "96bcec06264976f37460779acf28c5a7cfe8a3c0aae11a8ffcee05c0bddf08c6",
    "69729b8e15a86efc177a57afb7171dfc64add28c2fca8cf1507e34453ccb1470",
}


def lets_encrypt_context():
    # Trust only the two pinned production roots; no local CA or proxy exceptions.
    bundle = (Path(__file__).parent / "trust" / "lets-encrypt-isrg-roots.pem").read_text()
    roots = re.findall(r"-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----", bundle)
    hashes = {hashlib.sha256(ssl.PEM_cert_to_DER_cert(root)).hexdigest() for root in roots}
    if len(roots) != len(ISRG_ROOTS) or hashes != ISRG_ROOTS:
        raise ValueError("ISRG root certificate bundle did not match the pinned SHA-256 fingerprints.")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_verify_locations(cadata="\n".join(roots))
    return context


def request_json(ip, path, method="GET", headers=None, body=None, *, status=200, challenge_url=None):
    conn = http.client.HTTPSConnection(ip, 443, timeout=10, context=lets_encrypt_context())
    try:
        # Direct HTTPS with IP SAN validation; no proxy/redirect support.
        conn.connect()
        cert = conn.sock.getpeercert()
        lifetime = ssl.cert_time_to_seconds(cert["notAfter"]) - ssl.cert_time_to_seconds(cert["notBefore"])
        if not 0 < lifetime <= 170 * 3600:
            raise ValueError(f"{path}: expected a short-lived Let's Encrypt IP certificate")
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        if response.status != status:
            raise ValueError(f"{path}: HTTPS request returned {response.status}; redirects are not accepted")
        if challenge_url:
            auth_header = response.getheader("www-authenticate", "")
            if not auth_header.startswith("Bearer ") or f'resource_metadata="{challenge_url}"' not in auth_header:
                raise ValueError("MCP authentication challenge did not name the candidate resource metadata")
        if response.getheader("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise ValueError(f"{path}: expected JSON")
        payload = response.read(MAX_RESPONSE + 1)
        if len(payload) > MAX_RESPONSE:
            raise ValueError(f"{path}: response too large")
        result = json.loads(payload)
        if not isinstance(result, dict):
            raise ValueError(f"{path}: unexpected JSON")
        return result
    finally:
        conn.close()


def verify(ip, instance_id, challenge, request=request_json):
    parsed = ipaddress.IPv4Address(ip)
    if not parsed.is_global or parsed.is_multicast or str(parsed) != ip:
        raise ValueError("Enter the reserved public IPv4 only")
    if not re.fullmatch(r"[a-f0-9]{64}", challenge):
        raise ValueError("Invalid rehearsal challenge")
    origin = f"https://{ip}"
    identity = request(ip, "/api/auth/claim")
    if identity.get("instanceId") != instance_id or identity.get("claimed") is not True:
        raise ValueError("The address does not identify this claimed GroundControl instance")
    oauth = request(ip, "/.well-known/oauth-authorization-server")
    for field, expected in (
        ("issuer", origin),
        ("authorization_endpoint", origin + "/oauth/authorize"),
        ("token_endpoint", origin + "/oauth/token"),
        ("registration_endpoint", origin + "/oauth/register"),
    ):
        if oauth.get(field) != expected:
            raise ValueError(f"OAuth mismatch for {field}")
    if "S256" not in oauth.get("code_challenge_methods_supported", []) or "none" not in oauth.get("token_endpoint_auth_methods_supported", []):
        raise ValueError("OAuth metadata does not advertise public S256 PKCE")
    resource = request(ip, "/.well-known/oauth-protected-resource")
    if resource.get("resource") != origin + "/mcp" or resource.get("authorization_servers") != [origin]:
        raise ValueError("MCP resource or issuer does not match the candidate")
    tools = request(ip, "/mcp", "POST", {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }, json.dumps({"jsonrpc": "2.0", "id": "ipv4-check", "method": "tools/list", "params": {}}))
    if tools.get("id") != "ipv4-check" or not any(
        isinstance(tool, dict) and tool.get("name") == "deployment.list"
        for tool in tools.get("result", {}).get("tools", [])
    ):
        raise ValueError("GroundControl deployment discovery did not match")
    challenged = request(ip, "/mcp", "POST", {"Content-Type": "application/json"},
                         json.dumps({"jsonrpc": "2.0", "id": "ipv4-auth-check", "method": "tools/call",
                                     "params": {"name": "deployment.list", "arguments": {}}}),
                         status=401, challenge_url=origin + "/.well-known/oauth-protected-resource")
    if challenged.get("id") != "ipv4-auth-check" or challenged.get("result", {}).get("isError") is not True:
        raise ValueError("MCP unauthenticated tool call did not return the normal denial")
    result = request(ip, "/api/instance/direct-ipv4-proof", "POST", {
        "X-GroundControl-IP-Challenge": challenge,
    })
    proof = result.get("proof")
    if not isinstance(proof, str) or not re.fullmatch(r"[a-f0-9]{64}", proof):
        raise ValueError("The GroundControl route did not return a check proof")
    return proof


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ipv4")
    parser.add_argument("instance_id")
    args = parser.parse_args()
    try:
        challenge = getpass.getpass("GroundControl rehearsal challenge: ")
        print(verify(args.ipv4, args.instance_id, challenge))
    except (OSError, ValueError, TypeError, AttributeError, KeyError, http.client.HTTPException) as exc:
        print(f"Verification failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
