from pathlib import Path

script_path = Path("scripts/employee-overview-runtime-finalize-temp.py")
text = script_path.read_text(encoding="utf-8")

old_helper = '''def regex_once(text: str, pattern: str, replacement: str, label: str, flags=0) -> str:\n    result, count = re.subn(pattern, replacement, text, count=1, flags=flags)\n    if count != 1:\n        raise SystemExit(f'{label}: expected exactly one regex match, found {count}')\n    return result\n'''

new_helper = '''def regex_once(text: str, pattern: str, replacement: str, label: str, flags=0) -> str:\n    if label == "make Core leave failure explicit":\n        start_marker = """  useEffect(() => {\n    if (!session.uid) {\n      setEmployeeLeaveRequests([]);\n      return;\n    }\n\n    let alive = true;\n\n    async function loadEmployeeLeaveRequests() {"""\n        end_marker = """\n\n  useEffect(() => {\n    let alive = true;\n\n    async function loadEmployeeTarget() {"""\n        start = text.find(start_marker)\n        end = text.find(end_marker, start)\n        if start < 0 or end < 0:\n            raise SystemExit(f"{label}: effect boundaries missing")\n        return text[:start] + replacement + text[end:]\n\n    result, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=flags)\n    if count != 1:\n        raise SystemExit(f'{label}: expected exactly one regex match, found {count}')\n    return result\n'''

if text.count(old_helper) != 1:
    raise SystemExit("finalizer regex helper anchor missing")

patched = text.replace(old_helper, new_helper, 1)
code = compile(patched, str(script_path), "exec")
exec(code, {"__name__": "__main__", "__file__": str(script_path)})
