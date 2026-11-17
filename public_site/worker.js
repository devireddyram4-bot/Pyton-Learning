/* Runs Python (Pyodide) off the main thread so a stuck program can be stopped by terminating this worker. */
importScripts("vendor/pyodide/pyodide.js");
let api = null;
(async () => {
  const py = await loadPyodide({ indexURL: new URL("vendor/pyodide/", self.location.href).href });
  py.FS.mkdirTree("/home/pyodide");
  for (const f of ["runner_web.py", "review.py"]) {
    const r = await fetch("py/" + f);
    if (!r.ok) throw new Error("could not load " + f);
    py.FS.writeFile("/home/pyodide/" + f, await r.text());
  }
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide'); import runner_web");
  api = py.runPython("runner_web.api");
  postMessage({ ready: true });
})().catch((e) => postMessage({ fatal: String((e && e.message) || e) }));
onmessage = (e) => {
  const { id, type, payload } = e.data;
  try { postMessage({ id, result: JSON.parse(api(type, JSON.stringify(payload))) }); }
  catch (err) { postMessage({ id, error: String((err && err.message) || err) }); }
};
