"""In-browser runner (Pyodide). Executes one program per call with stdin, a line-number-aware error report and an output cap.
Timeouts are enforced by the page (it terminates and restarts the worker), because a Python loop cannot interrupt itself."""
import ast
import builtins
import io
import json
import sys

import review

MAX_OUT = 20000


class _OutputLimit(BaseException):
    pass


class _Out(io.StringIO):
    def write(self, s):
        room = MAX_OUT - self.tell()
        if len(s) > room:
            super().write(s[:max(0, room)])
            raise _OutputLimit("The program printed more than 20,000 characters. Check for a loop that prints forever.")
        return super().write(s)


def syntax_check(code):
    try:
        ast.parse(code, "learner.py")
        return None
    except SyntaxError as e:
        return {"type": type(e).__name__, "message": e.msg, "line": e.lineno, "col": e.offset, "text": (e.text or "").rstrip()}
    except ValueError as e:
        return {"type": "ValueError", "message": str(e), "line": None, "col": None, "text": ""}


def _info(exc, user_lines, offset):
    tb, line = exc.__traceback__, None
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == "learner.py":
            line = tb.tb_lineno
        tb = tb.tb_next
    if line is None and isinstance(exc, SyntaxError):
        line = exc.lineno
    in_h = False
    if line is not None:
        line -= offset
        in_h = line < 1 or line > user_lines
    import traceback
    return {"type": type(exc).__name__, "message": str(exc), "line": None if in_h else line,
            "detail": "".join(traceback.format_exception_only(type(exc), exc)).strip(), "in_harness": in_h}


def run_source(source, stdin="", user_lines=10 ** 9, offset=0):
    out = _Out()
    lines = (stdin or "").split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    it = iter(lines)

    def _input(prompt=""):
        try:
            return next(it)
        except StopIteration:
            raise EOFError("input() was called but no more input was provided")

    b = dict(vars(builtins))
    b["input"] = _input
    g = {"__name__": "__main__", "__builtins__": b}
    err = None
    old = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = out, io.StringIO()
    try:
        exec(compile(source, "learner.py", "exec"), g)
    except SystemExit:
        pass
    except _OutputLimit as e:
        err = {"type": "OutputLimit", "message": str(e), "line": None, "detail": "", "in_harness": False}
    except BaseException as e:  # noqa: BLE001
        err = _info(e, user_lines, offset)
    finally:
        sys.stdout, sys.stderr = old
    return {"ok": err is None, "stdout": out.getvalue(), "error": err, "syntax": None}


def api(name, payload_json):
    p = json.loads(payload_json)
    if name == "syntax":
        r = syntax_check(p["code"])
    elif name == "run":
        r = run_source(p["source"], p.get("stdin", ""), p.get("user_lines", 10 ** 9), p.get("offset", 0))
    elif name == "review":
        r = review.review_code(p["code"])
    elif name == "mistakes":
        r = review.mistake_items(p["result"], p.get("review", []))
    elif name == "explain":
        r = review.explain_error(p["err"])
    else:
        raise ValueError("unknown call " + name)
    return json.dumps(r)
