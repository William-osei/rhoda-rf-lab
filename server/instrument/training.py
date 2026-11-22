"""Ideal signal exercises, not an RTB firmware or analog front-end emulator."""

import math
from copy import deepcopy
from .backends import MockScopeBackend
from .validation import validate_measurement

SCENARIOS = {
    "sine": {
        "label": "1 kHz sine · 2 Vpp",
        "frequency": 1000.0,
        "amplitude": 1.0,
        "dc": 0.0,
        "shape": "sine",
    },
    "offset": {
        "label": "1 kHz sine · +1 V DC offset",
        "frequency": 1000.0,
        "amplitude": 1.0,
        "dc": 1.0,
        "shape": "sine",
    },
    "square": {
        "label": "500 Hz square · 2 Vpp",
        "frequency": 500.0,
        "amplitude": 1.0,
        "dc": 0.0,
        "shape": "square",
    },
    "disconnected": {
        "label": "No signal connected",
        "frequency": 0.0,
        "amplitude": 0.0,
        "dc": 0.0,
        "shape": "flat",
    },
}


class TrainingScopeBackend(MockScopeBackend):
    def __init__(self):
        super().__init__()
        self.state["training_scenario"] = "sine"
        self.state["training_revision"] = 0

    def select_scenario(self, scenario):
        if not isinstance(scenario, str) or scenario not in SCENARIOS:
            raise ValueError("Unknown training scenario")
        self.state["training_scenario"] = scenario
        self.state["training_revision"] += 1

    def signal(self, source):
        ch = self.state["channels"][int(source[-1])]
        signal = deepcopy(SCENARIOS[self.state["training_scenario"]])
        if ch["coupling"] == "ACLimit":
            signal["dc"] = 0.0
        return ch, signal

    def run_measurement(self, measurement_type, source=None, gate=None):
        kind, source, _ = validate_measurement(measurement_type, source, gate)
        ch, s = self.signal(source)
        units = {
            "frequency": "Hz",
            "period": "s",
            "peak_to_peak": "V",
            "rms": "V",
            "mean": "V",
            "rise_time": "s",
            "fall_time": "s",
        }
        value, status = None, "no_signal"
        if ch["enabled"] and s["frequency"]:
            # The exercise source is defined at the probe tip with a 10X probe.
            # The scope's configured ratio rescales voltage readouts, so a
            # mismatched setting is observable in both the trace and readings.
            probe_gain = ch["probe_attenuation"] / 10.0
            a, f, dc = s["amplitude"] * probe_gain, s["frequency"], s["dc"] * probe_gain
            # Full-cycle ideal values, not estimates from displayed/aliased samples.
            values = {
                "frequency": f,
                "period": 1 / f,
                "peak_to_peak": 2 * a,
                "rms": math.sqrt(a * a / (2 if s["shape"] == "sine" else 1) + dc * dc),
                "mean": dc,
            }
            if s["shape"] == "sine":
                values["rise_time"] = values["fall_time"] = math.asin(0.8) / (
                    math.pi * f
                )
            value = values.get(kind)
            status = "simulator" if value is not None else "unsupported_ideal_edge"
        return {
            "measurement_type": kind,
            "source": source,
            "value": value,
            "unit": units[kind],
            "status": status,
            "provenance": "ideal training signal",
        }

    def waveform(self, source="CH1"):
        _, source, _ = validate_measurement("frequency", source, None)
        ch, s = self.signal(source)
        span = 10 * self.state["timebase_scale"]
        points = 1001
        times = [(i / (points - 1) - 0.5) * span for i in range(points)]
        values = []
        probe_gain = ch["probe_attenuation"] / 10.0
        for t in times:
            phase = 2 * math.pi * s["frequency"] * t
            unit = (
                math.sin(phase)
                if s["shape"] == "sine"
                else (1 if math.sin(phase) >= 0 else -1)
            )
            values.append(
                (s["dc"] + s["amplitude"] * unit) * probe_gain
                if ch["enabled"]
                else 0.0
            )
        trig = self.state["trigger"]
        trigger_possible = (
            ch["enabled"]
            and s["frequency"] > 0
            and trig["source"] == source
            and abs(trig["level"] - s["dc"] * probe_gain)
            < s["amplitude"] * probe_gain
        )
        return {
            "source": source,
            "time_s": times,
            "voltage_v": values,
            "scenario": self.state["training_scenario"],
            "state": self.read_state("all"),
            "provenance": "RHODA ideal training model; not captured instrument data",
            "trigger_possible": bool(trigger_possible),
            "undersampled": s["frequency"] * span > (points - 1) / 10,
            "clipped": max(abs(v + ch["offset"]) for v in values)
            > 4 * ch["vertical_scale"],
            "note": "Static analytical preview, including while STOP. The exercise is defined at the tip of an ideal 10X probe; the configured probe ratio scales displayed voltage. AC coupling removes DC ideally; bandwidth, probe loading, noise, trigger timing and acquisition memory are not simulated.",
        }
