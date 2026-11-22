import unittest
from unittest.mock import patch
from instrument.profiles import profile_from_idn
from instrument.backends import RsInstrumentBackend
from instrument.scope_client import build_rs_instrument_client


class FakeInstrument:
    identity = "Rohde&Schwarz,RTB22,TEST,03.000"

    def __init__(self, *args, **kwargs):
        self.closed = False
        self.commands = []
        self.options = kwargs.get("options", "")

    def query_str(self, cmd):
        if cmd == "*IDN?":
            return self.identity
        if cmd.endswith(":COUPling?"):
            return "DCL"
        return "1"

    def write_str(self, cmd):
        self.commands.append(cmd)

    def close(self):
        self.closed = True


class HardwareProfileTests(unittest.TestCase):
    def test_channel_count(self):
        for model, n in [("RTB22", 2), ("RTB24", 4), ("RTB2002", 2), ("RTB2004", 4)]:
            self.assertEqual(
                profile_from_idn(f"Rohde&Schwarz,{model},test,1")["channels"], n
            )

    def test_unknown_identity(self):
        for identity in ["unknown", "Vendor,RTB24,test,1", "Rohde&Schwarz,MXO4,test,1"]:
            with self.assertRaises(ValueError):
                profile_from_idn(identity)

    def test_absent_channel_never_written(self):
        instrument = FakeInstrument()
        backend = RsInstrumentBackend(instrument)
        with self.assertRaises(ValueError):
            backend.set_parameter("channel.3.enabled", True)
        with self.assertRaises(ValueError):
            backend.set_parameter("trigger.source", "CH3")
        with self.assertRaises(ValueError):
            backend.run_measurement("frequency", "CH3")
        self.assertEqual(instrument.commands, [])

    def test_query_only_present_channels(self):
        backend = RsInstrumentBackend(FakeInstrument())
        self.assertEqual(list(backend.read_state("channel")["channels"]), [1, 2])

    def test_failed_connect_closes(self):
        instrument = FakeInstrument()
        instrument.identity = "Other,Unknown,test,1"
        with patch("instrument.scope_client.RsInstrument", return_value=instrument):
            with self.assertRaises(ValueError):
                build_rs_instrument_client("TCPIP::test::INSTR")
        self.assertTrue(instrument.closed)

    def test_socket_options_and_close(self):
        instrument = FakeInstrument()
        with patch(
            "instrument.scope_client.RsInstrument", return_value=instrument
        ) as constructor:
            client = build_rs_instrument_client("TCPIP::test::5025::SOCKET")
            options = constructor.call_args.kwargs["options"]
            self.assertIn("SelectVisa='socket'", options)
            self.assertIn("VisaTimeout=5000", options)
            self.assertFalse(constructor.call_args.kwargs["reset"])
            client.close()
        self.assertTrue(instrument.closed)
