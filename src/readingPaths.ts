/** RHODA-authored reading plans, not manufacturer SOPs or performed measurements. */
export const READING_PATHS = [
 {id:'scope-tour',title:'Guided scope tour: connect, frame and measure',family:'RTB24',keywords:['tour','scope','guided','narrated'],intro:'Learn the front panel in seven short sections. The narrator highlights each part without changing simulator settings.',steps:[
 'Start at the channel one connector. A probe carries a voltage signal to this input. Identify the probe ratio and channel setting together. On real equipment, confirm the circuit reference and ratings before making a connection. The station shown here is a simulation.',
 'Find the probe compensation output. A passive probe may need compensation for the instrument input. Compare the square-wave shape with the matching probe instructions. Do not treat an arbitrary output connector as a calibration source.',
 'Look at the vertical scale knob. Volts per division determines the voltage span of each grid square. At half a volt per division, a two volt peak-to-peak signal occupies four divisions. Predict the height, then try an approved change in the simulator.',
 'Now look at the horizontal scale. Time per division determines the time span of a grid square. For a one kilohertz signal, one period is one millisecond. One hundred microseconds per division across ten divisions shows one period.',
 'Find the trigger level control. An edge trigger uses a threshold and direction to align acquisition on hardware. Place the threshold within the waveform range. This simulator only checks whether a crossing is possible, so it does not demonstrate the complete hardware trigger engine.',
 'Locate the measurement controls. Frequency describes repetitions per second; peak-to-peak is maximum minus minimum voltage. Preview a measurement and approve it, then compare the reported value with your prediction. Do not confuse simulated values with readings from a physical instrument.',
 'Finish at the save and export controls. Preserve the waveform, scale settings, channel and source information with your notes. Write what was predicted and what was observed separately. Export the training evidence, then consult the matching manual before a supervised hardware exercise.'
 ],evidence:'Annotated front panel, scale predictions, approved simulator readings and a training evidence export.',search:'RTB probe trigger measurement',url:'https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/rs-essentials-digital-oscilloscopes/understanding-basic-oscilloscope-operation_254512.html'},
 {id:'first-connection',title:'Connect an instrument to a computer',family:'Automation',keywords:['connect','connection','visa','python','scpi','remote','setup'],intro:'Goal: prepare a documented, read-only connection test before adding instrument-control code.',steps:[
 'Record the exact model, firmware, installed interface options and the manual revision. A matching family name alone does not establish compatibility.',
 'Read the SCPI getting-started guide: identify which USB or LAN protocol the instrument supports. Record the resource string from the instrument or a compatible VISA discovery tool; do not guess it from another model.',
 'For a lab network, obtain the permitted address and connection method. For USB, identify the device interface and matching driver. A USB storage port is not automatically a remote-control interface.',
 'Follow the official remote-control setup tutorial to install a compatible VISA implementation and Python communication package on the intended computer. RHODA has not installed these drivers or configured a physical instrument.',
 'Plan an identity query (*IDN?) first. Record its exact response and the resource address; do not begin with reset commands, output-enable commands or a copied sweep script.',
 'If identity fails, separate physical connectivity, VISA discovery and command/protocol issues. Record timeout and error text. Close the session after the test; only then design a reviewed measurement sequence.'
 ],evidence:'Save model/firmware, interface, driver/package versions, resource address, identity response, timeout setting and test date. Leave results blank until performed.',search:'Remote_Control_SCPI',url:'https://www.rohde-schwarz.com/us/driver-pages/remote-control/getting-started_231558.html'},
 {id:'scope-start',title:'RTB: from setup to a stable waveform',family:'RTB24',keywords:['oscilloscope','rtb','trigger','waveform','probe','timebase'],intro:'Goal: understand and document a simple waveform before relying on automatic measurements.',steps:[
 'Open the RTB user manual and identify its firmware coverage. Read safety, preparation and probe sections before connecting a signal. Use a lab-approved training source; do not assume any circuit is safe to probe.',
 'Record probe model, attenuation and channel settings. The physical probe and channel attenuation must agree. Verify the grounding arrangement and input limits in the matching probe and instrument documents.',
 'Study waveform setup, then triggering: channel/source, coupling, vertical scale, horizontal scale, trigger slope and level. In simulator practice, change one setting at a time and explain the result.',
 'For the RHODA ideal 1 kHz signal, calculate period = 1 ms. Across ten divisions, 100 µs/div spans one cycle, 500 µs/div spans five and 1 ms/div spans ten. These are mathematical expectations, not measured hardware results.',
 'Use the official measurement workbook for a reviewed exercise. Compare cursor and automatic readings; record units, measurement type and source channel.',
 'Keep the original screenshot or data export with settings. Explain differences between expected and observed values without treating simulator values as calibration evidence.'
 ],evidence:'A setup sketch, probe/channel settings, screenshot, frequency/period and amplitude readings, and the relevant manual page.',search:'RTB trigger',url:'https://www.rohde-schwarz.com/in/manual/rs-rtb2-rs-rtb2000-user-manual_78701-402707.html'},
 {id:'scope-workbook',title:'Oscilloscope measurement exercises',family:'RTB24',keywords:['exercise','learn','workbook','bandwidth','rise','measurement'],intro:'Goal: turn the official 1MA265 workbook into a traceable learning record.',steps:[
 'Read the workbook overview and choose one basic measurement exercise. Note the instrument and accessories it assumes before attempting to reproduce it.',
 'Write the learning question and predicted result in an experiment record. Identify which values are known, assumed or still to be measured.',
 'List the required settings and the evidence you will save. Rehearse applicable scale and trigger concepts in the RHODA simulator.',
 'During a lab-approved exercise, record the actual settings, units and captured data. A procedure description is not evidence that a measurement was completed.',
 'Compare the workbook method with your own measurements. Explain sources of disagreement and what the available specifications do or do not support.',
 'Finish with one reproducible next step rather than a claim that an instrument has been validated or calibrated.'
 ],evidence:'Completed experiment record with raw data links, assumptions, comparison and outstanding questions.',search:'1MA265',url:'https://www.rohde-schwarz.com/in/applications/measuring-with-oscilloscopes_230850-173634.html'},
 {id:'fpc-start',title:'FPC1500: plan a spectrum measurement',family:'FPC1500',keywords:['fpc','spectrum','analyzer','rf','impedance','antenna'],intro:'Goal: choose the appropriate measurement mode and document a reproducible RF setup.',steps:[
 'Confirm the FPC model and installed options. Do not infer available functions from a brochure or from another FPC model.',
 'Find the matching manual sections for the input connector, permissible input conditions and the chosen measurement mode before connecting the device under test.',
 'Write down the signal question: frequency, level, harmonics or another defined quantity. Identify source and load impedance, cables, adapters and any required attenuation.',
 'Read the sections for frequency span, reference level, attenuation, resolution bandwidth and markers. Record selected settings and why each fits the question.',
 'For reflection or antenna work, use the matching application note and calibration procedure only when the installed hardware/options support that task.',
 'Save the trace and settings together. Explain cable losses, calibration state and units. A spectrum trace alone does not establish compliance with a standard.'
 ],evidence:'Model/options, connection sketch, settings, trace file, calibration state and source pages.',search:'FPC measurement',url:'https://www.rohde-schwarz.com/us/manual/fpc/'},
 {id:'generator-start',title:'HMF2550: prepare a signal-generation setup',family:'HMF2550',keywords:['hmf','generator','amplitude','offset','load','sine'],intro:'Goal: reconcile the requested waveform with the intended load before enabling an output.',steps:[
 'Identify the exact HMF model and read its user manual together with the SCPI programmer manual. Commands and limits must come from that model.',
 'Define waveform, frequency, amplitude convention, DC offset and intended load in writing. Distinguish Vpp, peak and RMS values.',
 'Review the output/load convention in the manual. Do not assume the displayed amplitude equals the voltage at an arbitrary connected load.',
 'Plan the receiving instrument, cable and termination. Check both instruments and accessories against the intended signal.',
 'Prepare settings with output disabled, subject to the lab-approved procedure. A software example must not silently enable an output.',
 'After an approved test, capture actual receiving-instrument readings and compare them with the requested values. Record load and offset alongside amplitude.'
 ],evidence:'Requested waveform table, load/termination, output state, observed values and programmer-manual references.',search:'HMF amplitude',url:'https://scdn.rohde-schwarz.com/ur/pws/dl_downloads/dl_common_library/dl_manuals/dl_user_manual/HMF25xx_SCPI_ProgrammersManual_en_01.pdf'},
 {id:'supply-start',title:'NGE100B: document a power-supply setup',family:'NGE100',keywords:['nge','power','supply','current','voltage','limit'],intro:'Goal: prepare a channel and protection plan before powering a load.',steps:[
 'Check the label: the supplied NGE100 folder contains NGE100B documentation. Confirm model, firmware and available interfaces against the manual.',
 'Read preparation and test-setup sections, then channel selection and voltage/current limit settings. Record the intended load and its requirements.',
 'Identify the planned channel, limits and relevant protection features. Keep a written distinction between programmed values and measured values.',
 'Review output controls and channel interactions before connecting the load. Do not treat a saved setup as proof that its output state is safe.',
 'For automation, check required remote-control options and read the interface chapter. The current RHODA control adapter does not control this supply.',
 'During an approved experiment, record actual voltage/current and any limiting or protection behavior. Keep output-off and shutdown steps in the experiment record.'
 ],evidence:'Channel plan, load, limits/protection settings, interface options, observed readings and shutdown record.',search:'NGE current',url:'https://scdn.rohde-schwarz.com/ur/pws/dl_downloads/pdm/cl_manuals/user_manual/5601_1343_01/NGE100B_User_Manual_en_11.pdf'}
];
export function pathMarkdown(p:typeof READING_PATHS[number]) {return `## ${p.title}\n\n${p.intro}\n\n${p.steps.map((s,i)=>`${i+1}. ${s}`).join('\n\n')}\n\n**Record:** ${p.evidence}\n\n[Search local source pages](library.html?${new URLSearchParams({q:p.search})}) · [Official reference](${p.url})\n\nRHODA-authored reading plan, checked 30 September 2026. This is not your lab’s approved SOP, and no hardware operation has been performed.`;}
