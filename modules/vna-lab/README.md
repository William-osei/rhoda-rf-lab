# ZNLE6 learning module in RHODA

This is the editable source of the VNA Student Lab, integrated into RHODA's **Instrument tours** workspace alongside its RTB oscilloscope. It originated in the standalone RF Student Mini Project; the original folder remains preserved locally.

The VNA's original geometry, 34-part guide, five guided lessons and synthetic practice bench are included. Manufacturer specifications and teaching references are in [REFERENCES.md](REFERENCES.md). This is independent educational software, not manufacturer firmware/CAD or a certified instrument.

## Build and test

From the RHODA repository root:

```sh
npm ci
npm --prefix modules/vna-lab ci
npm --prefix modules/vna-lab test
npm run build
```

`scripts/build-vna.mjs` typechecks and builds this module before the main build, then copies its self-contained HTML and notices into `public/learning/vna/`. The generated page is included in both the website and local desktop host. Do not edit the generated HTML; edit this module and rebuild.

The module deliberately retains its pinned Three.js 0.187 dependency separately from RHODA's existing super-three dependency. Its styles and renderer run inside one selected iframe, avoiding global CSS or renderer-version conflicts. No CDN, paid AI or network request is needed for the VNA's generated model/bench/lessons. External manual links need internet. Source power/IF settings do not model real noise, acquisition timing or compression.

`?page=instrument&embedded=1` starts at the instrument tour with compact VNA navigation. Startup pages are allowlisted. The parent app replaces the iframe when changing instrument so two hidden WebGL models do not run together.

The source icon is the existing user-supplied R&S-style RHODA artwork. Three.js/Vite notices remain in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) and the generated page. No lab photographs, serial labels or proprietary manuals are bundled. There is no manufacturer endorsement.

## Limits

VNA traces are synthetic. Port 1 SOL corrects S11 only; THRU is a relative reference rather than a full two-port calibration. VNA lesson progress is local browser storage and is separate from the oscilloscope service/session journal. Bench notes and frozen traces stay in page memory until exported. The combined app does not connect a physical VNA.
