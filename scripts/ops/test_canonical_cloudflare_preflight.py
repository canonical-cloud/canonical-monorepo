#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import unittest

import canonical_cloudflare_preflight as target


class FakeClient:
    def __init__(self, responses: dict[tuple[str, tuple[tuple[str, str], ...]], object]):
        self.responses = responses
        self.calls: list[tuple[str, tuple[tuple[str, str], ...]]] = []

    def get(self, path: str, query: dict[str, str] | None = None) -> object:
        key = (path, tuple(sorted((query or {}).items())))
        self.calls.append(key)
        if key not in self.responses:
            raise AssertionError(f"unexpected GET {key}")
        return self.responses[key]


def fixture(account_id: str) -> dict[tuple[str, tuple[tuple[str, str], ...]], object]:
    zone_id = "a" * 32
    return {
        ("/user/tokens/verify", ()): {"id": "token-id", "status": "active"},
        (f"/accounts/{account_id}", ()): {"id": account_id, "name": "Canonical", "type": "standard"},
        (
            "/zones",
            tuple(sorted({"name": "canonical.plus", "account.id": account_id, "per_page": "50"}.items())),
        ): [
            {
                "id": zone_id,
                "name": "canonical.plus",
                "status": "active",
                "type": "full",
                "account": {"id": account_id},
            }
        ],
        (f"/accounts/{account_id}/workers/scripts", ()): [
            {"id": "canonical-plus-auth-edge", "modified_on": "2026-08-05T00:00:00Z"}
        ],
        (f"/zones/{zone_id}/workers/routes", ()): [
            {"id": f"route-{index}", "pattern": pattern, "script": "canonical-plus-auth-edge"}
            for index, pattern in enumerate(target.EXPECTED_ROUTES)
        ],
        (
            f"/zones/{zone_id}/dns_records",
            tuple(sorted({"name": "app.canonical.plus", "per_page": "100"}.items())),
        ): [
            {
                "id": "dns-app",
                "name": "app.canonical.plus",
                "type": "CNAME",
                "content": "private-origin.example.invalid",
                "proxied": False,
                "proxiable": True,
                "ttl": 1,
            }
        ],
        (
            f"/zones/{zone_id}/dns_records",
            tuple(sorted({"name": "api.canonical.plus", "per_page": "100"}.items())),
        ): [],
    }


class BundleTests(unittest.TestCase):
    def test_bundle_requires_reviewed_account_hash(self) -> None:
        encoded = base64.b64encode(
            json.dumps(
                {"cloudflare": {"account_id": "0" * 32, "api_token": "token-value"}}
            ).encode()
        ).decode()
        with self.assertRaisesRegex(target.PreflightError, "reviewed Canonical account"):
            target.load_bundle(encoded)

    def test_bundle_rejects_extra_credentials(self) -> None:
        encoded = base64.b64encode(
            json.dumps(
                {
                    "cloudflare": {"account_id": "0" * 32, "api_token": "token-value"},
                    "r2": {"secret": "not-used"},
                }
            ).encode()
        ).decode()
        with self.assertRaisesRegex(target.PreflightError, "only the cloudflare object"):
            target.load_bundle(encoded)


class PreflightTests(unittest.TestCase):
    account_id = "62b833940607839add74bd2379cac303"

    def test_read_only_inventory_redacts_dns_content(self) -> None:
        client = FakeClient(fixture(self.account_id))
        report = target.run_preflight(client, self.account_id)
        self.assertFalse(report["cloudflare_write_performed"])
        self.assertFalse(report["r2"]["access_performed"])
        self.assertFalse(report["r2"]["required"])
        self.assertEqual("canonical.plus", report["zone"]["name"])
        self.assertTrue(report["worker"]["exists"])
        app = next(item for item in report["dns"] if item["name"] == "app.canonical.plus")
        self.assertNotIn("content", app["record"])
        self.assertTrue(app["record"]["content_redacted"])
        self.assertEqual(64, len(app["record"]["content_sha256"]))
        self.assertTrue(any("api.canonical.plus" in item for item in report["blockers"]))
        self.assertTrue(all(call[0].startswith("/") for call in client.calls))

    def test_route_owned_by_another_script_fails_closed(self) -> None:
        responses = fixture(self.account_id)
        route_key = (f"/zones/{'a' * 32}/workers/routes", ())
        routes = list(responses[route_key])
        routes[0] = dict(routes[0], script="unrelated-worker")
        responses[route_key] = routes
        with self.assertRaisesRegex(target.PreflightError, "non-Canonical script"):
            target.run_preflight(FakeClient(responses), self.account_id)

    def test_duplicate_exact_dns_name_fails_closed(self) -> None:
        responses = fixture(self.account_id)
        key = (
            f"/zones/{'a' * 32}/dns_records",
            tuple(sorted({"name": "app.canonical.plus", "per_page": "100"}.items())),
        )
        responses[key] = [responses[key][0], dict(responses[key][0], id="dns-app-2")]
        with self.assertRaisesRegex(target.PreflightError, "multiple DNS records"):
            target.run_preflight(FakeClient(responses), self.account_id)

    def test_inactive_token_fails_before_account_inventory(self) -> None:
        responses = fixture(self.account_id)
        responses[("/user/tokens/verify", ())] = {"id": "token-id", "status": "disabled"}
        client = FakeClient(responses)
        with self.assertRaisesRegex(target.PreflightError, "not active"):
            target.run_preflight(client, self.account_id)
        self.assertEqual([("/user/tokens/verify", ())], client.calls)

    def test_client_exposes_get_only(self) -> None:
        self.assertFalse(hasattr(target.CloudflareClient, "post"))
        self.assertFalse(hasattr(target.CloudflareClient, "put"))
        self.assertFalse(hasattr(target.CloudflareClient, "patch"))
        self.assertFalse(hasattr(target.CloudflareClient, "delete"))


if __name__ == "__main__":
    unittest.main()
