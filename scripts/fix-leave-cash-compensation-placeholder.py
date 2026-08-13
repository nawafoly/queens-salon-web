from pathlib import Path

path = Path("workers/core/repositories/employee-requests.js")
text = path.read_text(encoding="utf-8")
old = "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'included', ?, ?, ?, ?, ?, ?, ?, ?"
new = "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'included', ?, ?, ?, ?, ?, ?, ?"
if old not in text:
    raise SystemExit("Expected financial payment SELECT placeholder sequence not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
