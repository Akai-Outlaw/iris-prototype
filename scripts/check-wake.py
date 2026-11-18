"""Check the compiled native phrase matcher without activating a microphone."""
import ctypes
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
subprocess.run(["node", str(root / "scripts/build-wake.mjs")], check=True)
library = ctypes.CDLL(str(root / ".local/native/libIrisWake.dylib"))
for name in ("iris_wake_start", "iris_wake_control"):
    getattr(library, name)
match = library.iris_wake_matches
match.argtypes = [ctypes.c_char_p]
match.restype = ctypes.c_int32
cases = [("Hey Iris", 1), ("HEY, IRIS!", 1), ("well hey iris please help", 1),
         ("iris", 0), ("hey everybody iris", 0), ("they irises", 0), ("hey omni", 0)]
for text, expected in cases:
    assert match(text.encode()) == expected, f"Incorrect wake match: {text}"
print(f"Native wake matcher: {len(cases)} checks passed. Microphone not activated.")
