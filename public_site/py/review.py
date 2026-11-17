"""Static review helpers (pure Python: ast + tokenize). Shared by the Streamlit app and the browser version."""
import ast
import io
import re
from collections import Counter

# --------------------------------------------------------------------------------------
# Static review: naming, spelling, formatting, readability, efficiency hints
# --------------------------------------------------------------------------------------
COMMON_MISSPELLINGS = {"pritn": "print", "prnt": "print", "pint": "print", "imput": "input", "inpt": "input", "lenght": "len",
                       "retrun": "return", "reutrn": "return", "fucntion": "function", "fuction": "function",
                       "slary": "salary", "salry": "salary", "emplyee": "employee", "empolyee": "employee", "lst": "list",
                       "ture": "True", "flase": "False", "fasle": "False", "nane": "name", "nmae": "name", "rnage": "range",
                       "rang": "range", "lenth": "len", "appned": "append", "apend": "append", "tru": "True"}
KEYWORD_CASE = {"true": "True", "false": "False", "none": "None"}
BUILTINS = set(dir(__builtins__)) if isinstance(__builtins__, dict) is False else set(__builtins__.keys())


def _edit1(a, b):
    if abs(len(a) - len(b)) > 1:
        return False
    if a == b:
        return False
    i = 0
    while i < min(len(a), len(b)) and a[i] == b[i]:
        i += 1
    if len(a) == len(b):
        return a[i + 1:] == b[i + 1:] or (i + 1 < len(a) and a[i] == b[i + 1] and a[i + 1] == b[i] and a[i + 2:] == b[i + 2:])
    s, l = (a, b) if len(a) < len(b) else (b, a)
    return s[i:] == l[i + 1:]


def review_code(code):
    """Return list of {category, severity, line, message, fix}. Pure static analysis; never runs the code."""
    issues = []

    def add(cat, sev, line, msg, fix=""):
        issues.append({"category": cat, "severity": sev, "line": line, "message": msg, "fix": fix})

    lines = code.splitlines()
    try:
        tree = ast.parse(code)
    except SyntaxError:
        tree = None
    # tabs / indentation
    for i, ln in enumerate(lines, 1):
        if "\t" in ln[: len(ln) - len(ln.lstrip())]:
            add("indentation", "warn", i, "Tab used for indentation.", "Use 4 spaces per level (PEP 8).")
        elif ln.strip() and (len(ln) - len(ln.lstrip(" "))) % 4 and not ln.lstrip().startswith("#"):
            prev = lines[i - 2] if i > 1 else ""
            if not prev.rstrip().endswith((",", "(", "[", "{", "\\")):
                add("indentation", "info", i, "Indentation is not a multiple of 4 spaces.", "Use 4 spaces per level.")
        if len(ln) > 100:
            add("formatting", "info", i, f"Line is {len(ln)} characters long.", "Keep lines under about 88-100 characters.")
        if ln.rstrip() != ln:
            add("formatting", "info", i, "Trailing whitespace.", "Remove spaces at the end of the line.")
    if code and not code.endswith("\n"):
        add("formatting", "info", len(lines), "File does not end with a newline.", "Add a blank line at the end.")
    # misspelled common words & wrong-case keywords (token level, ignoring strings)
    try:
        import tokenize
        toks = list(tokenize.generate_tokens(io.StringIO(code).readline))
    except Exception:
        toks = []
    names_seen = set()
    for t in toks:
        if t.type != tokenize.NAME:
            continue
        w, ln = t.string, t.start[0]
        names_seen.add(w)
        if w in KEYWORD_CASE:
            add("spelling", "error", ln, f"`{w}` is not a Python keyword.", f"Use `{KEYWORD_CASE[w]}` (capital first letter).")
        elif w in COMMON_MISSPELLINGS:
            add("spelling", "error", ln, f"`{w}` looks misspelled.", f"Did you mean `{COMMON_MISSPELLINGS[w]}`?")
    if tree is not None:
        defined = set(dir(__import__("builtins")))
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.ClassDef)):
                defined.add(n.name)
                for a in getattr(n, "args", None).args if isinstance(n, ast.FunctionDef) else []:
                    defined.add(a.arg)
            elif isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
                defined.add(n.id)
            elif isinstance(n, (ast.Import, ast.ImportFrom)):
                for a in n.names:
                    defined.add((a.asname or a.name).split(".")[0])
            elif isinstance(n, ast.arg):
                defined.add(n.arg)
            elif isinstance(n, ast.ExceptHandler) and n.name:
                defined.add(n.name)
        for n in ast.walk(tree):
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id not in defined:
                close = [d for d in defined if _edit1(n.id, d) and len(d) > 2]
                add("naming", "error", n.lineno, f"`{n.id}` is used but never defined.",
                    f"Did you mean `{close[0]}`?" if close else "Define it before use, or check the spelling.")
        # style / naming
        for n in ast.walk(tree):
            if isinstance(n, ast.FunctionDef) and not re.fullmatch(r"[a-z_][a-z0-9_]*", n.name):
                add("naming", "info", n.lineno, f"Function `{n.name}` should use snake_case.", f"e.g. `{re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '_', n.name).lower().replace('__', '_')}`")
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store) and len(n.id) == 1 and n.id not in "ijkxyzn_abcdefpqt":
                add("naming", "info", n.lineno, f"Single-letter name `{n.id}` is hard to read.", "Use a descriptive name such as `salary` or `total`.")
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store) and n.id in {"list", "dict", "str", "int", "set", "sum", "max", "min", "len", "input", "type", "id", "file"}:
                add("naming", "warn", n.lineno, f"`{n.id}` hides a built-in name.", "Pick a different variable name.")
            if isinstance(n, ast.ExceptHandler) and n.type is None:
                add("logic-risk", "warn", n.lineno, "Bare `except:` hides every error.", "Catch a specific error, e.g. `except ValueError:`.")
            if isinstance(n, ast.Compare):
                for op, c in zip(n.ops, n.comparators):
                    if isinstance(op, (ast.Eq, ast.NotEq)) and isinstance(c, ast.Constant) and (c.value is None or c.value is True or c.value is False):
                        add("style", "info", n.lineno, f"Comparing to `{c.value}` with `==`.", "Use `is` / `is not` for None, or just the value for booleans.")
            if isinstance(n, ast.FunctionDef):
                for d in n.args.defaults:
                    if isinstance(d, (ast.List, ast.Dict, ast.Set)):
                        add("logic-risk", "warn", n.lineno, "Mutable default argument.", "Use `None` and create the list inside the function.")
            # efficiency
            if isinstance(n, ast.For) and isinstance(n.iter, ast.Call) and getattr(n.iter.func, "id", "") == "range":
                a = n.iter.args
                if a and isinstance(a[0], ast.Call) and getattr(a[0].func, "id", "") == "len":
                    add("efficiency", "info", n.lineno, "`range(len(x))` loop.", "Loop directly (`for item in x`) or use `enumerate(x)`.")
            if isinstance(n, (ast.For, ast.While)):
                for m in ast.walk(n):
                    if isinstance(m, (ast.For, ast.While)) and m is not n:
                        depth_loops = [x for x in ast.walk(m) if isinstance(x, (ast.For, ast.While))]
                        if len(depth_loops) >= 3:
                            add("efficiency", "info", n.lineno, "Three or more nested loops.", "Check whether a dict, set or built-in can avoid the nesting.")
                        break
            if isinstance(n, ast.AugAssign) and isinstance(n.op, ast.Add) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str):
                add("efficiency", "info", n.lineno, "String built with `+=`.", "For many pieces, collect them in a list and use `''.join(...)`.")
    # unused names via pyflakes
    try:
        from pyflakes import api as pf, reporter as pr
        out, err = io.StringIO(), io.StringIO()
        pf.check(code, "learner.py", pr.Reporter(out, err))
        for ln in out.getvalue().splitlines():
            m = re.match(r"learner\.py:(\d+):\d+:? (.*)", ln)
            if m and "undefined name" not in m.group(2):
                add("unused-code", "info", int(m.group(1)), m.group(2).capitalize() + ".", "Remove it or use it.")
    except Exception:
        pass
    spell_lines = {i["line"] for i in issues if i["category"] == "spelling"}
    issues = [i for i in issues if not (i["category"] == "naming" and "never defined" in i["message"] and i["line"] in spell_lines)]
    # de-duplicate (single-letter names reported once per name)
    seen, out_list = set(), []
    for it in issues:
        key = (it["category"], None if "Single-letter" in it["message"] else it["line"], it["message"])
        if key not in seen:
            seen.add(key)
            out_list.append(it)
    return sorted(out_list, key=lambda x: ({"error": 0, "warn": 1, "info": 2}[x["severity"]], x["line"] or 0))[:25]


def classify(result):
    """Turn a run/grade result into an error taxonomy: syntax | runtime | logic | ok."""
    if result.get("syntax"):
        return "syntax"
    if result.get("status") == "syntax_error":
        return "syntax"
    if result.get("status") == "runtime_error" or (result.get("error") and not result.get("syntax")):
        return "runtime"
    if result.get("status") == "wrong_answer":
        return "logic"
    return "ok"


def explain_error(err):
    """Plain-language help for common Python errors."""
    if not err:
        return ""
    t, m = err.get("type", ""), err.get("message", "")
    tips = {
        "NameError": "Python found a name it does not know. Check the spelling and that the variable is assigned before this line.",
        "TypeError": "An operation was used on the wrong type (for example adding a string to a number). Convert with int(), float() or str().",
        "ValueError": "The value has the right type but is not acceptable (for example int('abc')). Validate the input first.",
        "ZeroDivisionError": "You divided by zero. Check the divisor before dividing.",
        "IndexError": "You asked for a list position that does not exist. Valid positions are 0 to len(list)-1.",
        "KeyError": "The dictionary has no such key. Use `d.get(key, default)` or check `key in d`.",
        "AttributeError": "That object has no such method or attribute. Check the spelling and the object's type.",
        "FileNotFoundError": "The file does not exist at that path. Check the name and the folder.",
        "EOFError": "input() asked for more input than was supplied. Provide an input line for every input() call.",
        "IndentationError": "The indentation is wrong. Use 4 spaces and keep the same indent inside a block.",
        "RecursionError": "The function keeps calling itself without stopping. Add or fix the base case.",
        "TimeoutError": "The program did not finish in time. Look for an infinite loop or a counter that never changes.",
        "ModuleNotFoundError": "That library is not available in the practice sandbox. Use the standard library for this exercise.",
        "OSError": "Network and file access are restricted in the practice sandbox.",
    }
    return tips.get(t, "Read the message above and the line number it points to.") + (f" ({m})" if m and t in ("NameError",) else "")


def mistake_items(result, review):
    """List of (category, detail) to store for mistake tracking."""
    items = []
    kind = classify(result)
    if kind == "syntax":
        s = result.get("syntax") or {}
        items.append(("syntax-error", s.get("message", "")))
    elif kind == "runtime":
        e = result.get("error") or next((t.get("error") for t in result.get("tests", []) if t.get("error")), None) or {}
        items.append((f"runtime:{e.get('type', 'error')}", e.get("message", "")))
    elif kind == "logic":
        bad = [t for t in result.get("tests", []) if not t.get("ok")]
        kinds = {t.get("kind", "normal") for t in bad}
        for k in sorted(kinds):
            items.append((f"logic:{k}", ", ".join(t["name"] for t in bad if t.get("kind", "normal") == k)[:200]))
    for r in review:
        if r["category"] in ("spelling", "naming", "indentation") and r["severity"] in ("error", "warn"):
            items.append((r["category"], r["message"]))
    return items


