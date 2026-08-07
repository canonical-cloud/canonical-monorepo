#!/usr/bin/env python3
from __future__ import annotations

import re
import unittest
from pathlib import Path

SCRIPT = Path("scripts/ops/receive_encrypted_canonical_bundle.sh").read_text(encoding="utf-8")


class ReceiverContractTests(unittest.TestCase):
    def test_uses_run_specific_rsa_oaep_sha256_handoff(self) -> None:
        self.assertIn("rsa_keygen_bits:4096", SCRIPT)
        self.assertIn("rsa_padding_mode:oaep", SCRIPT)
        self.assertIn("rsa_oaep_md:sha256", SCRIPT)
        self.assertIn("rsa_mgf1_md:sha256", SCRIPT)
        self.assertIn("HANDSHAKE_NONCE", SCRIPT)
        self.assertIn("CANONICAL_HANDSHAKE_READY", SCRIPT)

    def test_bundle_shape_is_minimal_and_r2_is_not_consumed(self) -> None:
        self.assertIn('set(payload) != {"cloudflare"}', SCRIPT)
        self.assertIn('set(cloudflare) != {"account_id", "api_token"}', SCRIPT)
        self.assertNotIn("R2_ACCESS_KEY", SCRIPT)
        self.assertNotIn("R2_SECRET", SCRIPT)
        self.assertNotIn("AWS_ACCESS_KEY", SCRIPT)

    def test_masks_secrets_and_never_prints_plain_bundle(self) -> None:
        self.assertIn("::add-mask::%s", SCRIPT)
        self.assertNotIn("cat \"$plain_bundle\"", SCRIPT)
        self.assertNotIn("echo \"$api_token\"", SCRIPT)
        self.assertIsNone(re.search(r"cfat_[A-Za-z0-9_-]{20,}", SCRIPT))
        self.assertIsNone(re.search(r"ghp_[A-Za-z0-9]{20,}", SCRIPT))

    def test_remote_handoff_is_deleted_on_exit(self) -> None:
        self.assertIn("trap cleanup_remote_handoff EXIT", SCRIPT)
        self.assertIn('delete_remote_if_present "$PUBLIC_KEY_PATH"', SCRIPT)
        self.assertIn('delete_remote_if_present "$CIPHERTEXT_PATH"', SCRIPT)
        self.assertIn("cleanup_remote_handoff\ntrap - EXIT", SCRIPT)

    def test_repository_destructive_shell_commands_remain_absent(self) -> None:
        for forbidden in ("rm ", "rm\n", "shred", "truncate", "git clean", "git reset --hard"):
            self.assertNotIn(forbidden, SCRIPT)


if __name__ == "__main__":
    unittest.main()
