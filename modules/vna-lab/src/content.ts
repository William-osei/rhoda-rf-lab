/** Original teaching content. Sources and scope are documented in REFERENCES.md. */
export type LessonStep = {
  title: string;
  body: string;
  action: string;
  expected: string;
  checkpoint: string;
  focus?: string;
};

export type Lesson = {
  id: string;
  title: string;
  subtitle: string;
  duration: string;
  steps: LessonStep[];
};

export type LessonQuiz = {
  question: string;
  options: readonly string[];
  correctIndex: number;
  explanation: string;
};

/** Original low-stakes checks. These prompts check an explanation, not practical competence. */
export const lessonQuizzes: Record<string, LessonQuiz> = {
  'getting-started:0': {
    question: 'For S21 with Port 1 driven, where is the transmitted wave observed?',
    options: ['At Port 2', 'Only at Port 1', 'At the LAN connector'],
    correctIndex: 0,
    explanation:
      'The second index identifies the incident port; the first identifies the outgoing-wave port. S21 is the wave leaving Port 2 divided by the incident wave at Port 1.',
  },
  'getting-started:1': {
    question: 'What does increasing the number of points across a fixed linear span do?',
    options: [
      'Automatically removes calibration error',
      'Makes adjacent frequency samples closer together',
      'Increases the DUT’s bandwidth',
    ],
    correctIndex: 1,
    explanation:
      'For N points, the spacing is span ÷ (N − 1). More samples can resolve a feature more finely; they do not change the physical network or independently establish accuracy.',
  },
  'getting-started:2': {
    question: 'Which parameter describes reflection at the input when Port 1 is driven?',
    options: ['S21', 'S12', 'S11'],
    correctIndex: 2,
    explanation:
      'S11 compares the reflected wave leaving Port 1 with its incident wave. A smaller passive reflection magnitude generally indicates a better match at that reference plane.',
  },
  'getting-started:3': {
    question: 'What must accompany a marker value in a useful lab note?',
    options: [
      'Frequency, parameter, format and units',
      'Just its colour',
      'Only the instrument’s model name',
    ],
    correctIndex: 0,
    explanation:
      'A value such as −10 has little meaning by itself. Record the frequency and whether you are reading S21 magnitude in dB, phase in degrees, or another quantity.',
  },
  'reflection-calibration:0': {
    question: 'Where should the calibration standards be connected?',
    options: [
      'Anywhere convenient before the test cable',
      'At the defined DUT reference plane',
      'To the reference-clock input',
    ],
    correctIndex: 1,
    explanation:
      'The standards characterize the setup up to the plane where the DUT will connect. Adding an unaccounted adapter after that plane changes the measurement setup.',
  },
  'reflection-calibration:1': {
    question: 'How do ideal open and short responses differ?',
    options: [
      'Open has no reflection',
      'Short has no reflection',
      'Their reflection phases differ by 180°',
    ],
    correctIndex: 2,
    explanation:
      'Both ideal standards have |Γ| = 1. An open has Γ = +1; a short has Γ = −1. A matched load has Γ = 0.',
  },
  'reflection-calibration:2': {
    question: 'Which response does this prototype’s SOL routine correct?',
    options: ['Port 1 S11 only', 'All four S-parameters', 'Every connected real instrument'],
    correctIndex: 0,
    explanation:
      'The implemented three-term correction belongs to Port 1 S11. It does not transfer to S22 or implement a full two-port SOLT calibration.',
  },
  'reflection-calibration:3': {
    question: 'What happens when this app’s sweep range changes?',
    options: [
      'Previous captures automatically cover every new frequency',
      'The captured calibration is cleared',
      'The reference impedance changes to 75 Ω',
    ],
    correctIndex: 1,
    explanation:
      'The simulated standards are tied to an exact frequency grid. This app requires new captures after a grid change rather than silently interpolating them.',
  },
  'transmission-normalization:0': {
    question: 'Does a through response alone determine every reflection error?',
    options: [
      'Yes, because it joins two ports',
      'Yes, whenever it looks flat',
      'No; a through comparison is not a full two-port calibration',
    ],
    correctIndex: 2,
    explanation:
      'A through provides a transmission reference. It does not by itself solve all reflection, source-match and load-match errors.',
  },
  'transmission-normalization:1': {
    question: 'What is the complex ratio of a valid response divided by itself?',
    options: ['1 + j0, or 0 dB and 0°', 'Zero amplitude', 'An infinite power gain'],
    correctIndex: 0,
    explanation:
      'For a nonzero reference, T ÷ T = 1. This is a relative comparison. Reflection remains unchanged, and a different lossy reference can produce a ratio above 0 dB without physical gain.',
  },
  'transmission-normalization:2': {
    question: 'An S21 magnitude of −6 dB is approximately what voltage-wave ratio?',
    options: ['0.25', '0.50', '2.00'],
    correctIndex: 1,
    explanation:
      'Wave magnitude uses 20 log10(|S21|), so 10^(−6/20) ≈ 0.501. With equal reference impedances, the corresponding power ratio is approximately 0.251.',
  },
  'transmission-normalization:3': {
    question: 'Which limitation remains after a response-only through comparison?',
    options: [
      'No frequency can be displayed',
      'Phase can never be plotted',
      'It does not solve the full source/load mismatch error system',
    ],
    correctIndex: 2,
    explanation:
      'Response normalization compares transmission paths. Real full two-port error correction needs a more complete set of standards, measurements and models.',
  },
  'filter-investigation:0': {
    question: 'Where is a band-pass filter’s passband?',
    options: [
      'In the frequency region with stronger transmission',
      'Always below the first plotted frequency',
      'Where S21 is most attenuated',
    ],
    correctIndex: 0,
    explanation:
      'A band-pass response transmits a middle range more strongly than the surrounding stopbands. The exact definition of the band edges must be stated.',
  },
  'filter-investigation:1': {
    question: 'Why can a sampled peak differ from the exact analytic peak?',
    options: [
      'Markers modify the DUT',
      'The peak may lie between sampled frequencies',
      'A sweep cannot contain more than one point',
    ],
    correctIndex: 1,
    explanation:
      'Peak search compares the available samples. A narrow feature can fall between them. Narrowing the span or increasing point density improves the sampled estimate.',
  },
  'filter-investigation:2': {
    question: 'If the measured peak is −2 dB, where are its relative 3 dB edges?',
    options: ['At +1 dB', 'Always at −3 dB', 'At −5 dB'],
    correctIndex: 2,
    explanation:
      'A relative threshold is measured from the actual peak: −2 dB − 3 dB = −5 dB. Both crossing frequencies must be inside the sweep to estimate the full bandwidth.',
  },
  'filter-investigation:3': {
    question: 'Does low S21 necessarily mean all rejected energy became heat?',
    options: [
      'No; some energy may be reflected',
      'Yes, for every passive filter',
      'Yes, whenever the trace is yellow',
    ],
    correctIndex: 0,
    explanation:
      'A low transmission value can involve reflection as well as dissipation. Compare reflection and transmission, and account for the model and reference impedances.',
  },
  'evidence-report:0': {
    question: 'Which setup note best supports a reproducible result?',
    options: [
      '“The graph looked good.”',
      'DUT, sweep, parameter, format, correction and reference impedance',
      'Just the screen colour',
    ],
    correctIndex: 1,
    explanation:
      'The observation needs enough context for another student to recreate the scenario. Keep simulated settings and physical measurements clearly identified.',
  },
  'evidence-report:1': {
    question: 'How should exported data from this app be described?',
    options: [
      'Certified hardware calibration data',
      'Manufacturer acceptance results',
      'Simulated data with settings and reference information',
    ],
    correctIndex: 2,
    explanation:
      'The exports preserve a mathematical teaching response. They are useful for checking and plotting, but do not establish the performance of a physical VNA or DUT.',
  },
  'evidence-report:2': {
    question: 'Which conclusion is supported by this exercise?',
    options: [
      '“This analytic model showed the expected trend; hardware validation remains a separate task.”',
      '“The real ZNLE6 has been certified.”',
      '“Completing the lesson proves independent lab competence.”',
    ],
    correctIndex: 0,
    explanation:
      'Describe what the model actually showed, give evidence and state a limitation. A real laboratory result requires the appropriate equipment, setup, procedures and supervision.',
  },
};

export const lessons: Lesson[] = [
  {
    id: 'getting-started',
    title: 'Your first VNA measurement',
    subtitle: 'Follow a signal from the source to the device and back.',
    duration: '6 min',
    steps: [
      {
        title: 'Find the two test ports',
        body: 'A VNA sends a known signal into a device under test (DUT) and compares the returning and transmitted waves. This bench generates those responses mathematically.',
        action:
          'Inspect Port 1 and Port 2 on the instrument model. Select the through-cable example.',
        expected: 'The cable links the two simulated ports. No physical instrument is connected.',
        checkpoint: 'Which port receives the forward-transmitted signal when Port 1 is the source?',
        focus: 'port1',
      },
      {
        title: 'Choose a useful frequency window',
        body: 'A sweep samples the DUT at many frequencies. A broad window helps you find features; a narrower window helps you inspect them.',
        action: 'Set a start of 100 MHz and a stop of 3 GHz, using 401 points. Apply the sweep.',
        expected:
          'The horizontal axis covers the selected interval. More points improve sampling density, not the underlying model accuracy.',
        checkpoint:
          'What happens to the spacing between points if you keep the span and double the point count?',
        focus: 'frequency',
      },
      {
        title: 'Compare reflection with transmission',
        body: 'S21 describes forward transmission. S11 describes input reflection. Both are complex ratios: magnitude and phase tell different parts of the story.',
        action: 'Display S21 in dB magnitude, then switch to S11. Return to S21 and try phase.',
        expected:
          'A well-matched cable transmits strongly and reflects weakly. Its phase changes with frequency because propagation takes time.',
        checkpoint: 'Why does a low S11 magnitude usually indicate a better input match?',
        focus: 'measurement',
      },
      {
        title: 'Make a marker observation',
        body: 'A marker reads one sampled position on the trace. A useful observation always identifies the frequency, selected S-parameter and display format.',
        action:
          'Place the marker within the sweep. Change its frequency and record the displayed result.',
        expected:
          'The marker moves along the selected response. The result is labelled as simulated data.',
        checkpoint:
          'Could a single marker describe the behaviour of a filter across its entire passband?',
        focus: 'marker',
      },
    ],
  },
  {
    id: 'reflection-calibration',
    title: 'Calibrate a reflection measurement',
    subtitle: 'Use open, short and match to define a reference plane.',
    duration: '7 min',
    steps: [
      {
        title: 'Decide where the measurement begins',
        body: 'The reference plane is the connection where the DUT response is defined. Real standards must match the connector, gender and calibration-kit definition.',
        action:
          'Open the calibration panel and choose the Port 1 S11 teaching routine. Keep the sweep settings fixed.',
        expected: 'The routine asks for known standards at the same simulated reference plane.',
        checkpoint:
          'If you add an adapter after calibrating, is the DUT still at the same reference plane?',
        focus: 'calibration',
      },
      {
        title: 'Measure the known standards',
        body: 'For ideal standards, an open has Γ = +1, a short has Γ = −1 and a matched load has Γ = 0. Real kits include non-ideal standard models.',
        action: 'Capture the simulated Open, Short and Load standards in the calibration panel.',
        expected: 'Each required capture is recorded. A complete set enables the correction.',
        checkpoint:
          'Open and short both reflect completely. Which property distinguishes their ideal responses?',
        focus: 'calibration',
      },
      {
        title: 'Apply and verify the correction',
        body: 'The teaching model solves its disclosed Port 1 S11 reflection error from the three standards. It does not correct S22 or emulate the manufacturer’s complete uncertainty system.',
        action:
          'After the third capture, correction turns on automatically. Keep the Load selected and inspect S11; there is no separate Apply button.',
        expected:
          'The corrected load approaches the model’s ideal match. A finite display floor may replace negative infinity in a dB plot.',
        checkpoint:
          'Why is remeasuring a standard a useful check but not an independent proof of accuracy?',
        focus: 'format',
      },
      {
        title: 'Recognise calibration limits',
        body: 'Real measurements can change with connector repeatability, cable movement, temperature and setup changes. A successful simulated correction cannot establish real-instrument accuracy.',
        action:
          'While correction is active, change the frequency range and run a new sweep. Inspect the calibration status before continuing.',
        expected:
          'Use the app’s status to see whether a new capture is required. Do not silently assume an earlier calibration covers a new setup.',
        checkpoint:
          'Before a real lab session, which kit definition and reference plane would you record?',
        focus: 'calibration',
      },
    ],
  },
  {
    id: 'transmission-normalization',
    title: 'Compare a through reference',
    subtitle: 'Normalize a transmission response, then explain its limits.',
    duration: '5 min',
    steps: [
      {
        title: 'Start with a direct path',
        body: 'A through response can provide a comparison reference. This prototype divides transmission by a captured analytic cable response; it does not reproduce the ZNLE’s full calibration firmware.',
        action:
          'Select Through cable and S21 in Log magnitude. Keep the sweep fixed and inspect Phase or Group delay if useful.',
        expected:
          'Before normalization, the cable has modest loss and about 2 ns delay. One-port SOL does not correct its transmission.',
        checkpoint:
          'Does a through measurement alone determine all reflection errors at both ports?',
        focus: 'calibration',
      },
      {
        title: 'Capture the through reference',
        body: 'A relative response is the measured complex transmission divided by the captured reference on the same frequency grid. Reflection remains unchanged.',
        action:
          'In Calibration, capture the THRU reference and enable normalization. Keep Through cable selected.',
        expected:
          'The cable compared with itself gives approximately 0 dB and 0° transmission. The status identifies a relative response, not absolute gain.',
        checkpoint: 'What does 0 dB transmission mean as an amplitude ratio?',
        focus: 'format',
      },
      {
        title: 'Measure a known attenuator',
        body: 'An attenuator provides a useful sanity check. In a passive matched model, negative S21 dB indicates insertion loss rather than gain.',
        action:
          'Clear the THRU reference, then select the 10 dB attenuator. Read S21 at a marker frequency.',
        expected:
          'With the reference cleared, the analytic magnitude is −10 dB. With a lossy reference active, the ratio would differ; it is relative to that reference.',
        checkpoint:
          'If S21 is −6 dB, is the transmitted voltage-wave amplitude about one half or one quarter?',
        focus: 'measurement',
      },
      {
        title: 'Choose the right real calibration',
        body: 'A complete real two-port calibration uses more standards and measurements than a single through. The correct choice depends on the DUT, fixture and accuracy requirement.',
        action:
          'Read the calibration resource and list one error that transmission normalization does not remove. Identify which correction this app actually implements.',
        expected:
          'Your note distinguishes response normalization from the full instrument procedure.',
        checkpoint: 'When would the limitations of a response-only correction become important?',
        focus: 'calibration',
      },
    ],
  },
  {
    id: 'filter-investigation',
    title: 'Investigate a filter',
    subtitle: 'Find a passband, use markers and explain the shape.',
    duration: '8 min',
    steps: [
      {
        title: 'Look across a wide span',
        body: 'A band-pass filter transmits a range of frequencies and attenuates others. Begin with enough span to see both sides of the response.',
        action:
          'Select the 2.4 GHz band-pass preset, display S21 in dB magnitude and sweep 100 MHz to 3 GHz.',
        expected:
          'A transmission peak separates two more-attenuated regions. The preset’s analytic parameters determine its shape.',
        checkpoint: 'Which parts of the response would you call passband and stopband?',
        focus: 'trace',
      },
      {
        title: 'Locate the transmission peak',
        body: 'Peak search finds the largest value among sampled points. A coarsely sampled sweep can miss the exact maximum between samples.',
        action:
          'Use marker maximum search, then narrow the span around the peak and compare point counts.',
        expected:
          'The marker identifies the sampled peak and its magnitude. Narrowing the span resolves more local detail.',
        checkpoint: 'Why should you report the sweep spacing with a narrow resonance?',
        focus: 'marker-search',
      },
      {
        title: 'Measure relative bandwidth',
        body: 'For this exercise, define the band edges at 3 dB below the measured peak. This is a relative level, not automatically an absolute −3 dB threshold.',
        action:
          'Find frequencies on either side where S21 is about 3 dB below the peak. Subtract the lower frequency from the upper frequency.',
        expected:
          'Your note gives the two edge estimates, bandwidth and peak reference used. An edge outside the sweep is unresolved.',
        checkpoint: 'If the peak is −2 dB, which dB level defines its relative 3 dB edges?',
        focus: 'marker',
      },
      {
        title: 'Add the reflection story',
        body: 'Transmission alone does not identify whether energy was reflected or absorbed. Compare S11 and S21 rather than assuming every low transmission value means dissipation.',
        action:
          'Inspect S11 in dB and Smith formats, then compare phase or group delay where transmission is meaningful.',
        expected:
          'The formats offer complementary views of the same complex response. Phase-derived quantities are unreliable near vanishing signal.',
        checkpoint:
          'Why can a passive reflective filter have low S21 without converting all rejected power into heat?',
        focus: 'format',
      },
    ],
  },
  {
    id: 'evidence-report',
    title: 'Build a reproducible lab note',
    subtitle: 'Turn a trace into an observation someone else can repeat.',
    duration: '4 min',
    steps: [
      {
        title: 'Record the conditions',
        body: 'A trace without its setup is difficult to interpret. A short report should state the DUT, reference impedance, frequency window, sampling and correction status.',
        action:
          'Choose a DUT and record the sweep settings, selected S-parameter, display format and calibration status.',
        expected: 'Another student can recreate the same idealized scenario from your description.',
        checkpoint:
          'Have you distinguished simulation settings from observations made on physical hardware?',
        focus: 'sweep',
      },
      {
        title: 'Export evidence',
        body: 'Numerical data permits later plotting and checking. A screenshot is useful for context, while an exported trace preserves the sampled values.',
        action:
          'Export the available measurement data and save a screen image or browser printout with your notes.',
        expected:
          'The exported evidence identifies itself as simulated and includes the chosen response and frequencies.',
        checkpoint:
          'Would a classmate know the units and reference impedance from your exported material?',
        focus: 'trace',
      },
      {
        title: 'State what the result supports',
        body: 'Explain one observation, one plausible reason and one limitation. Repeating a simulation is valuable practice, but does not validate a real instrument or prove independent lab competence.',
        action: 'Write a three-sentence conclusion and cite one relevant manufacturer resource.',
        expected:
          'Your conclusion refers to the actual trace and avoids claiming more than the model can demonstrate.',
        checkpoint:
          'What would you check with a lab assistant before transferring this exercise to the ZNLE6?',
        focus: 'screen',
      },
    ],
  },
];

export const resources = [
  {
    title: 'ZNLE: getting started',
    url: 'https://www.rohde-schwarz.com/us/manual/rs-znle-getting-started_78701-454144.html',
    source: 'Rohde & Schwarz · Getting Started v17',
    description:
      'The model-specific starting point for preparation, panel identification and introductory measurements. Use it beside the actual instrument in a supervised lab.',
    topic: 'Instrument',
    kind: 'Manual',
  },
  {
    title: 'ZNL/ZNLE: full user manual',
    url: 'https://www.rohde-schwarz.com/us/manual/rs-znl-znle-user-manual_78701-481538.html',
    source: 'Rohde & Schwarz · User Manual v23',
    description:
      'Look up detailed VNA menus, calibration types and reference procedures. Shared documentation includes ZNL-only functions; check model applicability.',
    topic: 'Instrument',
    kind: 'Manual',
  },
  {
    title: 'ZNLE specifications',
    url: 'https://scdn.rohde-schwarz.com/ur/pws/dl_downloads/pdm/cl_brochures_and_datasheets/specifications/5215_1882_22/ZNLE_specs_en_5215-1882-22_v0700.pdf',
    source: 'Rohde & Schwarz · Specifications v07.00',
    description:
      'Confirm frequency coverage, port characteristics, operating conditions and interfaces. Published instrument performance is not simulated by this learning tool.',
    topic: 'Instrument',
    kind: 'PDF',
  },
  {
    title: 'Understand S-parameters',
    url: 'https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/spectrum-analyzers/understanding-s-parameters_257831.html',
    source: 'Rohde & Schwarz · R&S Essentials',
    description:
      'Connect each subscript to a wave travelling between ports. Read before comparing reflection, forward transmission and reverse transmission.',
    topic: 'Fundamentals',
    kind: 'Explainer',
  },
  {
    title: 'Calibration methods and standards',
    url: 'https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/spectrum-analyzers/vna-calibration-methods-and-standards_258187.html',
    source: 'Rohde & Schwarz · R&S Essentials',
    description:
      'Compare the roles of open, short, match and through. Distinguish simple response normalization from a complete two-port calibration.',
    topic: 'Calibration',
    kind: 'Explainer',
  },
  {
    title: 'VSWR and return loss',
    url: 'https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/spectrum-analyzers/voltage-standing-wave-ratio-vswr-and-return-loss_258140.html',
    source: 'Rohde & Schwarz · R&S Essentials',
    description:
      'Relate impedance mismatch to reflected power. Practise the sign difference between negative S11 dB magnitude and positive return loss.',
    topic: 'Interpretation',
    kind: 'Explainer',
  },
  {
    title: 'Read a Smith chart',
    url: 'https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/spectrum-analyzers/understanding-the-smith-chart_257989.html',
    source: 'Rohde & Schwarz · R&S Essentials',
    description:
      'Learn the matched centre, open and short positions, then explore how a complex reflection coefficient maps to normalized impedance.',
    topic: 'Interpretation',
    kind: 'Explainer',
  },
  {
    title: 'Measure cable loss',
    url: 'https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/spectrum-analyzers/how-to-measure-cable-loss_258130.html',
    source: 'Rohde & Schwarz · R&S Essentials',
    description:
      'Compare a two-port transmission measurement with a reflected round trip. Identify the measurement plane before interpreting attenuation.',
    topic: 'Applications',
    kind: 'Worked guide',
  },
] as const;

export const instrumentParts = [
  {
    id: 'screen',
    title: 'Measurement display',
    description:
      'The real ZNLE uses a 10.1-inch touchscreen. This model shows synthetic trace data.',
    tip: 'Read the trace label, axes and correction status together.',
    side: 'front',
  },
  {
    id: 'preset',
    title: 'Preset',
    description: 'Return to a known starting configuration.',
    tip: 'In this prototype, preset resets the teaching bench. Record your work first.',
    side: 'front',
  },
  {
    id: 'setup',
    title: 'Setup',
    description: 'Instrument configuration belongs here; it is separate from the DUT response.',
    tip: 'Real reference-clock and network settings require the instrument manual.',
    side: 'front',
  },
  {
    id: 'mode',
    title: 'Mode',
    description: 'Organizes hardware channel setups.',
    tip: 'This teaching model has one VNA workspace. A ZNLE is not a spectrum analyzer.',
    side: 'front',
  },
  {
    id: 'print',
    title: 'Print',
    description: 'The hardware provides print and screen-output settings.',
    tip: 'Use the app’s export or browser print feature for your simulated lab report.',
    side: 'front',
  },
  {
    id: 'file',
    title: 'File',
    description: 'The instrument can store and recall settings and results.',
    tip: 'The prototype exports teaching data; it does not produce a native ZNLE recall set.',
    side: 'front',
  },
  {
    id: 'keyboard',
    title: 'On-screen keyboard',
    description: 'Shows a software keyboard on the actual touchscreen.',
    tip: 'In this app, use the accessible labelled input fields or your device keyboard.',
    side: 'front',
  },
  {
    id: 'frequency',
    title: 'Freq',
    description: 'Choose the frequencies to investigate.',
    tip: 'Start wide, find a feature, then narrow the interval.',
    side: 'front',
  },
  {
    id: 'span',
    title: 'Span',
    description: 'Set the width of the frequency window.',
    tip: 'Centre frequency plus or minus half the span gives the edges.',
    side: 'front',
  },
  {
    id: 'scale',
    title: 'Scale',
    description: 'Make a response readable by changing its display scale.',
    tip: 'Changing the scale changes presentation, not the DUT.',
    side: 'front',
  },
  {
    id: 'marker',
    title: 'Mkr',
    description: 'Inspect a selected frequency on the trace.',
    tip: 'Report its frequency, parameter, format and value.',
    side: 'front',
  },
  {
    id: 'marker-search',
    title: 'Mkr →',
    description: 'Search for a sampled trace maximum or minimum.',
    tip: 'Search cannot reveal features outside the sweep or between widely spaced points.',
    side: 'front',
  },
  {
    id: 'bandwidth',
    title: 'Bw Avg Power',
    description: 'On hardware, this groups receiver bandwidth, averaging and stimulus controls.',
    tip: 'The idealized prototype does not establish real noise or compression performance.',
    side: 'front',
  },
  {
    id: 'sweep',
    title: 'Sweep',
    description: 'Choose sampling and sweep behaviour.',
    tip: 'A denser sweep resolves smaller features at the cost of more samples.',
    side: 'front',
  },
  {
    id: 'trace',
    title: 'Trace',
    description: 'Manage how a measured response is presented.',
    tip: 'Keep the selected S-parameter visible when comparing results.',
    side: 'front',
  },
  {
    id: 'trigger',
    title: 'Trig',
    description: 'The hardware can coordinate sweep timing with a trigger.',
    tip: 'This offline model uses software sweep controls, not external signals.',
    side: 'front',
  },
  {
    id: 'offset',
    title: 'Offset Embed',
    description: 'The real instrument supports reference-plane and network transformations.',
    tip: 'Advanced embedding and de-embedding are outside this introductory model.',
    side: 'front',
  },
  {
    id: 'measurement',
    title: 'Meas',
    description: 'Choose reflection or transmission: S11, S21, S12 or S22.',
    tip: 'The second subscript identifies the driven port.',
    side: 'front',
  },
  {
    id: 'format',
    title: 'Format',
    description: 'Look at magnitude, phase or a reflection Smith chart.',
    tip: 'Use a format that answers your measurement question.',
    side: 'front',
  },
  {
    id: 'display-lines',
    title: 'Display Lines',
    description: 'Visual reference lines help compare a response with a target.',
    tip: 'A teaching reference line is not a calibrated hardware limit test.',
    side: 'front',
  },
  {
    id: 'calibration',
    title: 'Cal',
    description: 'Open the model’s calibration exercises.',
    tip: 'The simulated correction is explicitly simplified; it is not real ZNLE certification.',
    side: 'front',
  },
  {
    id: 'channel',
    title: 'Channel',
    description: 'Hardware channels organize stimulus and measurement settings.',
    tip: 'This prototype uses one teaching sweep, not the complete channel system.',
    side: 'front',
  },
  {
    id: 'keypad',
    title: 'Numeric keypad',
    description: 'Enter a value and pay attention to its unit.',
    tip: 'MHz and GHz differ by a factor of one thousand.',
    side: 'front',
  },
  {
    id: 'knob',
    title: 'Rotary control',
    description: 'Adjust the selected parameter in small increments.',
    tip: 'Check the active field before changing a value.',
    side: 'front',
  },
  {
    id: 'port1',
    title: 'Port 1',
    description: 'One of two 50 Ω N-female test ports.',
    tip: 'For real work, inspect connectors and check DUT power and DC limits before connection.',
    side: 'front',
  },
  {
    id: 'port2',
    title: 'Port 2',
    description:
      'The second test port receives forward transmission or drives the reverse measurement.',
    tip: 'On a ZNLE, this is a VNA port; do not infer a ZNL spectrum-analyzer mode.',
    side: 'front',
  },
  {
    id: 'front-usb',
    title: 'Front USB',
    description: 'Two USB 2.0 sockets support peripherals and storage.',
    tip: 'No USB or physical instrument access is requested by this prototype.',
    side: 'front',
  },
  {
    id: 'power',
    title: 'Front power key',
    description: 'Starts or shuts down the real instrument.',
    tip: 'A software power illustration does not operate the rear mains switch.',
    side: 'front',
  },
  {
    id: 'rear-power',
    title: 'AC inlet and main switch',
    description: 'Rear mains connection and primary on/off switch.',
    tip: 'Follow the instrument’s electrical safety instructions; do not treat this model as a wiring guide.',
    side: 'rear',
  },
  {
    id: 'lan',
    title: 'LAN',
    description: 'Ethernet connection for the real instrument’s network functions.',
    tip: 'The student simulator runs locally and does not open a connection to hardware.',
    side: 'rear',
  },
  {
    id: 'rear-usb',
    title: 'Rear USB',
    description: 'Two USB 3.0 sockets are specified for the ZNLE.',
    tip: 'The blue sockets in your reference photo help distinguish these from the front sockets.',
    side: 'rear',
  },
  {
    id: 'ref-in',
    title: 'Ref. In',
    description: 'Accepts an external frequency reference.',
    tip: 'The specified reference frequency is 10 MHz. It is not a DUT measurement port.',
    side: 'rear',
  },
  {
    id: 'ref-out',
    title: 'Ref. Out',
    description: 'Provides a frequency reference to other equipment.',
    tip: 'Clock synchronization and RF DUT characterization are different tasks.',
    side: 'rear',
  },
  {
    id: 'trigger-in',
    title: 'Trigger input',
    description: 'Receives a timing signal for externally controlled sweeps.',
    tip: 'Its input limits differ from the RF test ports; consult the relevant manual section.',
    side: 'rear',
  },
] as const;

export const concepts = [
  {
    id: 's-parameters',
    title: 'Four paths, one device',
    body: 'S11 and S22 describe reflection at each port. S21 and S12 describe transmission in opposite directions. The other port is referenced to a matched termination when defining each quantity.',
    formula: 'Sij = outgoing wave at i / incident wave at j',
    exercise:
      'Switch between S21 and S12 on a reciprocal preset. Explain why they agree in this model.',
  },
  {
    id: 'db',
    title: 'Amplitude ratio to decibels',
    body: 'A wave ratio is not an absolute power reading. For a matched passive example, a more negative transmission magnitude means less transmitted signal.',
    formula: 'Magnitude in dB = 20 log10 |Sij|',
    exercise:
      'A 10 dB attenuator has |S21| ≈ 0.316. Check the preset and compare this with the amplitude ratio 0.5, which is about −6.02 dB.',
  },
  {
    id: 'return-loss',
    title: 'Return loss has the opposite sign',
    body: 'S11 dB magnitude is usually negative for a passive matched load. Return loss is its positive opposite. Better matching gives higher return loss and VSWR closer to one.',
    formula: 'RL = −20 log10 |Γ| · VSWR = (1 + |Γ|) / (1 − |Γ|)',
    exercise: 'For |Γ| = 0.1, calculate return loss and VSWR. Answers: 20 dB and about 1.22:1.',
  },
  {
    id: 'smith',
    title: 'Read the reflection plane',
    body: 'The Smith chart maps a reflection coefficient to impedance normalized by Z0. Its centre represents a match; ideal open and short lie at the right and left edges.',
    formula: 'Z = Z0 (1 + Γ) / (1 − Γ), with Z0 = 50 Ω here',
    exercise:
      'Find the open, short and matched-load presets on the chart. Why does an open not have a finite impedance?',
  },
  {
    id: 'delay',
    title: 'A slope reveals delay',
    body: 'A cable takes time to carry a signal. Its transmission phase rotates as frequency changes. Unwrap phase before estimating its slope; phase is not useful at a response null.',
    formula: 'Group delay = −(1 / 2π) dφ/df, with φ in radians',
    exercise:
      'Compare cable phase and group delay. Explain why wrapped phase jumps do not mean the cable suddenly changes length.',
  },
  {
    id: 'calibration',
    title: 'Correction is a model, too',
    body: 'Measurement calibration estimates systematic setup errors using known standards. It does not remove every random error or turn a simulator into a traceable physical measurement.',
    formula: 'Reference plane = the defined DUT connection',
    exercise:
      'Explain the difference between the prototype’s reflection correction, a through response reference and a real full two-port calibration.',
  },
] as const;

export const referenceNotice =
  'Independent educational prototype inspired by the R&S ZNLE6. Original lessons and analytic responses run offline. Manufacturer manuals are external links that need internet; they are not bundled. Rohde & Schwarz has not endorsed or validated this simulator.';
