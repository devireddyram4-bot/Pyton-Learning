/* Logic shared by the page and the Node tests: grading, scoring, shuffling. No DOM access here. */
(function (root) {
  const WEIGHTS = { theory: 15, lab: 35, exercises: 30, mcq: 20 };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function norm(t) {
    const lines = String(t ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
    while (lines.length && lines[0] === "") lines.shift();
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }
  function countLines(s) {
    const a = String(s).split(/\r\n|\r|\n/);
    if (a.length && a[a.length - 1] === "") a.pop();
    return a.length;
  }
  async function grade(call, code, tests, timeoutMs = 6000) {
    const syn = await call("syntax", { code });
    if (syn) return { status: "syntax_error", passed: 0, total: tests.length, syntax: syn, tests: [] };
    const userLines = countLines(code);
    let passed = 0, anyRuntime = false;
    const results = [];
    for (const t of tests) {
      const setup = (t.setup || "").replace(/^\n+|\n+$/g, "");
      const source = (setup ? setup + "\n" : "") + code + (t.harness ? "\n" + t.harness : "");
      let run;
      try {
        run = await call("run", { source, stdin: t.stdin || "", user_lines: userLines, offset: setup ? countLines(setup) : 0 }, timeoutMs);
      } catch (e) {
        const to = e && e.message === "timeout";
        run = { ok: false, stdout: "", error: { type: to ? "TimeoutError" : "RunnerError", line: null, detail: "", in_harness: false,
          message: to ? `The program ran longer than ${timeoutMs / 1000} seconds. Check for an infinite loop or a loop that never reaches its stop condition.` : String((e && e.message) || e) } };
      }
      const actual = norm(run.stdout), expected = norm(t.expected);
      const ok = !!run.ok && actual === expected;
      if (run.error) anyRuntime = true;
      if (ok) passed++;
      results.push({ name: t.name, kind: t.kind || "normal", ok, stdin: t.stdin || "", expected, actual, error: run.error || null });
    }
    const status = passed === tests.length ? "passed" : anyRuntime ? "runtime_error" : "wrong_answer";
    return { status, passed, total: tests.length, syntax: null, tests: results };
  }
  const pyRound = (x) => { const f = Math.floor(x), d = x - f; return d === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(x); };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  function dayScores(theory, lab, ex, mcq) {
    const pts = { theory: pyRound(WEIGHTS.theory * clamp01(theory)), lab: pyRound(WEIGHTS.lab * clamp01(lab)),
      exercises: pyRound(WEIGHTS.exercises * clamp01(ex)), mcq: pyRound(WEIGHTS.mcq * clamp01(mcq)) };
    return { pts, total: pts.theory + pts.lab + pts.exercises + pts.mcq };
  }
  const band = (t) => (t >= 90 ? "Excellent" : t >= 80 ? "Good" : t >= 70 ? "Developing; revision recommended" : "Additional practice required");
  const isComplete = (total, exBest, labAttempted, mcqAttempted) => total >= 70 && exBest >= 0.6 && labAttempted && mcqAttempted;
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffled(n, seed) { const a = [...Array(n).keys()], r = mulberry32(seed); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  root.Core = { WEIGHTS, esc, norm, countLines, grade, dayScores, band, isComplete, shuffled, pyRound };
})(typeof window !== "undefined" ? window : globalThis);
