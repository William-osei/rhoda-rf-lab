"""Offline vendor driver smoke test. Never opens a real instrument session."""

import json
from importlib.metadata import version
from RsInstrument import RsInstrument

with RsInstrument(
    "TCPIP::127.0.0.1::INSTR", id_query=True, reset=False, options="Simulate=True"
) as instrument:
    instrument.write_str("TIMebase:SCALe 0.001")
    scale = instrument.query_float("TIMebase:SCALe?")
    assert scale == 0.001, scale
    print(
        json.dumps(
            {
                "driver": "RsInstrument",
                "version": version("RsInstrument"),
                "mode": "vendor-command-cache",
                "timebase_roundtrip": scale,
                "hardware_tested": False,
                "limitation": "Does not validate RTB SCPI support or emulate waveforms.",
            },
            indent=2,
        )
    )
