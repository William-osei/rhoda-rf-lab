"""Regression tests: mocks and recording transports only, never hardware."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from instrument.scope_client import ScopeClient, build_mock_client
from instrument.backends import MockScopeBackend, RsInstrumentBackend
from instrument.confirmation import ConfirmationGate


class ConfirmationTests(unittest.TestCase):
    def setUp(self):
        self.client = build_mock_client()

    def preview(self, path="channel.1.vertical_scale", value=2.0, session="a"):
        result = self.client.set_parameter(path, value, session_id=session)
        self.assertTrue(result.ok)
        self.assertTrue(result.needsConfirmation)
        return result.confirmationId

    def confirm(self, token, path="channel.1.vertical_scale", value=2.0, session="a"):
        return self.client.set_parameter(path, value, True, token, session)

    def test_preview_has_actual_old_value_and_does_not_write(self):
        result = self.client.set_parameter("channel.1.vertical_scale", 2.0)
        self.assertEqual(result.result["previousValue"], 0.5)
        self.assertEqual(
            self.client.read_state().result["channels"][1]["vertical_scale"], 0.5
        )

    def test_valid_confirmation_and_readback(self):
        result = self.confirm(self.preview())
        self.assertTrue(result.ok)
        self.assertEqual(result.result["value"], 2.0)

    def test_changed_value_rejected(self):
        self.assertFalse(self.confirm(self.preview(), value=5.0).ok)
        self.assertEqual(
            self.client.read_state().result["channels"][1]["vertical_scale"], 0.5
        )

    def test_stale_state_rejected(self):
        token = self.preview()
        self.client._backend.set_parameter("channel.1.vertical_scale", 1.0)
        self.assertFalse(self.confirm(token).ok)

    def test_wrong_session_cannot_consume_owner_token(self):
        token = self.preview()
        self.assertFalse(self.confirm(token, session="b").ok)
        self.assertTrue(self.confirm(token).ok)

    def test_replay_rejected(self):
        token = self.preview()
        self.assertTrue(self.confirm(token).ok)
        self.assertFalse(self.confirm(token).ok)

    def test_concurrent_replay_only_one_succeeds(self):
        token = self.preview()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.confirm(token).ok, range(2)))
        self.assertEqual(sum(results), 1)

    def test_expiry(self):
        now = [0]
        self.client = ScopeClient(
            MockScopeBackend(), ConfirmationGate(5, lambda: now[0])
        )
        token = self.preview()
        now[0] = 6
        self.assertFalse(self.confirm(token).ok)

    def test_cancel(self):
        token = self.preview()
        self.client.cancel(token, "a")
        self.assertFalse(self.confirm(token).ok)

    def test_invalid_values_and_commands_never_preview(self):
        for path, value in [
            ("channel.1.vertical_scale", 200),
            ("channel.1.vertical_scale", float("nan")),
            ("channel.1.vertical_scale", float("inf")),
            ("channel.1.vertical_scale", True),
            ("channel.1.vertical_scale", "2;*RST"),
            ("channel.5.enabled", True),
            ("channel.1.enabled", "false"),
            ("trigger.source", "CH1;*RST"),
            ("*RST", 0),
            ("channel.1.coupling", "INVALID"),
            ("timebase.scale", 0),
        ]:
            with self.subTest(path=path, value=value):
                result = self.client.set_parameter(path, value)
                self.assertFalse(result.ok)
                self.assertIsNone(result.confirmationId)

    def test_string_confirmed_is_not_approval(self):
        self.assertFalse(self.client.set_parameter("trigger.level", 1, "false").ok)

    def test_measurement_preview_confirm_result(self):
        preview = self.client.run_measurement("frequency", "CH1", session_id="a")
        result = self.client.run_measurement(
            "frequency",
            "CH1",
            confirmed=True,
            confirmation_id=preview.confirmationId,
            session_id="a",
        )
        self.assertTrue(result.ok)
        self.assertEqual(
            (result.result["value"], result.result["unit"], result.result["status"]),
            (1000.0, "Hz", "simulator"),
        )

    def test_measurement_changed_source_rejected(self):
        p = self.client.run_measurement("frequency", "CH1")
        self.assertFalse(
            self.client.run_measurement(
                "frequency", "CH2", confirmed=True, confirmation_id=p.confirmationId
            ).ok
        )

    def test_measurement_stale_config_rejected(self):
        p = self.client.run_measurement("frequency", "CH1")
        self.client._backend.set_parameter("trigger.level", 1)
        self.assertFalse(
            self.client.run_measurement(
                "frequency", "CH1", confirmed=True, confirmation_id=p.confirmationId
            ).ok
        )

    def test_fake_measurement_tokens_rejected(self):
        for token in ("skip", "direct", None):
            self.assertFalse(
                self.client.run_measurement(
                    "frequency", "CH1", confirmed=True, confirmation_id=token
                ).ok
            )

    def test_unsupported_measurement_gate_rejected(self):
        self.assertFalse(
            self.client.run_measurement("frequency", "CH1", gate={"start": 0}).ok
        )

    def test_mock_reads_cannot_mutate_state(self):
        state = self.client.read_state().result
        state["channels"][1]["vertical_scale"] = 100
        self.assertEqual(
            self.client.read_state().result["channels"][1]["vertical_scale"], 0.5
        )


class RecordingTransport:
    def __init__(self):
        self.commands = []

    def query_str(self, cmd):
        return "Rohde&Schwarz,RTB24,TEST,03.000" if cmd == "*IDN?" else "1000"

    def write_str(self, cmd):
        self.commands.append(cmd)


class TransportTests(unittest.TestCase):
    def test_valid_scpi_and_no_raw_command_fallback(self):
        transport = RecordingTransport()
        backend = RsInstrumentBackend(transport)
        backend.set_parameter("channel.1.probe_attenuation", "10X")
        self.assertEqual(transport.commands, ["PROBe1:SETup:ATTenuation:MANual 10.0"])
        with self.assertRaises(ValueError):
            backend.set_parameter("*RST", "")
        self.assertEqual(len(transport.commands), 1)

    def test_measurement_setup_error_is_not_hidden(self):
        transport = RecordingTransport()
        backend = RsInstrumentBackend(transport)

        def fail(cmd):
            raise RuntimeError("transport failure")

        transport.write_str = fail
        with self.assertRaisesRegex(RuntimeError, "transport failure"):
            backend.run_measurement("frequency", "CH1")

    def test_read_error_is_not_replaced_with_plausible_value(self):
        transport = RecordingTransport()
        backend = RsInstrumentBackend(transport)

        def fail(cmd):
            raise RuntimeError("disconnected")

        transport.query_str = fail
        with self.assertRaisesRegex(RuntimeError, "disconnected"):
            backend.read_state("all")


if __name__ == "__main__":
    unittest.main()
