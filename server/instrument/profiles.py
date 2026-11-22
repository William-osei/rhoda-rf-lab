"""Explicit software profiles; matching an identity is not hardware acceptance."""

import re

RTB_CHANNELS = {"RTB22": 2, "RTB24": 4, "RTB2002": 2, "RTB2004": 4}


def profile_from_idn(identity):
    fields = identity.split(",")
    if len(fields) < 2 or not re.search(r"rohde\s*&\s*schwarz", fields[0], re.I):
        raise ValueError("Unrecognized manufacturer or malformed instrument identity")
    model = fields[1].strip().upper()
    if model not in RTB_CHANNELS:
        raise ValueError(f"No implemented command profile configured for model {model}")
    return {
        "family": "RTB",
        "model": model,
        "channels": RTB_CHANNELS[model],
        "hardware_acceptance": "pending",
        "waveform_download": False,
    }
