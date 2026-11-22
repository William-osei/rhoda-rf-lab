# Sources, attribution and teaching scope

Source review: 7 November 2026. The application text is original teaching material, not copied manual chapters. Manufacturer documents are linked at their official locations; no full manuals, software screenshots, manufacturer models or restricted assets are redistributed.

The user's four lab photographs inform the visual arrangement: blue side handles, left system keys, central display, upper-right function keys, numeric keypad/knob, front RF ports, and the photographed rear interfaces. The model is an approximate teaching reconstruction. It is not a dimensionally certified CAD model or a complete emulator of the instrument firmware. Photographs alone do not establish the installed options or firmware on that lab unit.

## Instrument facts checked

The standard ZNLE6 covers **1 MHz to 6 GHz**, with **two 50 Ω N-female test ports**. The optional B100 low-frequency extension is excluded from this prototype. The specified display is a 10.1-inch 1280 × 800 touchscreen. Front USB is 2.0; rear USB is 3.0. LAN, external reference and trigger connections are documented. The reference frequency is 10 MHz. GPIB is optional; a complete rear panel and exact installed options cannot be inferred from the supplied crop.

The specified source range is −10 dBm to 0 dBm (higher typical output is not a guaranteed range). Damage ratings are **not** recommended operating levels. Before real equipment use, follow the matching instrument, DUT, connector and calibration-kit instructions with the lab assistant.

The shared ZNL/ZNLE manual contains functions specific to other models. The ZNLE guide states that blue secondary function-key labels do not apply to the ZNLE. Do not infer a spectrum-analyzer mode from the photographed shared front-panel labels.

## Primary references

1. **Rohde & Schwarz, ZNLE Specifications**, version 07.00, September 2025, document 5215.1882.22. Model range and ports: p. 4; source/receiver ratings: p. 11; display and interfaces: p. 12. [Official PDF](https://scdn.rohde-schwarz.com/ur/pws/dl_downloads/pdm/cl_brochures_and_datasheets/specifications/5215_1882_22/ZNLE_specs_en_5215-1882-22_v0700.pdf).
2. **Rohde & Schwarz, ZNLE Getting Started**, version 17, firmware 1.80 and higher, 29 July 2026, document 1323.2873.02. Instrument tour: pp. 29–39; measurement examples: pp. 40–51; operation: pp. 56–68. [Official landing page](https://www.rohde-schwarz.com/us/manual/rs-znle-getting-started_78701-454144.html), [official PDF](https://scdn.rohde-schwarz.com/ur/pws/dl_downloads/pdm/cl_manuals/getting_started/1323_2873_01/ZNLE_GettingStarted_en_17.pdf).
3. **Rohde & Schwarz, ZNL/ZNLE User Manual**, version 23, firmware 1.80, July 2026. Detailed VNA controls and model-dependent calibration procedures. [Official manual page](https://www.rohde-schwarz.com/us/manual/rs-znl-znle-user-manual_78701-481538.html).
4. **Paul Denisowski, Rohde & Schwarz R&S Essentials, Understanding S-parameters.** Reflection/transmission and wave-ratio notation. [Official article](https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/spectrum-analyzers/understanding-s-parameters_257831.html).
5. **Paul Denisowski, Rohde & Schwarz R&S Essentials, VNA calibration methods and standards.** Reference planes, standard roles, response normalization and full calibration distinctions. [Official article](https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/spectrum-analyzers/vna-calibration-methods-and-standards_258187.html).
6. **Paul Denisowski, Rohde & Schwarz R&S Essentials, Voltage standing wave ratio (VSWR) and return loss.** Mismatch interpretation and the direction of return-loss/VSWR improvement. [Official article](https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/spectrum-analyzers/voltage-standing-wave-ratio-vswr-and-return-loss_258140.html).
7. **Paul Denisowski, Rohde & Schwarz R&S Essentials, Understanding the Smith chart.** Normalized impedance, matched centre and reflection interpretation. [Official article](https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/spectrum-analyzers/understanding-the-smith-chart_257989.html).
8. **Paul Denisowski, Rohde & Schwarz R&S Essentials, How to measure cable loss.** Transmission versus reflected round-trip measurement and the importance of the reference plane. [Official article](https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/spectrum-analyzers/how-to-measure-cable-loss_258130.html).

## Prototype boundary

- Simulated DUTs are analytic teaching examples, not supplied calibration data, measurements of the photographed instrument, or an RF design verification service.
- The Port 1 S11 exercise solves the explicitly implemented directivity, reflection-tracking and source-match model using ideal open/short/load captures. It does not correct S22 and is not full TOSM/SOLT or a twelve-term two-port calibration. Transmission responses are analytic and are unaffected by this reflection correction. A separately implemented through-reference normalization divides transmission by a captured reference on the same sweep grid; it is a relative response comparison, not an absolute hardware-fixture or full two-port correction.
- Calibration standards in a physical kit are not ideal open/short/load equations. Their definitions, connector types, offsets, parasitics and uncertainty matter.
- Ideal networks do not establish real noise, drift, dynamic range, power compression, cable repeatability or measurement uncertainty. A dense trace does not create independent accuracy.
- Built-in explanations and exercises work offline. Opening any external resource requires internet and may be subject to the publisher's access requirements.
- The project is independent. Product names identify the teaching reference; they do not imply Rohde & Schwarz sponsorship, certification or endorsement.

## Guided learning studio

The lesson illustrations, staged explanations and multiple-choice feedback are original educational material. The drawings are conceptual schematics, not captured instrument traces. Each practice check reads the current in-app simulator state; it does not infer that the student performed every preceding action or demonstrated physical laboratory competence. Missing action history remains unverified.

Review marks, answer choices and bounded step notes are kept in the current browser when storage is available, with explicit local export and reset controls. They are a student learning record, not grades. The optional read-aloud control offers only English voices that the browser reports as local. Browser and operating-system support vary; this is not a guarantee that a voice works offline. No external AI or voice-download service is requested by the app.

## Submission mapping

The first section of **Demonstration of VNA.md** asks for four deliverables: a student-facing ZNLE6 prototype, guided setup/calibration/measurement tutorials, a lightweight offline simulation, and a clear resource page. The lesson sequence and references serve these four requirements. Later RHODA integration, expanded modules and VR testing remain future scope.
## Refinement notes

The enclosure proportions were cross-checked against the nominal 408 × 186 × 235 mm dimensions in the [official ZNLE specifications, version 06.00, page 13](https://scdn.rohde-schwarz.com/ur/pws/dl_downloads/pdm/cl_brochures_and_datasheets/specifications/5215_1882_22/ZNLE_specs_en_5215-1882-22_v0600.pdf). The procedural model remains an educational approximation, not certified CAD. Its studio environment and reflections are generated locally with Three.js; no external HDR image or model is included.

`src/assets/rs-lab-icon.png` is the unchanged user-supplied icon reused from the RHODA project's `public/assets/rhoda-rs-icon.png`, as requested. It identifies the lab presentation; ownership of names/marks and the independent-project notice remain unchanged.
