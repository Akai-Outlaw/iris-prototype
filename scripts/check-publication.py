"""Reject generated/private files and common credential formats in the Git index.

This is a lightweight publication guard, not a complete secret scanner.
Only file names and line numbers are printed when a problem is found.
"""
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[1]
files = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
blocked = {"node_modules", "target", "dist", "outputs", ".toolchains", ".local", "__pycache__", ".ruff_cache"}
patterns = [
    re.compile(r"(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}"),
    re.compile(r"\bsk[-_][A-Za-z0-9_-]{24,}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"(?:api_key|apiKey|secret|password)\s*[:=]\s*[\"'][A-Za-z0-9_/-]{24,}[\"']", re.I),
    re.compile(r"(?:/" + "Users/" + r"[^/\s]+/|/" + "Volumes/" + r"[^/\n]+/)"),
]
issues = []
for name in filter(None, files):
    path = pathlib.PurePosixPath(name)
    if blocked.intersection(path.parts) or (path.name.startswith(".env") and path.name != ".env.example") or path.suffix in {".sqlite", ".sqlite3", ".db", ".pem", ".p12", ".pfx"}:
        issues.append(f"{name}: private/generated path")
        continue
    result = subprocess.run(["git", "show", ":" + name], cwd=root, capture_output=True, check=True)
    if b"\0" in result.stdout[:8192]:
        continue
    text = result.stdout.decode("utf-8", errors="replace")
    for number, line in enumerate(text.splitlines(), 1):
        if any(pattern.search(line) for pattern in patterns):
            issues.append(f"{name}:{number}: review before publishing")
if issues:
    print("\n".join(issues))
    sys.exit(1)
print("Publication guard passed: no blocked paths or matching credential patterns in staged files.")
