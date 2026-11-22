"""Application command limits; physical ratings must be checked separately."""

import math
import re


def number(value, low, high):
    if (
        type(value) not in (int, float)
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        raise ValueError(f"Expected finite number between {low} and {high}")
    return float(value)


def choice(value, choices):
    if not isinstance(value, str) or value.upper() not in choices:
        raise ValueError(f"Expected one of {', '.join(choices)}")
    return choices[value.upper()]


def validate_parameter(path, value):
    if not isinstance(path, str):
        raise ValueError("Parameter path must be a string")
    path = path.lower()
    if path == "trigger.edge":
        path = "trigger.slope"
    if path == "acquisition.state":
        return path, choice(
            value, {"RUN": "RUN", "RUNNING": "RUN", "STOP": "STOP", "STOPPED": "STOP"}
        )
    if path == "timebase.scale":
        return path, number(value, 1e-9, 50)
    if path == "trigger.level":
        return path, number(value, -100, 100)
    if path == "trigger.source":
        return path, choice(value, {f"CH{i}": f"CH{i}" for i in range(1, 5)})
    if path == "trigger.slope":
        return path, choice(
            value,
            {
                "RISING": "POSitive",
                "POS": "POSitive",
                "POSITIVE": "POSitive",
                "FALLING": "NEGative",
                "NEG": "NEGative",
                "NEGATIVE": "NEGative",
            },
        )
    if path == "trigger.mode":
        return path, choice(
            value, {"AUTO": "AUTO", "NORMAL": "NORMal", "NORM": "NORMal"}
        )
    match = re.fullmatch(
        r"channel\.([1-4])\.(enabled|vertical_scale|offset|coupling|probe_attenuation)",
        path,
    )
    if match:
        field = match[2]
        if field == "enabled":
            if type(value) is not bool:
                raise ValueError("enabled must be a boolean")
            return path, value
        if field == "vertical_scale":
            return path, number(value, 0.001, 100)
        if field == "offset":
            return path, number(value, -100, 100)
        if field == "coupling":
            return path, choice(
                value,
                {
                    "AC": "ACLimit",
                    "ACLIMIT": "ACLimit",
                    "DC": "DCLimit",
                    "DCLIMIT": "DCLimit",
                },
            )
        if field == "probe_attenuation":
            if isinstance(value, str):
                value = choice(value, {"1X": 1.0, "10X": 10.0, "100X": 100.0})
            value = number(value, 1, 100)
            if value not in (1, 10, 100):
                raise ValueError("Supported attenuation factors: 1, 10, 100")
            return path, value
    raise ValueError(f"Unsupported parameter: {path}")


def validate_measurement(measurement_type, source, gate):
    allowed = (
        "frequency",
        "period",
        "peak_to_peak",
        "rms",
        "mean",
        "rise_time",
        "fall_time",
    )
    if measurement_type not in allowed:
        raise ValueError("Unsupported measurement type")
    source = choice(
        "CH1" if source is None else source, {f"CH{i}": f"CH{i}" for i in range(1, 5)}
    )
    if gate is not None:
        raise ValueError("Measurement gating is not implemented")
    return measurement_type, source, None
