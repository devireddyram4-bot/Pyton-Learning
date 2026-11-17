# 60-Day Python Mastery (public, in-browser version)

A static website. Python runs inside each learner's own browser (Pyodide), so there is no server, no login and no database.
Progress and code are saved in the learner's browser only (localStorage). Nothing is uploaded.

## Publish with GitHub Pages
1. Create a new public repository on github.com (for example `python-mastery`).
2. Upload everything in this folder to the repository root (keep `.nojekyll`).
3. Repository Settings, Pages, Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
4. After a minute the site is at `https://<your-username>.github.io/python-mastery/`.

Any static host works the same way (Netlify, Cloudflare Pages, Vercel): upload the folder, no build step.

## Run locally
    python3 -m http.server 8000
then open http://localhost:8000 . (Opening index.html by double-click will not work: browsers block the Python worker on file:// pages.)

## What it includes
Days 1-7 fully built (detailed theory, reference + practice editors, graded exercises, 8-question quizzes, daily 100-point scoring).
Days 8-60 show the original short lesson and are marked "upgrade pending". Practice Mode levels 3-4 and project workspaces are not built yet.

## Limits
- First visit downloads about 13 MB (the Python engine). Later visits use the browser cache.
- Only the Python standard library is available. Programs that need files, the network, pandas or other packages will not run.
- No AI code review (it needs a language-model service this static site does not have).
- Progress lives in one browser on one device. The Progress page has Export and Import to move it.
- Credentials are a personal progress record, not an official certification.

## Third-party components (all bundled in /vendor)
Pyodide 0.27.7 (MPL-2.0), CodeMirror 5.65.16 (MIT), marked 12.0.2 (MIT).
