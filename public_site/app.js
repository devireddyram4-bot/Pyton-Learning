/* 60-Day Python Mastery: static, in-browser version. Python runs in the learner's own browser (Pyodide).
   Progress and code are saved in this browser (localStorage). Nothing is sent to any server. */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const { esc, norm, grade, dayScores, band, isComplete, shuffled, WEIGHTS } = Core;
const md = (t) => (window.marked ? marked.parse(String(t ?? ""), { mangle: false, headerIds: false }) : esc(t));
const KEY = "pymastery.v1";
let D = null;      // course data
let S = load();    // learner state
let editors = {};  // live CodeMirror instances for the visible page

/* ------------------------------ storage ------------------------------ */
function blank() { return { drafts: {}, attempts: [], quiz: [], mistakes: [], scores: {}, theoryTab: {}, name: "" }; }
function load() {
  try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { return blank(); }
}
let saveWarned = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { if (!saveWarned) { saveWarned = true; toast("Could not save in this browser (storage is full or blocked). Use Export on the Progress page to keep a copy."); } }
}
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 3800); }

/* ------------------------------ python worker ------------------------------ */
let worker = null, ready = null, seq = 0, pending = new Map(), runnerState = "starting", runnerError = "";
function startWorker() {
  if (worker) { try { worker.terminate(); } catch (e) {} }
  for (const [, p] of pending) p.reject(new Error("restarted"));
  pending.clear();
  runnerState = "starting"; paintRunner();
  worker = new Worker("worker.js");
  ready = new Promise((res, rej) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.ready) { runnerState = "ready"; paintRunner(); res(); return; }
      if (m.fatal) { runnerState = "bad"; runnerError = m.fatal; paintRunner(); rej(new Error(m.fatal)); return; }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
    };
    worker.onerror = (e) => { runnerState = "bad"; runnerError = e.message || "worker error"; paintRunner(); rej(new Error(runnerError)); };
  });
  ready.catch(() => {});
}
let chain = Promise.resolve();
/* Calls run one at a time. A timeout then only ever affects the call that is actually running,
   so restarting the worker can never reject some other waiting call. */
function call(type, payload, timeoutMs = 8000) {
  const p = chain.then(() => callNow(type, payload, timeoutMs));
  chain = p.catch(() => {});
  return p;
}
async function callNow(type, payload, timeoutMs) {
  await ready.catch(() => { throw new Error("Python could not start in this browser" + (runnerError ? ": " + runnerError : "")); });
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const t = setTimeout(() => {           // a stuck program: stop the whole worker, then start a fresh one
      pending.delete(id); reject(new Error("timeout")); startWorker();
    }, timeoutMs);
    pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    worker.postMessage({ id, type, payload });
  });
}
function paintRunner() {
  const el = $("#sidefoot"); if (!el) return;
  const txt = runnerState === "ready" ? "Python is ready (runs in your browser)" : runnerState === "bad" ? "Python could not start: " + esc(runnerError) : "Starting Python (first load downloads about 13 MB)…";
  el.innerHTML = `<span class="status ${runnerState === "ready" ? "ready" : runnerState === "bad" ? "bad" : ""}"></span>${txt}`;
  document.querySelectorAll("[data-needs-py]").forEach((b) => (b.disabled = runnerState !== "ready"));
}
async function runPy(source, stdin) { return call("run", { source, stdin, user_lines: Core.countLines(source) }, 6000); }

/* ------------------------------ derived data ------------------------------ */
const upgraded = (n) => D.upgraded[String(n)];
const att = (kind, key) => S.attempts.filter((a) => a.kind === kind && a.key === key);
const bestFrac = (arr) => arr.reduce((m, a) => Math.max(m, a.total ? a.passed / a.total : 0), 0);
function dayEval(n) {
  const d = upgraded(n); if (!d) return null;
  const q = S.quiz.filter((x) => x.day === n);
  const th = q.filter((x) => x.kind === "theory"), mc = q.filter((x) => x.kind === "mcq");
  const frac = (a) => a.reduce((m, x) => Math.max(m, x.total ? x.score / x.total : 0), 0);
  const lab = att("lab", "lab_" + n);
  const exs = d.exercises.map((e) => bestFrac(att("exercise", e.id)));
  const exBest = exs.length ? exs.reduce((a, b) => a + b, 0) / exs.length : 0;
  const { pts, total } = dayScores(frac(th), bestFrac(lab), exBest, frac(mc));
  return { pts, total, exs, exBest, labAttempted: lab.length > 0, mcqAttempted: mc.length > 0, labPassed: lab.some((a) => a.status === "passed"), complete: isComplete(total, exBest, lab.length > 0, mc.length > 0) };
}
const doneDays = () => Object.keys(S.scores).filter((k) => S.scores[k].completed).map(Number);
const currentDay = () => { const d = new Set(doneDays()); for (let i = 1; i <= 60; i++) if (!d.has(i)) return i; return 60; };
const stageOf = (n) => D.stages.find((s) => n >= s.days[0] && n <= s.days[1]);
function streak() {
  const days = new Set(S.attempts.map((a) => a.t.slice(0, 10)).concat(S.quiz.map((q) => q.t.slice(0, 10))));
  let n = 0; const d = new Date();
  if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
const nowIso = () => new Date().toISOString();

/* ------------------------------ editor helpers ------------------------------ */
function highlight(code) {
  const pre = document.createElement("pre"); pre.className = "cm-s-default codepre";
  if (window.CodeMirror && CodeMirror.runMode) CodeMirror.runMode(code, "python", pre); else pre.textContent = code;
  return pre;
}
function codeBlock(code) {
  const w = document.createElement("div"); w.className = "codewrap";
  w.appendChild(highlight(code));
  const b = document.createElement("button"); b.className = "copy"; b.textContent = "Copy"; b.setAttribute("aria-label", "Copy code");
  b.onclick = async () => { try { await navigator.clipboard.writeText(code); b.textContent = "Copied"; } catch (e) { b.textContent = "Press Ctrl/Cmd+C"; } setTimeout(() => (b.textContent = "Copy"), 1500); };
  w.appendChild(b); return w;
}
const outBlock = (t) => { const p = document.createElement("pre"); p.className = "out"; p.textContent = t === "" ? "(no output)" : t; return p; };
function makeEditor(host, key, starter) {
  const saved = S.drafts[key];
  const ta = document.createElement("textarea"); host.appendChild(ta); ta.value = saved != null ? saved : starter;
  const ed = CodeMirror.fromTextArea(ta, { mode: "python", lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false, matchBrackets: true, lineWrapping: false,
    extraKeys: { Tab: (cm) => (cm.somethingSelected() ? cm.indentSelection("add") : cm.replaceSelection("    ", "end")), "Shift-Tab": (cm) => cm.indentSelection("subtract") } });
  let t; ed.on("change", () => { clearTimeout(t); t = setTimeout(() => { S.drafts[key] = ed.getValue(); save(); const n = host.querySelector(".saved"); if (n) n.textContent = "Saved in this browser"; }, 400); });
  const note = document.createElement("div"); note.className = "lbl saved"; note.textContent = "Your code is saved in this browser as you type."; host.appendChild(note);
  editors[key] = ed; setTimeout(() => ed.refresh(), 30);
  return ed;
}
function resetEditor(key, starter) { delete S.drafts[key]; save(); if (editors[key]) editors[key].setValue(starter); }

/* ------------------------------ result renderers ------------------------------ */
const STATUS = { passed: ["ok", "✅ All tests passed"], wrong_answer: ["err", "❌ Logic error: the program runs but the output is not what was expected"], runtime_error: ["err", "💥 Runtime error: the program crashed while running"], syntax_error: ["err", "⛔ Syntax error: Python could not read the program"] };
function renderRun(host, r, hint) {
  host.innerHTML = "";
  if (r.syntax) { const s = r.syntax;
    host.insertAdjacentHTML("beforeend", `<div class="box err"><b>⛔ Syntax error</b>: Python could not read your code.<br>Line ${esc(s.line)}: ${esc(s.message)}</div>`);
    if (s.text) host.appendChild(highlight(s.text)); host.insertAdjacentHTML("beforeend", `<p class="muted">Check for a missing colon, bracket or quote, or an indentation problem near that line.</p>`); return; }
  if (r.stdout) { host.insertAdjacentHTML("beforeend", `<div class="lbl">Output</div>`); host.appendChild(outBlock(r.stdout)); }
  else if (r.ok) host.insertAdjacentHTML("beforeend", `<div class="box info">The program ran but printed nothing. Use <code>print()</code> to see results.</div>`);
  if (r.error) { const e = r.error;
    host.insertAdjacentHTML("beforeend", `<div class="box err"><b>💥 Runtime error</b> (${esc(e.type)}): the code is valid but failed while running${e.line ? ` at <b>line ${esc(e.line)}</b>` : ""}.<br><code>${esc(e.message)}</code></div>`);
    if (hint) host.insertAdjacentHTML("beforeend", `<p class="muted">${esc(hint)}</p>`);
  } else if (r.ok) host.insertAdjacentHTML("beforeend", `<div class="box ok">Ran successfully. This only shows the code <i>runs</i>. Press <b>Submit</b> to check it is <i>correct</i>.</div>`);
}
function renderGrade(host, g) {
  host.innerHTML = "";
  const [cls, label] = STATUS[g.status];
  host.insertAdjacentHTML("beforeend", `<div class="box ${cls}"><b>${label}</b> · ${g.passed}/${g.total} tests</div>`);
  if (g.status === "syntax_error") { const s = g.syntax; host.insertAdjacentHTML("beforeend", `<p>Line ${esc(s.line)}: ${esc(s.message)}</p>`); if (s.text) host.appendChild(highlight(s.text)); return; }
  let opened = false;
  g.tests.forEach((t) => {
    const d = document.createElement("details"); d.open = !t.ok && !opened; if (!t.ok) opened = true;
    d.innerHTML = `<summary>${t.ok ? "✅" : "❌"} ${esc(t.name)}<span class="pill">${esc(t.kind === "invalid" ? "invalid input" : t.kind)}</span></summary><div class="in"></div>`;
    const in_ = d.querySelector(".in");
    if (t.stdin) { in_.insertAdjacentHTML("beforeend", `<div class="lbl">Input given</div>`); in_.appendChild(outBlock(t.stdin)); }
    const two = document.createElement("div"); two.className = "two";
    const a = document.createElement("div"); a.innerHTML = `<div class="lbl">Expected</div>`; a.appendChild(outBlock(t.expected));
    const b = document.createElement("div"); b.innerHTML = `<div class="lbl">Your output</div>`; b.appendChild(outBlock(t.actual));
    two.append(a, b); in_.appendChild(two);
    if (t.error) { const e = t.error; in_.insertAdjacentHTML("beforeend", `<div class="box err">Runtime error ${e.in_harness ? "in the checker (a name in your code may differ from the task)" : e.line ? "at line " + esc(e.line) : ""}: ${esc(e.type)}: ${esc(e.message)}</div>`); }
    host.appendChild(d);
  });
}
function renderReview(host, items) {
  const det = document.createElement("details"); det.open = items.length > 0;
  det.innerHTML = `<summary>Naming, spelling and formatting feedback (${items.length})</summary><div class="in"></div>`;
  const in_ = det.querySelector(".in");
  if (!items.length) in_.innerHTML = `<div class="box ok">No naming, spelling or formatting problems found.</div>`;
  const ic = { error: "🔴", warn: "🟠", info: "🔵" };
  items.forEach((r) => in_.insertAdjacentHTML("beforeend", `<p>${ic[r.severity]} <b>${esc(r.category)}</b> · ${r.line ? "line " + esc(r.line) + ": " : ""}${esc(r.message)}${r.fix ? `<br><i class="muted">↳ ${esc(r.fix)}</i>` : ""}</p>`));
  host.appendChild(det);
}
function logMistakes(scope, day, items) { items.forEach(([c, d]) => S.mistakes.push({ scope, day, category: c, detail: String(d || "").slice(0, 200), t: nowIso() })); }
async function submitCode({ kind, key, day, ed, starter, tests, out, scope }) {
  const code = ed.getValue();
  if (!code.trim() || code.trim() === starter.trim()) { out.innerHTML = `<div class="box warn">Write some code first. The workspace only has the starter template.</div>`; return; }
  S.drafts[key.draft || key] = code; save();
  out.innerHTML = `<p class="muted">Running your code against ${tests.length} tests…</p>`;
  let g; try { g = await grade(call, code, tests); } catch (e) { out.innerHTML = `<div class="box err">Your code was NOT checked: ${esc(e.message === "restarted" ? "Python restarted. Please try again." : e.message)}</div>`; return; }
  const rev = await call("review", { code }).catch(() => []);
  S.attempts.push({ kind, key: key.id || key, day, status: g.status, passed: g.passed, total: g.total, code, t: nowIso() });
  const items = await call("mistakes", { result: { ...g, syntax: g.syntax }, review: rev }).catch(() => []);
  logMistakes(scope || "day", day, items); save();
  renderGrade(out, g); renderReview(out, rev);
  const bad = g.tests.filter((t) => !t.ok), kinds = new Set(bad.map((t) => t.kind));
  if (bad.length && g.passed > 0 && (kinds.has("boundary") || kinds.has("invalid"))) out.insertAdjacentHTML("beforeend", `<div class="box warn">Your code handles normal cases but fails boundary or invalid inputs. Re-read the constraints for edge cases.</div>`);
  if (g.status === "passed") toast("🎉 All tests passed");
  return g;
}

/* ------------------------------ pages ------------------------------ */
const NAV = [["#/", "🗺️ Roadmap"], ["#/lesson", "📖 Today's Lesson"], ["#/practice", "🧪 Practice Mode"], ["#/projects", "🛠️ Projects & Capstone"], ["#/progress", "📊 Progress & Skills"], ["#/credentials", "🏆 Credentials"], ["#/guide", "📋 Guide"]];
function route() {
  const h = location.hash || "#/"; const [path, ...rest] = h.split("/").slice(1).join("/").split("?")[0].split("/"); return { page: path || "", args: rest };
}
function paintNav(page) {
  $("#nav").innerHTML = NAV.map(([href, t]) => `<a href="${href}" class="${(href === "#/" + page || (href === "#/" && page === "")) ? "on" : ""}">${t}</a>`).join("");
}
async function render() {
  editors = {}; const { page, args } = route(); paintNav(page);
  const m = $("#main"); m.innerHTML = "";
  const fn = { "": pageRoadmap, lesson: pageLesson, practice: pagePractice, projects: pageProjects, progress: pageProgress, credentials: pageCredentials, guide: pageGuide }[page] || pageRoadmap;
  await fn(m, args); paintRunner(); window.scrollTo(0, 0);
}
window.addEventListener("hashchange", render);

function pageRoadmap(m) {
  const done = new Set(doneDays()), cur = currentDay();
  m.insertAdjacentHTML("beforeend", `<h1>60-Day Python Mastery Programme</h1><p class="muted">One hour per day: build Python applications, automate data workflows, work with APIs and databases, and develop your first AI-powered application.</p>
  <div class="grid"><div class="card"><div class="n">60</div>Days</div><div class="card"><div class="n">${D.projects.length}</div>Projects</div><div class="card"><div class="n">${D.stages.length}</div>Stages</div><div class="card"><div class="n">${done.size}/60</div>Days complete</div></div>
  <div class="btns"><a class="btn primary" href="#/lesson/${cur}">▶️ Continue with Day ${cur}</a></div>
  <div class="box info">Full lessons (detailed theory, separate reference and practice editors, graded exercises, 8-question quizzes, daily scoring) are ready for <b>Days 1 to 7</b>. Days 8 to 60 show the original short lesson and are marked <i>upgrade pending</i>.</div>`);
  D.stages.forEach((s) => {
    const det = document.createElement("details"); det.open = s.id === 1;
    let rows = "";
    for (let n = s.days[0]; n <= s.days[1]; n++) { const sc = S.scores[n]; const st = sc && sc.completed ? `✅ ${sc.total}/100` : sc ? `🟡 best ${sc.total}` : n === cur ? "👉" : "⬜";
      rows += `<tr><td>${st}</td><td><a href="#/lesson/${n}">Day ${n}</a></td><td>${esc(D.days[n].topics)}</td><td>${esc(D.days[n].assignment)}</td><td>${upgraded(n) ? "Full" : "Basic"}</td></tr>`; }
    det.innerHTML = `<summary>${s.badge} Stage ${s.id}: ${esc(s.name)} · Days ${s.days[0]}–${s.days[1]}</summary><div class="in"><div style="overflow:auto"><table><thead><tr><th></th><th>Day</th><th>Topics</th><th>Practical assignment</th><th>Depth</th></tr></thead><tbody>${rows}</tbody></table></div><div class="box info"><b>Stage assessment:</b> ${esc(s.assessment)}</div></div>`;
    m.appendChild(det);
  });
}

function tabs(host, id, names, cur, base) {
  host.insertAdjacentHTML("beforeend", `<div class="tabs" role="tablist">${names.map(([k, t]) => `<a href="${base}/${k}" role="tab" class="${k === cur ? "on" : ""}">${t}</a>`).join("")}</div>`);
}
const TABS = [["theory", "📘 Theory & Syntax"], ["lab", "💻 Coding Lab"], ["exercises", "📝 Exercises"], ["quiz", "✅ Daily Quiz"], ["eval", "📊 Evaluation"], ["revision", "🔁 Revision"]];
async function pageLesson(m, args) {
  const n = Math.min(60, Math.max(1, parseInt(args[0] || currentDay(), 10) || 1)); const tab = args[1] || "theory";
  const d0 = D.days[n], stg = stageOf(n);
  m.insertAdjacentHTML("beforeend", `<div class="btns noprint"><a class="btn" href="#/lesson/${Math.max(1, n - 1)}" ${n <= 1 ? 'style="visibility:hidden"' : ""}>⬅️ Previous</a><a class="btn" href="#/lesson/${Math.min(60, n + 1)}" ${n >= 60 ? 'style="visibility:hidden"' : ""}>Next ➡️</a></div>
    <h1>Day ${n}</h1><p><b>Stage ${stg.id}: ${esc(stg.name)}</b></p><p><b>Topics to learn:</b> ${esc(d0.topics)}</p><div class="box ok"><b>Practical assignment:</b> ${esc(d0.assignment)}</div>`);
  const d = upgraded(n);
  if (!d) {
    m.insertAdjacentHTML("beforeend", `<div class="box warn"><b>Upgrade pending.</b> This day still has the original short lesson. The full lesson (detailed theory, graded exercises, 8 quiz questions, scoring) is written for Days 1 to 7 so far. This day cannot be marked complete yet.</div>`);
    m.insertAdjacentHTML("beforeend", `<ul>${(d0.theory || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
    if (d0.syntax) m.appendChild(codeBlock(d0.syntax));
    m.insertAdjacentHTML("beforeend", `<div class="lbl">Original example (read-only)</div>`); m.appendChild(codeBlock(d0.code));
    m.insertAdjacentHTML("beforeend", `<div class="lbl">Expected output</div>`); m.appendChild(outBlock(D.expected[String(n)] || "")); return;
  }
  tabs(m, "lesson", TABS, tab, `#/lesson/${n}`);
  const body = document.createElement("div"); m.appendChild(body);
  ({ theory: tabTheory, lab: tabLab, exercises: tabExercises, quiz: tabQuiz, eval: tabEval, revision: tabRevision }[tab] || tabTheory)(body, n, d);
}
function det(title, html, open) { const d = document.createElement("details"); d.open = !!open; d.innerHTML = `<summary>${title}</summary><div class="in"></div>`; if (html != null) d.querySelector(".in").innerHTML = html; return d; }

function tabTheory(m, n, d) {
  const g = D.gen[String(n)] || {};
  m.insertAdjacentHTML("beforeend", `<div>${md(d.intro)}</div>`);
  m.appendChild(det("🎯 Why this concept matters", md(d.why)));
  m.appendChild(det("⚙️ How Python processes it", md(d.how)));
  m.appendChild(det("🔤 Syntax explained: keywords, symbols, indentation", md(d.syntax)));
  m.insertAdjacentHTML("beforeend", `<h2>Worked examples</h2>`);
  d.examples.forEach((e, i) => {
    const x = det(`${["🟢", "🟡", "🟠"][i % 3]} ${esc(e.level)}: ${esc(e.title)}`, null, i === 0), in_ = x.querySelector(".in");
    in_.appendChild(codeBlock(e.code));
    if (e.stdin) { in_.insertAdjacentHTML("beforeend", `<div class="lbl">Keyboard input used</div>`); in_.appendChild(outBlock(e.stdin)); }
    in_.insertAdjacentHTML("beforeend", `<div class="lbl">Expected output (recorded from a real run of this code)</div>`); in_.appendChild(outBlock((g.examples && g.examples[i] && g.examples[i].stdout) || ""));
    in_.appendChild(det("Line-by-line explanation", `<ol>${e.explain.map((l) => `<li>${md(l).replace(/^<p>|<\/p>\s*$/g, "")}</li>`).join("")}</ol>`));
    m.appendChild(x);
  });
  const rw = det("🏭 Real-world use: Data Engineering, SQL / Snowflake, ETL, AI", null), rwi = rw.querySelector(".in");
  d.real_world.forEach((r, i) => { rwi.insertAdjacentHTML("beforeend", `<p><b>${esc(r.title)}.</b> ${esc(r.text)}</p>`); rwi.appendChild(codeBlock(r.code)); rwi.insertAdjacentHTML("beforeend", `<div class="lbl">Expected output</div>`); rwi.appendChild(outBlock((g.real_world && g.real_world[i] && g.real_world[i].stdout) || "")); });
  m.appendChild(rw);
  const mk = det("⚠️ Common mistakes: wrong vs correct code", null), mi = mk.querySelector(".in");
  d.mistakes.forEach((x, i) => {
    const r = (g.mistakes || [])[i] || {};
    mi.insertAdjacentHTML("beforeend", `<h3>${i + 1}. ${esc(x.title)}</h3>`);
    const two = document.createElement("div"); two.className = "two";
    const a = document.createElement("div"); a.innerHTML = `<div class="lbl">❌ Incorrect</div>`; a.appendChild(codeBlock(x.wrong));
    a.insertAdjacentHTML("beforeend", r.wrong_err ? `<div class="box err">Real result: ${esc(r.wrong_err)}</div>` : r.timeout ? `<div class="box err">Real result: it never finishes (infinite loop)</div>` : `<div class="box warn">Real result: runs but prints <code>${esc(r.wrong_out || "(nothing)")}</code> (a logic error)</div>`);
    const b = document.createElement("div"); b.innerHTML = `<div class="lbl">✅ Correct</div>`; b.appendChild(codeBlock(x.right)); b.insertAdjacentHTML("beforeend", `<div class="box ok">Real result: <code>${esc(r.right_out || "(nothing)")}</code></div>`);
    two.append(a, b); mi.appendChild(two); mi.insertAdjacentHTML("beforeend", `<p class="muted">${esc(x.why)}</p>`);
  });
  m.appendChild(mk);
  m.appendChild(det("💬 Interview questions, answers and follow-ups", d.interview.map((q, i) => `<p><b>Q${i + 1}. ${esc(q.q)}</b></p><blockquote>${esc(q.a)}</blockquote>${q.follow.map((f) => `<p>• <i>Follow-up:</i> ${esc(f.q)}<br>→ ${esc(f.a)}</p>`).join("")}`).join("")));
  m.appendChild(det("🧠 Memory techniques, analogies and revision notes", md(d.memory)));
  m.insertAdjacentHTML("beforeend", `<h2>Theory self-check (15 points)</h2><p class="muted">Answer these to show you understood the theory. Your best attempt counts.</p>`);
  quizForm(m, n, d.theory_check, "theory", false);
}

function quizForm(host, n, bank, kind, shuffle) {
  const prior = S.quiz.filter((q) => q.day === n && q.kind === kind);
  const order = shuffle ? shuffled(bank.length, n * 1000 + prior.length) : bank.map((_, i) => i);
  const optOrder = (qi) => (shuffle ? shuffled(bank[qi].opts.length, n * 77 + qi * 13 + prior.length) : bank[qi].opts.map((_, i) => i));
  if (shuffle) host.insertAdjacentHTML("beforeend", `<p class="muted">Attempt ${prior.length + 1}. Question and option order change on every attempt.</p>`);
  const form = document.createElement("form"); const picks = {};
  order.forEach((qi, pos) => {
    const q = bank[qi]; const oo = optOrder(qi);
    const f = document.createElement("fieldset"); f.className = "q"; f.style.cssText = "border:0;padding:8px 0";
    f.innerHTML = `<legend><b>${pos + 1}.${q.kind ? ` [${esc(q.kind)}]` : ""}</b></legend><div class="qt">${md(q.q)}</div>` +
      oo.map((oi) => `<label class="opt"><input type="radio" name="q${qi}" value="${oi}"> ${esc(q.opts[oi])}</label>`).join("");
    form.appendChild(f);
  });
  const b = document.createElement("button"); b.className = "primary"; b.type = "submit"; b.textContent = kind === "mcq" ? "Submit quiz" : "Submit self-check"; form.appendChild(b);
  const res = document.createElement("div");
  form.onsubmit = (ev) => {
    ev.preventDefault(); let score = 0; const detail = [];
    for (const qi of order) { const v = form.querySelector(`input[name=q${qi}]:checked`); if (!v) { toast("Please answer every question."); return; } picks[qi] = +v.value; }
    res.innerHTML = "";
    order.forEach((qi, pos) => {
      const q = bank[qi], ok = picks[qi] === q.ans; if (ok) score++;
      detail.push({ q: q.q.slice(0, 120), kind: q.kind || "theory", ok });
      const dd = det(`${ok ? "✅" : "❌"} Question ${pos + 1}`, null, !ok), in_ = dd.querySelector(".in");
      in_.insertAdjacentHTML("beforeend", md(q.q) + `<p>Your answer: <b>${esc(q.opts[picks[qi]])}</b></p>`);
      if (!ok) { const wi = [...q.opts.keys()].filter((i) => i !== q.ans).indexOf(picks[qi]); in_.insertAdjacentHTML("beforeend", `<div class="box err">Why this is wrong: ${esc(q.wrongs[wi])}</div>`); }
      in_.insertAdjacentHTML("beforeend", `<div class="box ok">Correct answer: ${esc(q.opts[q.ans])}<br>${esc(q.why)}</div>`); res.appendChild(dd);
    });
    S.quiz.push({ day: n, kind, score, total: bank.length, detail, t: nowIso() });
    logMistakes("day", n, detail.filter((x) => !x.ok).map((x) => [kind === "mcq" ? "mcq:" + x.kind : "theory-concept", x.q])); save();
    res.insertAdjacentHTML("afterbegin", `<h3>Score: ${score}/${bank.length} (${Math.round((100 * score) / bank.length)}%)</h3>`);
    b.disabled = true; form.querySelectorAll("input").forEach((i) => (i.disabled = true));
    const again = document.createElement("a"); again.className = "btn"; again.textContent = "Try again with a new order"; again.href = "#/lesson/" + n + "/" + (kind === "mcq" ? "quiz" : "theory"); again.onclick = (e) => { e.preventDefault(); render(); };
    res.appendChild(again);
  };
  host.append(form, res);
  if (prior.length) host.insertAdjacentHTML("beforeend", `<p class="muted">Attempts so far: ${prior.map((p) => p.score + "/" + p.total).slice(-8).join(", ")}</p>`);
}
function tabQuiz(m, n, d) { m.insertAdjacentHTML("beforeend", `<h2>Daily quiz (${d.mcq.length} questions, 20 points)</h2>`); quizForm(m, n, d.mcq, "mcq", true); }

function workspace(host, { key, day, kind, item, scope }) {
  const wrap = document.createElement("div"); host.appendChild(wrap);
  const ed = makeEditor(wrap, key, item.starter);
  const needsInput = /input\(/.test(item.starter + (S.drafts[key] || ""));
  const stdin = document.createElement("textarea"); stdin.className = "stdin"; stdin.placeholder = "Keyboard input for your own run (one line per input() call)"; stdin.value = (S.stdin || {})[key] || "";
  stdin.oninput = () => { S.stdin = S.stdin || {}; S.stdin[key] = stdin.value; save(); };
  wrap.insertAdjacentHTML("beforeend", `<div class="lbl">Keyboard input for your own run</div>`); wrap.appendChild(stdin);
  const row = document.createElement("div"); row.className = "btns";
  const run = Object.assign(document.createElement("button"), { textContent: "▶️ Run" }); run.setAttribute("data-needs-py", "");
  const sub = Object.assign(document.createElement("button"), { textContent: "📤 Submit", className: "primary" }); sub.setAttribute("data-needs-py", "");
  const rst = Object.assign(document.createElement("button"), { textContent: "↺ Reset" });
  row.append(run, sub, rst); wrap.appendChild(row);
  const out = document.createElement("div"); wrap.appendChild(out);
  const extra = document.createElement("div"); wrap.appendChild(extra);
  run.disabled = sub.disabled = runnerState !== "ready";
  run.onclick = async () => {
    const code = ed.getValue(); S.drafts[key] = code; save();
    if (!code.trim() || code.trim() === item.starter.trim()) { out.innerHTML = `<div class="box warn">Write some code first. The workspace only has the starter template.</div>`; return; }
    out.innerHTML = `<p class="muted">Running…</p>`;
    const setup = (item.tests[0] && item.tests[0].setup) || "";
    try {
      const source = (setup ? setup.replace(/^\n+|\n+$/g, "") + "\n" : "") + code;
      const r = await call("syntax", { code });
      if (r) { renderRun(out, { syntax: r }); return; }
      const res = await call("run", { source, stdin: stdin.value, user_lines: Core.countLines(code), offset: setup ? Core.countLines(setup.replace(/^\n+|\n+$/g, "")) : 0 }, 6000);
      const hint = res.error ? await call("explain", { err: res.error }).catch(() => "") : "";
      renderRun(out, res, hint); const rev = await call("review", { code }).catch(() => []); renderReview(out, rev);
    } catch (e) { out.innerHTML = `<div class="box err">${e.message === "timeout" ? "The program ran longer than 6 seconds and was stopped. Check for an infinite loop." : "Your code was NOT run: " + esc(e.message)}</div>`; }
  };
  sub.onclick = async () => { sub.disabled = true; await submitCode({ kind, key: { draft: key, id: item.id || key }, day, ed, starter: item.starter, tests: item.tests, out, scope }); sub.disabled = runnerState !== "ready"; renderHints(); };
  rst.onclick = () => { resetEditor(key, item.starter); out.innerHTML = ""; toast("Reset to the starter template."); };
  function renderHints() {
    extra.innerHTML = ""; const a = att(kind, item.id || key); if (!a.length) { extra.innerHTML = `<p class="muted">Submit at least once to unlock hints. The solution unlocks after you pass or try 4 times.</p>`; return; }
    const hk = "hint_" + key; S.hints = S.hints || {}; const shown = Math.min(S.hints[hk] || 1, item.hints.length);
    const hd = det("💡 Progressive hints", item.hints.slice(0, shown).map((h) => `<p>• ${md(h).replace(/^<p>|<\/p>\s*$/g, "")}</p>`).join(""));
    if (shown < item.hints.length) { const nb = Object.assign(document.createElement("button"), { textContent: "Show next hint" }); nb.onclick = () => { S.hints[hk] = shown + 1; save(); renderHints(); extra.querySelector("details").open = true; }; hd.querySelector(".in").appendChild(nb); }
    extra.appendChild(hd);
    if (a.some((x) => x.status === "passed") || a.length >= 4) { const sd = det("✅ Explanation and corrected solution", null), si = sd.querySelector(".in"); si.appendChild(codeBlock(item.solution)); si.insertAdjacentHTML("beforeend", md(item.explain)); extra.appendChild(sd); }
    else extra.insertAdjacentHTML("beforeend", `<p class="muted">The solution unlocks after you pass or make 4 attempts (${a.length} so far).</p>`);
    if (a.length) extra.insertAdjacentHTML("beforeend", `<p class="muted">Attempts: ${a.length} · best ${Math.round(100 * bestFrac(a))}%</p>`);
  }
  renderHints(); return wrap;
}

function tabLab(m, n, d) {
  const lab = d.lab, g = D.gen[String(n)] || {};
  m.insertAdjacentHTML("beforeend", `<h2>A. Reference example (read-only)</h2><p class="muted">Study this, then write your own solution below. Use the Copy button if you need the code.</p>`);
  m.appendChild(codeBlock(d.examples[0].code));
  m.insertAdjacentHTML("beforeend", `<div class="lbl">Expected output</div>`); m.appendChild(outBlock((g.examples && g.examples[0] && g.examples[0].stdout) || ""));
  m.appendChild(det("Line-by-line explanation (expand / collapse)", `<ol>${d.examples[0].explain.map((l) => `<li>${md(l).replace(/^<p>|<\/p>\s*$/g, "")}</li>`).join("")}</ol>`));
  m.insertAdjacentHTML("beforeend", `<hr><h2>B. My coding workspace: ${esc(lab.title)}</h2>${md(lab.prompt)}`);
  workspace(m, { key: "lab_" + n, day: n, kind: "lab", item: { ...lab, id: "lab_" + n } });
}
function tabExercises(m, n, d) {
  d.exercises.forEach((e, i) => {
    const a = att("exercise", e.id), badge = a.some((x) => x.status === "passed") ? "✅" : a.length ? "🟡" : "⬜";
    const x = det(`${badge} ${esc(e.title)}: ${esc(e.objective)}`, null, i === 0), in_ = x.querySelector(".in");
    in_.insertAdjacentHTML("beforeend", `<div class="two"><div><b>Problem</b><br>${esc(e.problem)}</div><div><b>Learning objective:</b> ${esc(e.objective)}<br><b>Input:</b> ${esc(e.inputs)}<br><b>Expected:</b> ${esc(e.expected)}<br><b>Constraints:</b> ${esc(e.constraints)}</div></div><div class="box info">Sample: ${esc(e.sample)}</div>`);
    workspace(in_, { key: "ex_" + e.id, day: n, kind: "exercise", item: e }); m.appendChild(x);
  });
}

function tabEval(m, n, d) {
  const ev = dayEval(n); const mist = S.mistakes.filter((x) => x.day === n && x.scope === "day");
  m.insertAdjacentHTML("beforeend", `<h2>Overall score: ${ev.total}/100 · ${band(ev.total)}</h2><div class="bar"><i style="width:${ev.total}%"></i></div>
   <div class="grid" style="margin-top:12px">${[["theory", "Theory"], ["lab", "Coding Lab"], ["exercises", "Exercises"], ["mcq", "MCQ quiz"]].map(([k, l]) => `<div class="card"><div class="n">${ev.pts[k]}/${WEIGHTS[k]}</div>${l}</div>`).join("")}</div>
   <p class="muted">Scores use your best attempt in each section. Completion needs: total of at least 70, exercises at least 60% passed, one Coding Lab submission and one quiz attempt.</p>`);
  const rows = [["Coding Lab", ev.labPassed ? "passed" : ev.labAttempted ? "attempted, not all tests pass" : "not submitted"], ...ev.exs.map((v, i) => [`Exercise ${i + 1}`, v ? Math.round(v * 100) + "% of tests passed" : "not attempted"])];
  m.insertAdjacentHTML("beforeend", `<table><thead><tr><th>Program</th><th>Correctness</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}</tbody></table>`);
  const strong = Object.keys(WEIGHTS).filter((k) => ev.pts[k] >= 0.85 * WEIGHTS[k]), weak = Object.keys(WEIGHTS).filter((k) => ev.pts[k] < 0.7 * WEIGHTS[k]);
  const tips = { theory: "re-read the theory and answer the self-check", lab: "redo the Coding Lab until every test passes", exercises: "repeat the exercises (use the hints)", mcq: "retake the quiz after reviewing the explanations" };
  const counts = {}; mist.forEach((x) => (counts[x.category] = (counts[x.category] || 0) + 1));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  m.insertAdjacentHTML("beforeend", `<div class="two"><div><h3>Strengths</h3>${strong.length ? "<ul>" + strong.map((k) => `<li>${k}</li>`).join("") + "</ul>" : "<p class=muted>Not enough evidence yet</p>"}</div><div><h3>Weak areas / what to do next</h3>${weak.length ? "<ul>" + weak.map((k) => `<li>${tips[k]}</li>`).join("") + "</ul>" : "<p>None. Well done.</p>"}</div></div>${top.length ? `<p><b>Repeated mistakes:</b> ${top.map(([c, k]) => `${esc(c)} ×${k}`).join(", ")}</p>` : ""}`);
  if (ev.complete) m.insertAdjacentHTML("beforeend", `<div class="box ok">✅ Day ${n} meets the completion rules. Press Save to record it. You are ready for Day ${Math.min(60, n + 1)}.</div>`);
  else { const why = []; if (ev.total < 70) why.push(`total score ${ev.total} is below 70`); if (ev.exBest < 0.6) why.push("exercises are under 60% passed"); if (!ev.labAttempted) why.push("no Coding Lab submission"); if (!ev.mcqAttempted) why.push("no quiz attempt"); m.insertAdjacentHTML("beforeend", `<div class="box warn">Not complete yet: ${why.join("; ")}. Retry any section; your best attempt counts.</div>`); }
  const b = Object.assign(document.createElement("button"), { textContent: "💾 Save this evaluation", className: "primary" });
  b.onclick = () => { const old = S.scores[n] || { total: 0, completed: false }; S.scores[n] = { total: Math.max(old.total, ev.total), completed: old.completed || ev.complete, at: old.at || (ev.complete ? nowIso() : null) }; save(); toast(`Day ${n} evaluation saved.` + (ev.complete ? " Day marked complete." : "")); render(); };
  m.appendChild(b);
}
function tabRevision(m, n, d) { m.insertAdjacentHTML("beforeend", md(d.memory) + `<p><b>Write down</b> one error you hit today and how you fixed it.</p>`); }

/* ---------- practice mode ---------- */
async function pagePractice(m, args) {
  m.insertAdjacentHTML("beforeend", `<h1>🧪 Practice Mode</h1><p class="muted">Practise any topic without changing your 60-day progress. Attempts here are stored separately.</p>`);
  const sel = document.createElement("select"); sel.setAttribute("aria-label", "Topic");
  for (let n = 1; n <= 60; n++) sel.insertAdjacentHTML("beforeend", `<option value="${n}">Day ${n}: ${esc(D.days[n].topics.slice(0, 70))}${upgraded(n) ? "" : "  (reference only)"}</option>`);
  const n = parseInt(args[0] || "1", 10); sel.value = String(n); sel.onchange = () => (location.hash = "#/practice/" + sel.value); m.appendChild(sel);
  const d = upgraded(n);
  if (!d) { m.insertAdjacentHTML("beforeend", `<div class="box info">Full practice sets are written for Days 1 to 7 so far. This topic has only its original reference lesson.</div>`); m.appendChild(codeBlock(D.days[n].code)); m.appendChild(outBlock(D.expected[String(n)] || "")); return; }
  const tab = args[1] || "ref"; const T = [["ref", "📘 Reference notes"], ["ex", "✍️ Exercises by level"], ["debug", "🐞 Debug challenge"], ["predict", "🔮 Predict the output"], ["interview", "💬 Interview questions"], ["ai", "🤖 AI review"]];
  tabs(m, "practice", T, tab, `#/practice/${n}`); const body = document.createElement("div"); m.appendChild(body);
  if (tab === "ref") tabTheory(body, n, d);
  else if (tab === "ex") {
    const lvl = parseInt(args[2] || "1", 10);
    body.insertAdjacentHTML("beforeend", `<div class="tabs">${[1, 2, 3, 4].map((l) => `<a class="${l === lvl ? "on" : ""}" href="#/practice/${n}/ex/${l}">Level ${l} · ${["Beginner", "Intermediate", "Advanced", "Professional"][l - 1]}</a>`).join("")}</div>`);
    if (lvl >= 3) { body.insertAdjacentHTML("beforeend", `<div class="box info">No level 3-4 problems exist yet for this topic. They arrive in a later phase; no filler questions are shown in their place.</div>`); return; }
    const e = lvl === 1 ? d.exercises[0] : d.exercises[d.exercises.length - 1];
    body.insertAdjacentHTML("beforeend", `<h3>${esc(e.title)}</h3><p>${esc(e.problem)}</p><p class="muted">Input: ${esc(e.inputs)} · Expected: ${esc(e.expected)} · Constraints: ${esc(e.constraints)}</p>`);
    workspace(body, { key: `practice_${n}_${lvl}`, day: n, kind: "practice", scope: "practice", item: { ...e, id: `practice_${n}_${lvl}` } });
  } else if (tab === "debug") {
    const g = (D.gen[String(n)] || {}).mistakes || [], i = parseInt(args[2] || "0", 10), sel2 = document.createElement("select");
    d.mistakes.forEach((x, k) => sel2.insertAdjacentHTML("beforeend", `<option value="${k}">${esc(x.title)}</option>`)); sel2.value = String(i); sel2.onchange = () => (location.hash = `#/practice/${n}/debug/${sel2.value}`); body.appendChild(sel2);
    const mk = d.mistakes[i], gi = g[i] || {};
    body.insertAdjacentHTML("beforeend", `<p>This program has a bug. Fix it in the editor and submit. It is checked by running your fixed version and comparing with the real output of the correct version.</p>`);
    if (gi.timeout) body.insertAdjacentHTML("beforeend", `<div class="box info">This bug is an infinite loop. Write the corrected loop.</div>`);
    const item = { id: `debug_${n}_${i}`, starter: mk.wrong + "\n", tests: [{ name: "matches the correct program's output", kind: "normal", stdin: mk.stdin || "", expected: gi.right_out || "" }], hints: ["Run it and read the result.", mk.why.slice(0, 120) + "…", "Compare with the Correct version in the Reference notes."], solution: mk.right, explain: mk.why };
    workspace(body, { key: item.id, day: n, kind: "practice", scope: "practice", item });
  } else if (tab === "predict") {
    const qs = d.mcq.filter((q) => q.run); if (!qs.length) body.insertAdjacentHTML("beforeend", `<p>No output-prediction questions for this topic.</p>`);
    qs.forEach((q, i) => { const w = document.createElement("div"); w.className = "q"; w.innerHTML = md(q.q) + `<textarea class="stdin" placeholder="Your predicted output" aria-label="Predicted output"></textarea>`; const b = Object.assign(document.createElement("button"), { textContent: "Reveal real output" }); b.setAttribute("data-needs-py", ""); const o = document.createElement("div");
      b.onclick = async () => { const guess = w.querySelector("textarea").value; if (!guess.trim()) { toast("Make a prediction first."); return; } try { const r = await runPy(q.run, q.stdin || ""); const real = (r.stdout || "").replace(/\n+$/, ""); const same = guess.split(/\s+/).join(" ").trim() === real.split(/\s+/).join(" ").trim(); S.attempts.push({ kind: "practice", key: `predict_${n}_${i}`, day: n, status: same ? "passed" : "wrong_answer", passed: +same, total: 1, code: guess, t: nowIso() }); save(); o.innerHTML = `<div class="box ${same ? "ok" : "err"}">${same ? "Correct prediction." : "Different from the real output."}</div>`; o.appendChild(outBlock(real)); } catch (e) { o.innerHTML = `<div class="box err">Not run: ${esc(e.message)}</div>`; } };
      w.append(b, o); body.appendChild(w); });
  } else if (tab === "interview") d.interview.forEach((q, i) => body.appendChild(det(`Q${i + 1}. ${esc(q.q)}`, `<p>${esc(q.a)}</p>${q.follow.map((f) => `<p>• <i>${esc(f.q)}</i> → ${esc(f.a)}</p>`).join("")}`)));
  else body.insertAdjacentHTML("beforeend", `<div class="box warn"><b>AI code review is not available in this public version.</b> It needs a language-model service that this static site does not have, so no review would be generated. You still get automated tests and the naming, spelling and formatting review after every submission.</div>`);
}

/* ---------- projects, progress, credentials, guide ---------- */
function pageProjects(m) {
  m.insertAdjacentHTML("beforeend", `<h1>🛠️ Projects & Final Capstone</h1><div class="box info">Projects 1 to 8 are listed from your syllabus. Full project workspaces (problem statement, architecture, step-by-step tasks, tests, code review and final evaluation) are not built yet. Marking a project done below is self-declared and does not count toward credentials.</div>`);
  S.projects = S.projects || {};
  D.projects.forEach((p) => { const done = S.projects[p.id]; const c = document.createElement("div"); c.className = "card"; c.style.margin = "8px 0";
    c.innerHTML = `<b>Project ${p.id}: ${esc(p.title)}</b><br><span class="muted">Days ${esc(p.days)}. ${esc(p.focus)}</span><br>`;
    const b = Object.assign(document.createElement("button"), { textContent: done ? "Self-declared done (undo)" : "Mark as done (self-declared)" }); b.onclick = () => { S.projects[p.id] = !done; save(); render(); }; c.appendChild(b); m.appendChild(c); });
  m.insertAdjacentHTML("beforeend", `<h2>🎯 Final capstone: ${esc(D.capstone.title)}</h2><ol>${D.capstone.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ol>`);
}
function pageProgress(m) {
  const done = doneDays(), a = S.attempts;
  m.insertAdjacentHTML("beforeend", `<h1>📊 Progress & Skills</h1><div class="grid"><div class="card"><div class="n">${done.length}/60</div>Days completed (evidence-based)</div><div class="card"><div class="n">${streak()}</div>Day streak 🔥</div><div class="card"><div class="n">${a.filter((x) => x.kind === "lab" || x.kind === "exercise").length}</div>Code submissions</div><div class="card"><div class="n">${S.quiz.filter((q) => q.kind === "mcq").length}</div>Quiz attempts</div></div>`);
  const rows = Object.keys(S.scores).map(Number).sort((x, y) => x - y).map((n) => `<tr><td>Day ${n}</td><td>${S.scores[n].total}</td><td>${band(S.scores[n].total)}</td><td>${S.scores[n].completed ? "✅" : "no"}</td></tr>`).join("");
  m.insertAdjacentHTML("beforeend", `<h2>Daily scores</h2>` + (rows ? `<table><thead><tr><th>Day</th><th>Best score</th><th>Band</th><th>Complete</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">No saved evaluations yet. Open a lesson, do the work, then press <b>Save this evaluation</b>.</p>`));
  const sub = a.slice(-40).reverse().map((x) => `<tr><td>${new Date(x.t).toLocaleString()}</td><td>${x.kind}</td><td>${esc(x.key)}</td><td>${x.day ?? ""}</td><td>${x.status}</td><td>${x.passed}/${x.total}</td></tr>`).join("");
  m.insertAdjacentHTML("beforeend", `<h2>Submission history</h2>` + (sub ? `<div style="overflow:auto"><table><thead><tr><th>When</th><th>Type</th><th>Item</th><th>Day</th><th>Result</th><th>Tests</th></tr></thead><tbody>${sub}</tbody></table></div>` : `<p class="muted">No submissions yet.</p>`));
  const dm = S.mistakes.filter((x) => x.scope === "day"), cnt = {}; dm.forEach((x) => (cnt[x.category] = (cnt[x.category] || 0) + 1));
  const top = Object.entries(cnt).sort((p, q) => q[1] - p[1]).slice(0, 8);
  m.insertAdjacentHTML("beforeend", `<h2>Repeated mistakes</h2>` + (top.length ? top.map(([c, k]) => `<div>${esc(c)} <span class="muted">×${k}</span><div class="bar"><i style="width:${(100 * k) / top[0][1]}%"></i></div></div>`).join("") : `<p class="muted">No mistakes recorded yet.</p>`));
  const recs = []; Object.keys(S.scores).forEach((n) => { if (S.scores[n].total < 70) recs.push(`Day ${n} (best ${S.scores[n].total}): retry the exercises and quiz.`); }); top.forEach(([c, k]) => { if (k >= 3) recs.push(`You hit <code>${esc(c)}</code> ${k} times. Re-read the matching "Common mistakes" section and redo one exercise.`); });
  m.insertAdjacentHTML("beforeend", `<h2>Personalised revision recommendation</h2>` + (recs.length ? `<ul>${recs.slice(0, 8).map((r) => `<li>${r}</li>`).join("")}</ul>` : `<p class="muted">Not enough data yet. Complete a day's work and a recommendation will appear here.</p>`));
  const pr = a.filter((x) => x.kind === "practice"); m.insertAdjacentHTML("beforeend", `<h2>Practice Mode (kept separate)</h2><p>${pr.length} practice attempts · ${pr.filter((x) => x.status === "passed").length} passed. These do not affect your 60-day progress.</p>`);
  m.insertAdjacentHTML("beforeend", `<h2>Evaluation milestones</h2><table><tbody>${D.milestones.map(([d_, t]) => `<tr><td>Day ${d_}</td><td>${esc(t)}</td><td>${done.includes(d_) ? "✅" : "upcoming"}</td></tr>`).join("")}</tbody></table>`);
  const ex = Object.assign(document.createElement("button"), { textContent: "⬇️ Export my progress (file)" }); ex.onclick = () => { const blob = new Blob([JSON.stringify(S)], { type: "application/json" }); const u = URL.createObjectURL(blob); Object.assign(document.createElement("a"), { href: u, download: "python-mastery-progress.json" }).click(); URL.revokeObjectURL(u); };
  const imp = Object.assign(document.createElement("input"), { type: "file", accept: "application/json" }); imp.setAttribute("aria-label", "Import progress file");
  imp.onchange = async () => { try { const o = JSON.parse(await imp.files[0].text()); if (!o || typeof o !== "object" || !Array.isArray(o.attempts)) throw 0; S = Object.assign(blank(), o); save(); toast("Progress imported."); render(); } catch (e) { toast("That file is not a valid progress export."); } };
  const clr = Object.assign(document.createElement("button"), { textContent: "🗑️ Erase all my data on this browser" }); clr.onclick = () => { if (confirm("This deletes all code, scores and history saved in this browser. Export first if you want a copy. Continue?")) { S = blank(); save(); render(); } };
  m.insertAdjacentHTML("beforeend", `<h2>Your data</h2><p class="muted">Everything is saved only in this browser on this device. It is not sent anywhere. Clearing browser data or switching device loses it, so use Export to keep a copy.</p>`);
  const row = document.createElement("div"); row.className = "btns"; row.append(ex, imp, clr); m.appendChild(row);
}
function pageCredentials(m) {
  const done = new Set(doneDays()); m.insertAdjacentHTML("beforeend", `<h1>🏆 Credentials</h1><p class="muted">A credential appears when every day of a stage is complete under the evidence-based rules. It is a personal progress record, not an official certification.</p>`);
  const earned = [];
  D.stages.forEach((s) => { let all = true; for (let n = s.days[0]; n <= s.days[1]; n++) if (!done.has(n)) all = false; (all ? earned : []).push(s);
    m.insertAdjacentHTML("beforeend", `<p>${s.badge} <b>${esc(s.credential)}</b>: ${all ? "earned" : `complete Days ${s.days[0]}-${s.days[1]}`}</p>`); });
  earned.forEach((s) => { const avg = Math.round(doneDays().filter((n) => n >= s.days[0] && n <= s.days[1]).reduce((a, n) => a + S.scores[n].total, 0) / (s.days[1] - s.days[0] + 1));
    const nm = esc(S.name || "Learner"); m.insertAdjacentHTML("beforeend", `<div class="cert"><div style="font-size:42px">${s.badge}</div><h2>${esc(s.credential)}</h2><p>awarded to</p><h2>${nm}</h2><p>Average daily score ${avg}/100</p></div>`); });
  if (earned.length) { const i = Object.assign(document.createElement("input"), { type: "text", placeholder: "Your name for the certificate", value: S.name || "", ariaLabel: "Your name" }); i.onchange = () => { S.name = i.value.trim().slice(0, 60); save(); render(); }; m.appendChild(i); const p = Object.assign(document.createElement("button"), { textContent: "🖨️ Print / save as PDF" }); p.onclick = () => window.print(); m.appendChild(p); }
}
function pageGuide(m) {
  m.insertAdjacentHTML("beforeend", `<h1>📋 Guide</h1><h2>Daily study structure</h2><table><thead><tr><th>Time</th><th>Activity</th><th>What you do</th></tr></thead><tbody>${D.structure.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
  <h2>How scoring works (100 points per day)</h2><p>Theory self-check <b>15</b> · Coding Lab <b>35</b> · Exercises <b>30</b> · Daily quiz <b>20</b>.<br>90-100 Excellent · 80-89 Good · 70-79 Developing, revision recommended · below 70 Additional practice required.<br>A day counts as complete only when the total is at least 70, exercises are at least 60% passed, and you have submitted the Coding Lab and taken the quiz.</p>
  <h2>Important learning rules</h2><ul>${D.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
  <h2>What this app can and cannot verify</h2><ul><li><b>Verified for real:</b> your code runs in Python inside your own browser and is graded against automated test cases. Syntax errors, runtime errors and wrong answers are reported separately.</li><li><b>Static suggestions:</b> naming, spelling, indentation and efficiency hints come from code analysis, not from running your code.</li><li><b>Not included:</b> AI code review. Programs that need files, the network or add-on libraries beyond the Python standard library will not work here.</li><li><b>Privacy:</b> your code and scores stay in this browser. Nothing is uploaded.</li></ul>
  <div class="box warn">Realistic expectation: 60 days of one-hour study builds a strong foundation and several working projects. Becoming independently proficient in production Python, ML and AI systems needs continued practice beyond these 60 days.</div>`);
}

/* ------------------------------ boot ------------------------------ */
(async function boot() {
  try { D = await (await fetch("data.json")).json(); } catch (e) { $("#main").innerHTML = `<div class="box err">Could not load the course data. If you opened this file directly from your computer, serve it from a web server instead (see README).</div>`; return; }
  $("#nav").innerHTML = ""; startWorker(); await render();
  window.addEventListener("beforeunload", save);
})();
