#!/usr/bin/env python3
"""Read-only, fail-closed Cloudflare inventory for the Canonical Plus edge."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Protocol

API_BASE = "https://api.cloudflare.com/client/v4"
EXPECTED_ACCOUNT_SHA256 = "8007ba16f4d4ff2684639b28a390e8516fcf878e80a09ee32279778cf98934c8"
EXPECTED_ZONE_NAME = "canonical.plus"
EXPECTED_WORKER_SCRIPT = "canonical-plus-auth-edge"
EXPECTED_WORKER_ENVIRONMENT = "default-production"
EXPECTED_ROUTES = (
    "app.canonical.plus/u/*",
    "app.canonical.plus/api/v1/quotes*",
    "app.canonical.plus/ws/quotes*",
)
EXPECTED_DNS_NAMES = ("app.canonical.plus", "api.canonical.plus")


class PreflightError(RuntimeError):
    pass


class Client(Protocol):
    def get(self, path: str, query: dict[str, str] | None = None) -> Any: ...


class CloudflareClient:
    """Small GET-only client. This class deliberately exposes no write method."""

    def __init__(self, token: str):
        if not token or any(ch.isspace() for ch in token):
            raise PreflightError("Cloudflare API token must be non-empty and whitespace-free")
        self._token = token

    def get(self, path: str, query: dict[str, str] | None = None) -> Any:
        if not path.startswith("/") or ".." in path:
            raise PreflightError("unsafe Cloudflare API path")
        url = API_BASE + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        request = urllib.request.Request(
            url,
            method="GET",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self._token}",
                "User-Agent": "canonical-cloudflare-preflight/1",
            },
        )
        for attempt in range(5):
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    payload = json.loads(response.read())
                if not isinstance(payload, dict) or payload.get("success") is not True:
                    errors = payload.get("errors") if isinstance(payload, dict) else None
                    raise PreflightError(f"Cloudflare GET {path} was unsuccessful: {safe_errors(errors)}")
                return payload.get("result")
            except urllib.error.HTTPError as error:
                raw = error.read(16384)
                try:
                    payload = json.loads(raw) if raw else {}
                    message = safe_errors(payload.get("errors"))
                except Exception:
                    message = f"HTTP {error.code}"
                if error.code in (429, 500, 502, 503, 504) and attempt < 4:
                    time.sleep(min(2 ** (attempt + 1), 20))
                    continue
                raise PreflightError(
                    f"Cloudflare GET {path} returned HTTP {error.code}: {message}"
                ) from None
            except urllib.error.URLError as error:
                if attempt < 4:
                    time.sleep(min(2 ** (attempt + 1), 20))
                    continue
                raise PreflightError(f"Cloudflare transport failed for GET {path}: {error.reason}") from None
        raise AssertionError("unreachable")


def identifier_hash(value: Any) -> str | None:
    return hashlib.sha256(str(value).encode()).hexdigest() if value else None


def safe_errors(value: Any) -> str:
    if not isinstance(value, list):
        return "no structured error details"
    items: list[str] = []
    for item in value[:5]:
        if isinstance(item, dict):
            code = item.get("code")
            message = str(item.get("message", "unknown error"))[:300]
            items.append(f"{code}: {message}")
    return "; ".join(items) or "no structured error details"


def load_bundle(encoded: str) -> tuple[str, str]:
    try:
        payload = json.loads(base64.b64decode(encoded, validate=True))
    except Exception as error:
        raise PreflightError("credential bundle is not valid base64-encoded JSON") from error
    if not isinstance(payload, dict) or set(payload) != {"cloudflare"}:
        raise PreflightError("credential bundle must contain only the cloudflare object")
    cloudflare = payload.get("cloudflare")
    if not isinstance(cloudflare, dict) or set(cloudflare) != {"account_id", "api_token"}:
        raise PreflightError("cloudflare bundle must contain exactly account_id and api_token")
    account_id = cloudflare.get("account_id")
    token = cloudflare.get("api_token")
    if not isinstance(account_id, str) or len(account_id) != 32:
        raise PreflightError("Cloudflare account ID must be a 32-character string")
    if hashlib.sha256(account_id.encode()).hexdigest() != EXPECTED_ACCOUNT_SHA256:
        raise PreflightError("Cloudflare account ID does not match the reviewed Canonical account")
    if not isinstance(token, str) or not token or any(ch.isspace() for ch in token):
        raise PreflightError("Cloudflare API token is invalid")
    return account_id, token


def require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PreflightError(f"{label} response is not an object")
    return value


def require_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise PreflightError(f"{label} response is not a list")
    return value


def dns_summary(record: dict[str, Any]) -> dict[str, Any]:
    content = str(record.get("content", ""))
    return {
        "id_sha256": identifier_hash(record.get("id")),
        "name": record.get("name"),
        "type": record.get("type"),
        "proxied": record.get("proxied"),
        "proxiable": record.get("proxiable"),
        "ttl": record.get("ttl"),
        "content_sha256": hashlib.sha256(content.encode()).hexdigest() if content else None,
        "content_redacted": bool(content),
    }


def run_preflight(client: Client, account_id: str) -> dict[str, Any]:
    token = require_dict(client.get("/user/tokens/verify"), "token verification")
    if token.get("status") != "active":
        raise PreflightError("Cloudflare API token is not active")

    account = require_dict(client.get(f"/accounts/{account_id}"), "account")
    if account.get("id") != account_id:
        raise PreflightError("Cloudflare token did not resolve to the reviewed account")

    zones = require_list(
        client.get(
            "/zones",
            {"name": EXPECTED_ZONE_NAME, "account.id": account_id, "per_page": "50"},
        ),
        "zone lookup",
    )
    exact_zones = [
        item
        for item in zones
        if isinstance(item, dict)
        and item.get("name") == EXPECTED_ZONE_NAME
        and isinstance(item.get("account"), dict)
        and item["account"].get("id") == account_id
    ]
    if len(exact_zones) != 1:
        raise PreflightError(
            f"expected exactly one {EXPECTED_ZONE_NAME} zone in the reviewed account; found {len(exact_zones)}"
        )
    zone = exact_zones[0]
    zone_id = zone.get("id")
    if not isinstance(zone_id, str) or len(zone_id) != 32:
        raise PreflightError("canonical.plus zone returned an invalid zone ID")

    scripts = require_list(
        client.get(f"/accounts/{account_id}/workers/scripts"), "Worker script inventory"
    )
    matching_scripts = [
        item
        for item in scripts
        if isinstance(item, dict)
        and (item.get("id") == EXPECTED_WORKER_SCRIPT or item.get("name") == EXPECTED_WORKER_SCRIPT)
    ]
    if len(matching_scripts) > 1:
        raise PreflightError("the exact Canonical Worker script is ambiguous")

    routes = require_list(client.get(f"/zones/{zone_id}/workers/routes"), "Worker route inventory")
    route_results: list[dict[str, Any]] = []
    for pattern in EXPECTED_ROUTES:
        matches = [item for item in routes if isinstance(item, dict) and item.get("pattern") == pattern]
        if len(matches) > 1:
            raise PreflightError(f"multiple Worker routes match exact pattern {pattern}")
        if matches and matches[0].get("script") != EXPECTED_WORKER_SCRIPT:
            raise PreflightError(
                f"Worker route {pattern} is owned by a non-Canonical script; refusing to proceed"
            )
        route_results.append(
            {
                "pattern": pattern,
                "exists": bool(matches),
                "id_sha256": identifier_hash(matches[0].get("id")) if matches else None,
                "script": matches[0].get("script") if matches else None,
            }
        )

    dns_results: list[dict[str, Any]] = []
    for name in EXPECTED_DNS_NAMES:
        records = require_list(
            client.get(f"/zones/{zone_id}/dns_records", {"name": name, "per_page": "100"}),
            f"DNS lookup for {name}",
        )
        exact = [item for item in records if isinstance(item, dict) and item.get("name") == name]
        if len(exact) > 1:
            raise PreflightError(f"multiple DNS records have the exact name {name}")
        dns_results.append(
            {"name": name, "exists": bool(exact), "record": dns_summary(exact[0]) if exact else None}
        )

    worker_exists = len(matching_scripts) == 1
    missing_routes = [item["pattern"] for item in route_results if not item["exists"]]
    missing_dns = [item["name"] for item in dns_results if not item["exists"]]
    blockers: list[str] = []
    if not worker_exists:
        blockers.append(f"Worker script {EXPECTED_WORKER_SCRIPT} is not deployed")
    if missing_routes:
        blockers.append("missing exact Worker routes: " + ", ".join(missing_routes))
    if missing_dns:
        blockers.append("missing exact DNS records: " + ", ".join(missing_dns))
    blockers.append("origin health and TLS have not been certified by this read-only inventory")
    blockers.append("DNS origin targets remain redacted and must be matched to reviewed origin evidence before write")

    worker_metadata = matching_scripts[0] if worker_exists else {}
    return {
        "schema_version": 1,
        "mode": "read-only-preflight",
        "cloudflare_write_performed": False,
        "r2": {
            "required": False,
            "access_performed": False,
            "reason": "the reviewed Canonical Worker contract declares no R2 binding",
        },
        "token": {
            "status": token.get("status"),
            "id_sha256": identifier_hash(token.get("id")),
            "expires_on": token.get("expires_on"),
        },
        "account": {
            "id_sha256": identifier_hash(account.get("id")),
            "name": account.get("name"),
            "type": account.get("type"),
        },
        "zone": {
            "id_sha256": identifier_hash(zone_id),
            "name": zone.get("name"),
            "status": zone.get("status"),
            "type": zone.get("type"),
            "account_id_sha256": identifier_hash((zone.get("account") or {}).get("id")),
        },
        "worker": {
            "script": EXPECTED_WORKER_SCRIPT,
            "environment": EXPECTED_WORKER_ENVIRONMENT,
            "exists": worker_exists,
            "created_on": worker_metadata.get("created_on"),
            "modified_on": worker_metadata.get("modified_on"),
        },
        "routes": route_results,
        "dns": dns_results,
        "ready_for_cloudflare_write": not blockers,
        "blockers": blockers,
    }


def markdown_report(report: dict[str, Any]) -> str:
    worker = report["worker"]
    lines = [
        "# Canonical Plus Cloudflare read-only preflight",
        "",
        f"- Token status: `{report['token']['status']}`",
        f"- Reviewed account hash verified: `{report['account']['id_sha256']}`",
        f"- Zone verified: `{report['zone']['name']}` (`{report['zone']['status']}`)",
        f"- Worker: `{worker['script']}` in `{worker['environment']}` — "
        + ("present" if worker["exists"] else "missing"),
        "- Cloudflare writes performed: `false`",
        "- R2 accessed: `false` (no R2 binding in the reviewed Worker contract)",
        "",
        "## Exact routes",
        "",
    ]
    for route in report["routes"]:
        lines.append(f"- `{route['pattern']}` — " + ("present" if route["exists"] else "missing"))
    lines.extend(["", "## Exact DNS names", ""])
    for item in report["dns"]:
        if item["exists"]:
            record = item["record"]
            lines.append(
                f"- `{item['name']}` — `{record['type']}`, proxied=`{record['proxied']}`, content redacted"
            )
        else:
            lines.append(f"- `{item['name']}` — missing")
    lines.extend(["", "## Blocking gates", ""])
    for blocker in report["blockers"]:
        lines.append(f"- {blocker}")
    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json-report", required=True)
    parser.add_argument("--markdown-report", required=True)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    encoded = os.environ.get("CANONICAL_CREDENTIAL_BUNDLE_B64", "")
    if not encoded:
        raise PreflightError("CANONICAL_CREDENTIAL_BUNDLE_B64 is required")
    account_id, token = load_bundle(encoded)
    report = run_preflight(CloudflareClient(token), account_id)

    json_path = Path(args.json_report)
    markdown_path = Path(args.markdown_report)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    markdown_path.write_text(markdown_report(report), encoding="utf-8")
    print(
        "CANONICAL_CLOUDFLARE_PREFLIGHT "
        f"account=verified zone={EXPECTED_ZONE_NAME} worker_exists={str(report['worker']['exists']).lower()} "
        f"writes=false"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PreflightError as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
