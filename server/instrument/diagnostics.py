"""Environment inspection. Does not open, reset or write to any instrument."""

from importlib.metadata import version, PackageNotFoundError


def connection_diagnostics():
    packages = {}
    for name in ("RsInstrument", "PyVISA", "PyVISA-py", "pyusb"):
        try:
            packages[name] = version(name)
        except PackageNotFoundError:
            packages[name] = None
    return {
        "packages": packages,
        "hardware_tested": False,
        "resource_examples": {
            "lan_visa": "TCPIP::INSTRUMENT_IP::INSTR",
            "lan_socket": "TCPIP::INSTRUMENT_IP::5025::SOCKET",
            "usb": "Use the exact USB VISA resource reported by discovery",
        },
        "instructions": [
            "Identify the actual RTB model and firmware from its front panel.",
            "For LAN, use the address shown in the instrument's interface settings; its browser front panel requires the physical device.",
            "Install RsInstrument and the appropriate VISA backend for USB or VXI-11. A raw LAN socket can use RsInstrument's socket backend.",
            "Set SCOPE_RESOURCE to the exact resource and restart RHODA. Connection failure remains unavailable; it never falls back to training.",
            "RHODA's implemented command profile is RTB; do not assume MXO, FPC or other equipment uses the same commands.",
        ],
    }
