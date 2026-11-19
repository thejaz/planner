"""Independent read-only cross-check of CHP against the established accounting rules."""
from pathlib import Path
import json
import re
import sys

# Optional arguments: <vault> <engine audit json> <output json>.
args = sys.argv[1:] + [None] * 3
def local_vault():
    # Same source as tools/paths.mjs: the gitignored planner.local.json.
    local = Path(__file__).resolve().parent.parent / "planner.local.json"
    vault = json.loads(local.read_text(encoding="utf-8")).get("vault") if local.exists() else None
    if not vault:
        sys.exit(f'Pass <vault> or set "vault" in {local} (see planner.local.example.json).')
    return vault

vault = Path(args[0] or local_vault())
actual = json.loads(Path(args[1] or "artifacts/vault-audit.json").read_text(encoding="utf-8"))
engine = {r["date"]: r["projects"].get("CHP", 0) for r in actual["records"]}
total, differences = 0, []

def duration(value):
    value = value.strip()
    if value.isdigit():
        return int(value)
    return sum(int(n) * (60 if unit.lower() == "h" else 1)
               for n, unit in re.findall(r"(\d+)\s*([hm])", value, re.I))

for file in vault.rglob("*.md"):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", file.stem):
        continue
    footers, tasks = [], []
    for raw in file.read_text(encoding="utf-8-sig").splitlines():
        line = raw.replace("**", "").strip()
        current = re.fullmatch(r"(\d+)\s*:\s*CHP(?:\s+add)?", line, re.I) or re.fullmatch(r"CHP\s*=\s*(\d+)", line)
        older = re.fullmatch(r"CHP\s*:\s*(\d+)m", line, re.I)
        named = re.match(r"Total CHP Time:\s*([\dhm\s]+)", line, re.I)
        if current or older or named:
            footers.append(int((current or older)[1]) if current or older else duration(named[1]))
        if re.match(r"- \[x\]", line, re.I) and re.search(r"\bchp\b", line, re.I):
            extra = re.search(r"\(\+(\d+) chp\)", line, re.I)
            if extra:
                tasks.append(int(extra[1]))
                continue
            match = re.search(r"\(([^()]*)\)\s*:\s*(.*)", line)
            if not match:
                raise ValueError((str(file), line))
            expr, label = match.groups()
            credit = expr.split("/")[0].strip()
            if re.search(r"[+|\-]", credit):
                values = [duration(v) for v in re.split(r"[+|\-]", credit)]
                projects = [v.strip().lower().split()[0] for v in re.split(r"[+|/\-]", label)]
                tasks.append(values[projects.index("chp")])
            else:
                tasks.append(duration(credit))
    if len(footers) > 1:
        raise ValueError((str(file), footers))
    value = footers[0] if footers else sum(tasks)
    total += value
    if value != engine[file.stem]:
        differences.append({"date": file.stem, "reference": value, "engine": engine[file.stem]})
result = {"reference_chp_minutes": total, "engine_chp_minutes": actual["chpMinutes"], "differences": differences}
Path(args[2] or "artifacts/reference-audit.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
if differences:
    raise SystemExit(1)
