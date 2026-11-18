import concurrent.futures, importlib.util, pathlib, tempfile, threading, time, unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "iris_policy",
    pathlib.Path(__file__).resolve().parents[1] / "services/iris-runtime/policy.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Policy, PolicyError = module.Policy, module.PolicyError


class PolicyTests(unittest.TestCase):
    def test_normalized_transport_checks_scope_before_execution(self):
        response = SimpleNamespace(
            tool_calls=[
                SimpleNamespace(function=SimpleNamespace(name="iris_coding_read"))
            ]
        )
        module.assert_tool_scope(response, {"iris_coding_read"})
        with self.assertRaises(PolicyError):
            module.assert_tool_scope(response, {"iris_research_fetch"})
        with self.assertRaises(PolicyError):
            module.assert_tool_scope(
                SimpleNamespace(tool_calls="malformed"), {"iris_coding_read"}
            )

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.directory.name)
        self.root = self.base / "project"
        self.root.mkdir()
        self.events = []
        self.callback = lambda kind, payload: None

        def emit(kind, payload):
            self.events.append((kind, payload))
            self.callback(kind, payload)

        self.cancelled = threading.Event()
        self.policy = Policy(emit, self.cancelled)
        self.policy.grant(self.root)

    def tearDown(self):
        self.policy.revoke()
        self.directory.cleanup()

    def approve(self, kind, payload):
        if kind == "approval.requested":
            self.policy.resolve(payload["id"], True)

    def test_no_grant_is_default_deny(self):
        self.policy.revoke()
        with self.assertRaises(PolicyError):
            self.policy.list()

    def test_relative_reads_and_listing(self):
        (self.root / "a.txt").write_text("hello")
        self.assertEqual(self.policy.read("a.txt"), "hello")
        self.assertEqual(self.policy.list()[0]["name"], "a.txt")

    def test_traversal_absolute_and_credentials_blocked(self):
        for path in (
            "../outside",
            "/etc/passwd",
            ".env",
            ".env.local",
            "folder/.ssh/id_rsa",
            "private.key",
        ):
            with self.subTest(path=path), self.assertRaises(PolicyError):
                self.policy.read(path)

    def test_symlink_escape_blocked(self):
        outside = self.base / "outside"
        outside.write_text("private")
        (self.root / "link").symlink_to(outside)
        with self.assertRaises(PolicyError):
            self.policy.read("link")

    def test_denial_prevents_creation(self):
        self.callback = lambda kind, payload: (
            self.policy.resolve(payload["id"], False)
            if kind == "approval.requested"
            else None
        )
        with self.assertRaises(PolicyError):
            self.policy.write("new.txt", "new", "run", "coding")
        self.assertFalse((self.root / "new.txt").exists())

    def test_approved_write_returns_manifest_and_consumes_approval(self):
        self.callback = self.approve
        result = self.policy.write("new.txt", "new", "run", "coding")
        self.assertEqual((self.root / "new.txt").read_text(), "new")
        self.assertEqual(result["operation"], "create")
        request = next(
            payload for kind, payload in self.events if kind == "approval.requested"
        )
        with self.assertRaises(PolicyError):
            self.policy.resolve(request["id"], True)

    def test_changed_file_requires_new_preview(self):
        path = self.root / "a.txt"
        path.write_text("before")

        def callback(kind, payload):
            if kind == "approval.requested":
                path.write_text("changed")
                self.policy.resolve(payload["id"], True)

        self.callback = callback
        with self.assertRaises(PolicyError):
            self.policy.write("a.txt", "after", "run", "coding")
        self.assertEqual(path.read_text(), "changed")

    def test_execution_grant_is_rechecked_after_approval(self):
        self.callback = self.approve

        def revoked():
            raise PolicyError("Run grant revoked")

        with self.assertRaises(PolicyError):
            self.policy.write("a.txt", "blocked", "run", "coding", guard=revoked)
        self.assertFalse((self.root / "a.txt").exists())
        self.assertFalse(list(self.root.glob(".iris-*.tmp")))

    def test_replaced_target_symlink_does_not_change_outside(self):
        target = self.root / "a.txt"
        target.write_text("before")
        outside = self.base / "outside"
        outside.write_text("safe")

        def callback(kind, payload):
            if kind == "approval.requested":
                target.unlink()
                target.symlink_to(outside)
                self.policy.resolve(payload["id"], True)

        self.callback = callback
        with self.assertRaises(PolicyError):
            self.policy.write("a.txt", "after", "run", "coding")
        self.assertEqual(outside.read_text(), "safe")

    def test_research_has_no_write_capability(self):
        with self.assertRaises(PolicyError):
            self.policy.write("a.txt", "forbidden", "run", "research")
        self.assertFalse(self.events)

    def test_cancelled_action_cannot_execute(self):
        self.cancelled.set()
        with self.assertRaises(PolicyError):
            self.policy.write("a.txt", "forbidden", "run", "coding")

    def test_expired_approval_fails_closed(self):
        def callback(kind, payload):
            if kind == "approval.requested":
                request = self.policy.pending[payload["id"]]
                request["expires"] = time.time() - 1
                request["event"].set()

        self.callback = callback
        with self.assertRaises(PolicyError):
            self.policy.write("a.txt", "forbidden", "run", "coding")

    def test_competing_approval_decisions_are_atomic(self):
        results = []

        def decide(request):
            try:
                self.policy.resolve(request, True)
                return "accepted"
            except PolicyError:
                return "rejected"

        def callback(kind, payload):
            if kind == "approval.requested":
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                    results.extend(executor.map(decide, [payload["id"], payload["id"]]))

        self.callback = callback
        self.policy.write("a.txt", "approved", "run", "coding")
        self.assertCountEqual(results, ["accepted", "rejected"])

    def test_domain_and_private_network_policy(self):
        with self.assertRaises(PolicyError):
            self.policy.fetch("https://unapproved.example/path")
        self.policy.domains = {"approved.example"}
        with (
            patch.object(
                module.socket,
                "getaddrinfo",
                return_value=[(2, 1, 6, "", ("127.0.0.1", 443))],
            ),
            self.assertRaises(PolicyError),
        ):
            self.policy.fetch("https://approved.example/path")

    def test_unlisted_command_is_blocked_before_approval(self):
        with self.assertRaises(PolicyError):
            self.policy.check("rm -rf .", "run", "coding")
        self.assertFalse(self.events)


if __name__ == "__main__":
    unittest.main()
