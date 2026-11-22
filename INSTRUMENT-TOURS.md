# Oscilloscope and VNA in one RHODA workspace

Open `instruments.html`, or choose **Instrument tours** on the RHODA home page. The instrument selector offers:

- **Oscilloscope:** the existing RTB24-reference teaching model and generated-waveform controls. Preview/approval and session behavior stay on the current RHODA local service.
- **Vector network analyzer:** the ZNLE6-reference model, 34-part guide, synthetic S-parameter bench, five guided lessons and references. This isolated VNA module needs no instrument server, AI key or cloud account.

The gallery supports keyboard tabs (Left/Right, Home/End), reload feedback, a direct full-workspace link and shareable `?instrument=scope` / `?instrument=vna` URLs. Only the selected iframe exists. Switching instruments reloads that workspace; export in-page bench notes, trace memory or captures before switching. Persisted lesson notes keep their existing browser storage.

## Implementation

`instruments.html` and `src/instrumentTours.ts` contain the shared selector. The scope is embedded from `spatial-bench.html?embedded=1`; its existing routes and spatial-station lessons remain intact. VNA source is in `modules/vna-lab/`. `npm run build` typechecks/builds the pinned VNA module before the main website build and copies its inline page to `public/learning/vna/index.html`. Install both sets of pinned dependencies as documented in [CONTRIBUTING.md](CONTRIBUTING.md).

The separate bundles preserve their renderer versions and styles. The desktop static host, launcher preflight and package checks now recognize eight app entry pages, including the gallery, and serve the VNA through the existing `learning/` allowlist.

## Verification — 22 November 2026

- Main and VNA TypeScript checks passed; the root production build includes both instrument entry points and the embedded VNA.
- All **108 VNA tests**, **108 backend tests** (including scope/transcript cases) and **10 desktop-host tests** passed. The desktop suite checks the eight-page inventory and VNA nested HTML route. Focused avatar-bootstrap, companion-animation, scope-picking and instructor-export regressions also passed.
- Browser checks against the offline desktop loopback host verified the VNA model and LAN/rear selection, the scope model and rear camera, real mock-service readback, keyboard switching and a single iframe after switching. Both viewers kept their own controls and full-workspace links.
- The clean public source copy passed its own TypeScript/build checks using the existing pinned dependency installations. Its spatial studio loaded the documented MIT male companion while skipping the excluded original, and its lesson navigation and embedded VNA worked without runtime error entries during these checks. This was not a clean-machine installation test.

These are local software/simulator checks. The combined app was not verified against physical equipment or a headset. The launcher executable must be rebuilt for a redistributed desktop package; the source/website build does not silently replace an installed executable. See [PUBLIC-RELEASE.md](PUBLIC-RELEASE.md) for public-source asset boundaries.
