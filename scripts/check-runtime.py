"""Check managed Hermes startup. --text performs ONE real model turn; no tool grants."""

import argparse, json, pathlib, subprocess, sys, threading, time

parser = argparse.ArgumentParser()
parser.add_argument("--text")
parser.add_argument("--diagnose", action="store_true")
parser.add_argument(
    "--provider", choices=["openai-codex", "hermes"], default="openai-codex"
)
parser.add_argument("--specialist", choices=["coding", "research", "file-task"])
parser.add_argument("--fixture", action="store_true")
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
prepared = subprocess.run(
    [
        str(pathlib.Path.home() / ".local/bin/hermes"),
        "--print-runtime-command",
        "--module",
        "runpy",
    ],
    capture_output=True,
    text=True,
    timeout=20,
    check=True,
)
argv = json.loads(prepared.stdout)
assert len(argv) == 4 and argv[1:3] == ["-I", "-c"], "Unsupported runtime command"
prefix = argv[3].rsplit("runpy.run_module(", 1)[0]
argv[3] = (
    prefix
    + f'runpy.run_path({str(root / "services/iris-runtime/bridge.py")!r},run_name="__main__")'
)
argv.extend(["--provider", args.provider])
if args.diagnose:
    argv.append("--diagnose")
process = subprocess.Popen(
    argv,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
)


def watchdog():
    time.sleep(100)
    if process.poll() is None:
        process.kill()


threading.Thread(target=watchdog, daemon=True).start()
ok = False
completed = False
tool_completed = False
try:
    for line in process.stdout:
        value = json.loads(line)
        event = value.get("event", {})
        if event.get("type") == "tool.completed":
            tool_completed = True
        if "diagnostic" in value:
            print(json.dumps(value))
        if args.diagnose and event.get("type") in (
            "task.updated",
            "tool.started",
            "tool.completed",
            "tool.failed",
        ):
            print(json.dumps(event))
        if event.get("type") == "connection":
            ok = True
            print(json.dumps(event))
            if args.fixture:
                fixture = root / ".local/runtime-fixture"
                fixture.mkdir(parents=True, exist_ok=True)
                for name, contents in [
                    ("example.js", "export function add(a, b) { return a + b; }\n"),
                    ("notes.txt", "Iris disposable verification fixture.\n"),
                ]:
                    if not (fixture / name).exists():
                        (fixture / name).write_text(contents)
                process.stdin.write(
                    json.dumps({"command": "grant_root", "path": str(fixture)}) + "\n"
                )
                process.stdin.write(
                    json.dumps(
                        {"command": "grant_domains", "domains": ["docs.python.org"]}
                    )
                    + "\n"
                )
                process.stdin.flush()
            request = (
                {
                    "command": "delegate" if args.specialist else "send",
                    "requestId": "smoke-" + str(time.time_ns()),
                    "text": args.text,
                    **({"specialist": args.specialist} if args.specialist else {}),
                }
                if args.text
                else {"command": "snapshot"}
            )
            process.stdin.write(json.dumps(request) + "\n")
            process.stdin.flush()
        elif event.get("type") in (
            "message.final",
            "error",
            "turn.completed",
            "snapshot",
        ):
            print(json.dumps(event))
            if event["type"] in ("error", "turn.completed", "snapshot"):
                completed = event["type"] != "error"
                break
    if process.poll() is None:
        process.stdin.write('{"command":"shutdown"}\n')
        process.stdin.flush()
        process.wait(timeout=10)
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
sys.exit(
    0
    if ok and completed and (not (args.fixture and args.specialist) or tool_completed)
    else 1
)
