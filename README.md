# RHODA RF learning lab

An educational lab companion with an oscilloscope practice bench, a shared **Instrument tours** workspace for the oscilloscope and ZNLE6 VNA, guided lessons, resources and an optional local Python service. Responses are simulated; this project does not certify hardware performance or student proficiency.

## Contributor setup

Use Node.js 24 and a supported Python 3 installation. From this folder:

```powershell
npm ci
npm --prefix modules/vna-lab ci
npm run typecheck
npm run build
npm run dev
```

Open the URL shown by Vite, then **desktop.html** for the workspace home or **instruments.html** for both instrument tours. The VNA module is bundled independently to preserve its pinned Three.js version. Its model, built-in lessons and bench run without a cloud account or API key. The oscilloscope uses the mock local service for generated waveform data.

For that service, in another terminal:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r server/requirements-mock.txt
$env:SCOPE_RESOURCE=""
$env:SCOPE_SIMULATE="1"
$env:RHODA_AI_ENABLED="0"
$env:RHODA_RAG_ENABLED="0"
.venv\Scripts\python.exe server/app.py
```

Use a disposable development session. Real instrument connections and paid AI services are outside this setup. External manuals require internet; the local document collection and learner records are deliberately not included. Configure optional services only after reading the source and their provider requirements. Never commit real keys, account files, student records, local documents or recordings.

## Source and asset provenance

This is a fresh source snapshot, without the private repository's Git history, personal resource collection or runtime data. The old Ready Player Me avatar, its animation library and preview images are excluded. The permitted MIT Rocketbox male and credited CC0 fallback remain; see **public/gltf/companion-credits.html**, **rocketbox-LICENSE.txt** and the credit JSON files. Do not re-add excluded assets without the necessary redistribution permission.

The VNA teaching geometry and explanations are original, photo-referenced educational work. Manufacturer marks identify the referenced lab/instruments and do not indicate endorsement. Source references and dependency notices remain under **modules/vna-lab/**.

No blanket licence for all project code or artwork is asserted by making this repository public. Each third-party component retains its own terms. The project owner can invite collaborators through the repository's Settings → Collaborators page; sending a repository URL alone does not grant write access. Forks and pull requests are another review workflow.

Read **PUBLIC-RELEASE.md** and **PUBLIC-SOURCE-MANIFEST.json** for the export scope and remaining verification boundaries.
