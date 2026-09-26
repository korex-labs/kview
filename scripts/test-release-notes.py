#!/usr/bin/env python3
"""Isolated release-helper invocation tests; no real Codex calls or release tags."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HELPER = Path(__file__).with_name("prepare-release-notes.sh").resolve()


class ReleaseNotesModelTests(unittest.TestCase):
    def check_model(self, model):
        with tempfile.TemporaryDirectory(prefix="kview-release-test-") as directory:
            root = Path(directory)
            env = os.environ.copy()
            for key in list(env):
                if key.startswith("GIT_"):
                    env.pop(key)
            env.pop("CODEX_MODEL", None)
            env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)

            def git(*args):
                return subprocess.check_output(
                    ["git", *args], cwd=root, env=env, text=True,
                    stderr=subprocess.STDOUT,
                ).strip()

            git("init", "-q")
            git("config", "user.name", "Release test")
            git("config", "user.email", "release-test@example.invalid")
            git("config", "core.hooksPath", "/dev/null")
            git("commit", "--allow-empty", "-qm", "baseline")
            git("tag", "v1.0.0")
            git("commit", "--allow-empty", "-qm", "change")
            original = git("rev-parse", "HEAD")
            # Record argv, then simulate the provider rejecting the request.
            fake = root / "fake-codex"
            fake.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, sys\n"
                "from pathlib import Path\n"
                "sys.stdin.read()\n"
                "Path(os.environ['ARGV_FILE']).write_text(json.dumps(sys.argv[1:]))\n"
                "sys.exit(42)\n"
            )
            fake.chmod(0o700)
            env.update(CODEX=str(fake), ARGV_FILE=str(root / "argv.json"))
            if model is not None:
                env["CODEX_MODEL"] = model
            result = subprocess.run(
                ["sh", str(HELPER), "v1.1.0"], cwd=root, env=env,
                text=True, capture_output=True, timeout=15,
            )
            self.assertEqual(result.returncode, 42, result.stdout + result.stderr)
            argv = json.loads((root / "argv.json").read_text())
            self.assertEqual(argv[0], "exec")
            if model:
                self.assertEqual(argv[argv.index("-m") + 1], model)
                self.assertEqual(argv.count("-m"), 1)
            else:
                self.assertNotIn("-m", argv)
            self.assertEqual(argv[argv.index("-C") + 1], str(root))
            self.assertEqual(argv[argv.index("-s") + 1], "workspace-write")
            self.assertEqual(argv[-1], "-")
            self.assertEqual(git("rev-parse", "HEAD"), original)
            self.assertEqual(git("tag", "--list"), "v1.0.0")
            self.assertFalse((root / "CHANGELOG.md").exists())

    def test_configured_default(self):
        self.check_model(None)

    def test_empty_override_uses_default(self):
        self.check_model("")

    def test_explicit_override_is_one_argument(self):
        self.check_model("test-model with-space")


if __name__ == "__main__":
    unittest.main()
