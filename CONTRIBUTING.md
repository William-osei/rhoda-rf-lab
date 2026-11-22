# Contributing to RHODA

The lab currently combines an oscilloscope teaching bench and a ZNLE6 VNA student lab. Both generate synthetic signals. Begin with [Instrument tours](INSTRUMENT-TOURS.md) and the module's [source guide](modules/vna-lab/README.md).

## Set up the frontend

Use Node.js 24 and npm. From the repository root:

```powershell
npm ci
npm --prefix modules/vna-lab ci
npm run typecheck
npm --prefix modules/vna-lab test
npm run build
npm run dev
```

Open `desktop.html` for the home screen or `instruments.html` for the combined tours. Vite prints its local address. The VNA runs without the Python service. The oscilloscope needs that service for simulator readback.

## Start the optional mock service

Use Python 3.12 or 3.13 in a separate terminal:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r server/requirements-mock.txt
$env:SCOPE_RESOURCE=""
$env:SCOPE_SIMULATE="1"
$env:RHODA_AI_ENABLED="0"
$env:RHODA_RAG_ENABLED="0"
.venv\Scripts\python.exe server/app.py
```

No API key, paid AI or physical equipment is needed for this workflow. A local document collection and real learner/session data are not included in the public source. Never commit your `.env.local`, credentials, recordings or student records. Use synthetic fixtures for tests.

## Submit a change

Create a feature branch, keep the change focused and open a pull request with the behavior changed and checks run. For VNA changes edit `modules/vna-lab/src/`, not the generated `public/learning/vna/index.html`. Run the module tests and root build; the build regenerates its embedded page.

For scope/server changes, test the generated waveform and approval workflow. Simulator checks do not establish hardware safety, accuracy or headset operation. Do not connect equipment as part of an automated test.

Public source excludes the old Ready Player Me avatar and animation library. Preserve the permitted companion notices and source attribution; see [PUBLIC-RELEASE.md](PUBLIC-RELEASE.md). Do not reintroduce excluded assets without appropriate redistribution permission. Making source public does not apply a blanket licence to third-party assets or manufacturer branding.

Repository URLs allow reading and, on public GitHub repositories, forking. To push directly, the owner must invite your exact GitHub username through **Settings → Collaborators**. Do not share account credentials. Contributors without write access can submit pull requests from a fork.
