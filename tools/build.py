#!/usr/bin/env python3
"""Deterministic local candidate packages. No install, network or publishing."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
assert manifest["kind"] == "marinara.personal-extension"
assert manifest["config"]["capabilities"] == ["full_page_access"]
assert manifest["config"]["runtime"] == "client"
version = manifest["config"]["version"]
assert version == "0.1.4"
source = (ROOT / manifest["config"]["jsPath"]).read_text(encoding="utf-8")
subprocess.run(["node", "--check"], input=f"(async (marinara) => {{\n{source}\n}});\n", text=True, check=True)
assert (ROOT / manifest["config"]["cssPath"]).is_file()
files = [ROOT / name for name in ["manifest.json", "extension.js", "extension.css", "agent-prompt.txt", "README.md", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md", "LICENSE"]]
for folder in ["agent", "test", "tools"]:
    files.extend(p for p in (ROOT / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
for p in files:
    assert not p.is_symlink(), p
    assert p.suffix in {".json", ".js", ".css", ".txt", ".md", ".mjs", ".cjs", ".html", ".py"} or p.name == "LICENSE", p
    assert not re.search(rb"/home/[a-zA-Z0-9_-]+/", p.read_bytes()), f"Private machine path in {p.name}"
dist = ROOT / "dist"
dist.mkdir(exist_ok=True)

def archive(name, entries):
    target = dist / name
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for relative, p in sorted(entries):
            info = zipfile.ZipInfo(relative, date_time=(2026, 10, 2, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, p.read_bytes())
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        for relative, p in entries:
            assert z.read(relative) == p.read_bytes()
    return target

extension = archive(f"marinara-pixai-illustrator-v{version}.zip", [(str(p.relative_to(ROOT)), p) for p in files])
agent = dist / "pixai-director.agent.json"
agent.write_bytes((ROOT / "agent/pixai-director.agent.json").read_bytes())
assert agent.read_bytes() == (ROOT / "agent/pixai-director.agent.json").read_bytes()
checksums = "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in [extension, agent])
(dist / "SHA256SUMS").write_text(checksums, encoding="utf-8")
print(f"PASS wrapped node --check; {len(files)} source files; archive bytes read back against originals")
print(checksums, end="")
