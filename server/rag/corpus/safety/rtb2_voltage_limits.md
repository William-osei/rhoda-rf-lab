---
source: rtb2_voltage_limits
category: safety
---
Safety: R&S RTB2 Voltage Limits and Hazardous Voltages

From the R&S RTB 2 Getting Started Manual, Section 1.1:

Hazardous voltage thresholds:
- Voltages higher than 30 V RMS, or 42 V peak, or 60 V DC are regarded as hazardous contact voltages
- Only electrically skilled persons should measure hazardous voltages
- Do not touch exposed connections and components when power is applied
- Switch off the test circuit while connecting and disconnecting probe leads

Input and probe ratings:
- Check the exact instrument, input, probe and accessory ratings against their current manuals and specifications before connecting a circuit
- Use the applicable voltage-to-earth, differential/common-mode, measurement-category (CAT) and frequency-dependent limits; a probe's attenuation setting is not a safety rating
- The RTB 2 is not rated for a measurement category. A probe's CAT marking does not give that category rating to the oscilloscope or the complete setup
- Do not infer a generic safe input voltage from a 1:1 or 10:1 setting; the lab assistant must approve the complete measurement arrangement

Probe safety rules:
- Use only probes and accessories that comply with the measurement category (CAT) of your task
- Set the correct attenuation factor on the instrument to match the probe — otherwise measurement results will not reflect the actual voltage level and you might misjudge the actual risk
- Never cause short circuits when measuring sources with high output currents
- Probe pins are extremely pointed and can penetrate clothes and skin — handle with great care
- Set up all probe connections to the instrument before applying power to the circuit under test
- When working with high voltages and current probes, observe additional operating conditions in the safety instructions
- Prevent mechanical shock to the probe — avoid excessive strain or sharp bends on the probe cable

Grounding:
- Conventional RTB 2 passive-probe ground connections are earth-referenced through the instrument. Do not defeat protective earth or float the mains-powered oscilloscope
- Never attach an ordinary probe's ground clip to a live or non-earth-referenced point; it can create a short circuit through the instrument's earth path
- Math subtraction (CH1 - CH2) does not isolate the channel grounds or make an unsafe connection safe
- For a voltage between two non-ground-referenced points, use an appropriately rated differential probe or another method explicitly approved by the lab assistant. All probe-to-earth, common-mode, differential-voltage, CAT and frequency limits still apply

Official references:
- [R&S RTB 2 Getting Started, version 11](https://scdn.rohde-schwarz.com/ur/pws/dl_downloads/pdm/cl_manuals/getting_started/1333_1605_01/RTB2_GettingStarted_en_01.pdf), section 1.1: intended use, grounding, measurement ratings and hazardous voltages
- [R&S Essentials: oscilloscope probe tips](https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/rs-essentials-digital-oscilloscopes/oscilloscope-probe-tips-and-how-to-use-them_257202.html), input impedance and differential measurements
- [R&S: Understanding Differential Probes](https://www.rohde-schwarz.com/in/knowledge-center/videos/understanding-differential-probes_251220-1614798.html), ground-lead hazards and common-mode/differential limits

This is introductory teaching guidance, not approval of a physical setup. Follow the exact manuals and the lab assistant's instructions.
