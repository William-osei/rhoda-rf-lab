import math
import unittest
from instrument.training import TrainingScopeBackend
from instrument.scope_client import ScopeClient
from instrument.backends import RsInstrumentBackend


class TrainingTests(unittest.TestCase):
    def setUp(self):
        self.backend = TrainingScopeBackend()

    def test_sine_values_match_waveform(self):
        b = self.backend
        self.assertAlmostEqual(b.run_measurement("rms")["value"], 1 / math.sqrt(2))
        frame = b.waveform()
        self.assertAlmostEqual(frame["time_s"][-1] - frame["time_s"][0], 0.01)
        self.assertAlmostEqual(
            max(frame["voltage_v"]) - min(frame["voltage_v"]), 2, places=2
        )

    def test_ac_removes_offset(self):
        b = self.backend
        b.select_scenario("offset")
        self.assertEqual(b.run_measurement("mean")["value"], 1)
        b.set_parameter("channel.1.coupling", "AC")
        self.assertEqual(b.run_measurement("mean")["value"], 0)

    def test_no_signal_and_disabled_channel(self):
        self.assertIsNone(self.backend.run_measurement("frequency", "CH2")["value"])
        self.backend.select_scenario("disconnected")
        self.assertIsNone(self.backend.run_measurement("frequency")["value"])

    def test_four_channels_keep_independent_controls_and_share_ideal_source(self):
        b = self.backend
        b.select_scenario("offset")
        b.set_parameter("channel.2.enabled", True)
        b.set_parameter("channel.2.coupling", "AC")
        b.set_parameter("channel.2.vertical_scale", 0.2)
        b.set_parameter("channel.2.probe_attenuation", 1)
        b.set_parameter("channel.4.enabled", True)
        b.set_parameter("channel.4.probe_attenuation", 100)
        b.set_parameter("trigger.source", "CH4")
        b.set_parameter("trigger.level", 10)

        ch1, ch2, ch4 = (b.waveform(source) for source in ("CH1", "CH2", "CH4"))
        self.assertEqual(ch1["source"], "CH1")
        self.assertEqual(ch2["source"], "CH2")
        self.assertEqual(ch4["source"], "CH4")
        self.assertAlmostEqual(max(ch1["voltage_v"]) - min(ch1["voltage_v"]), 2, places=2)
        self.assertAlmostEqual(max(ch2["voltage_v"]) - min(ch2["voltage_v"]), 0.2, places=2)
        self.assertAlmostEqual(max(ch4["voltage_v"]) - min(ch4["voltage_v"]), 20, places=2)
        self.assertEqual(ch1["state"]["channels"][1]["probe_attenuation"], 10.0)
        self.assertEqual(ch2["state"]["channels"][2]["coupling"], "ACLimit")
        self.assertTrue(ch4["trigger_possible"])
        self.assertFalse(ch1["trigger_possible"])
        self.assertAlmostEqual(b.run_measurement("peak_to_peak", "CH2")["value"], 0.2)
        self.assertAlmostEqual(b.run_measurement("peak_to_peak", "CH4")["value"], 20)

    def test_square_edges_are_not_invented(self):
        self.backend.select_scenario("square")
        self.assertEqual(self.backend.run_measurement("frequency")["value"], 500)
        self.assertIsNone(self.backend.run_measurement("rise_time")["value"])

    def test_display_warnings(self):
        self.backend.set_parameter("channel.1.vertical_scale", 0.1)
        self.backend.set_parameter("timebase.scale", 1)
        frame = self.backend.waveform()
        self.assertTrue(frame["undersampled"])
        self.backend.set_parameter("timebase.scale", 0.001)
        self.assertTrue(self.backend.waveform()["clipped"])

    def test_scenario_change_invalidates_measurement_approval(self):
        client = ScopeClient(self.backend)
        preview = client.run_measurement("frequency")
        self.backend.select_scenario("square")
        self.assertFalse(
            client.run_measurement(
                "frequency", confirmed=True, confirmation_id=preview.confirmationId
            ).ok
        )

    def test_invalid_scenario_does_not_change_state(self):
        before = self.backend.read_state("all")
        with self.assertRaises(ValueError):
            self.backend.select_scenario([])
        self.assertEqual(before, self.backend.read_state("all"))

    def test_real_enum_readback_normalized(self):
        self.assertEqual(RsInstrumentBackend._canonical("mode", "NORM"), "NORMal")
        self.assertEqual(RsInstrumentBackend._canonical("slope", "POS"), "POSitive")
        self.assertEqual(RsInstrumentBackend._canonical("coupling", "DCL"), "DCLimit")


class TrainingApiTests(unittest.TestCase):
    def setUp(self):
        import app

        self.module = app
        self.saved = app.scope, app.instrument_mode
        app.scope, app.instrument_mode = ScopeClient(TrainingScopeBackend()), "mock"
        self.client = app.app.test_client()

    def tearDown(self):
        self.module.scope, self.module.instrument_mode = self.saved

    def test_input_validation(self):
        self.assertEqual(
            self.client.post("/api/training/scenarios", json=[]).status_code, 400
        )
        self.assertEqual(
            self.client.get("/api/training/waveform?source=CH9").status_code, 400
        )
        self.assertEqual(
            self.client.post(
                "/api/training/scenarios",
                json={"scenario": "unknown"},
                headers={"X-Rhoda-Session": "test"},
            ).status_code,
            400,
        )

    def test_waveform_has_provenance(self):
        frame = self.client.get("/api/training/waveform").get_json()
        self.assertEqual(len(frame["voltage_v"]), 1001)
        self.assertIn("not captured", frame["provenance"])

    def test_each_source_can_be_read_from_training_api(self):
        for channel in range(1, 5):
            response = self.client.get(f"/api/training/waveform?source=CH{channel}")
            self.assertEqual(response.status_code, 200)
            frame = response.get_json()
            self.assertEqual(frame["source"], f"CH{channel}")
            self.assertEqual(len(frame["voltage_v"]), 1001)

    def test_hardware_cannot_use_training(self):
        self.module.instrument_mode = "hardware"
        self.assertEqual(self.client.get("/api/training/waveform").status_code, 409)
        self.assertEqual(
            self.client.post(
                "/api/training/scenarios",
                json={"scenario": "sine"},
                headers={"X-Rhoda-Session": "test"},
            ).status_code,
            409,
        )

    def test_diagnostics_available_when_connection_fails(self):
        self.module.scope, self.module.instrument_mode = None, "unavailable"
        response = self.client.get("/api/instrument/diagnostics")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["mode"], "unavailable")


if __name__ == "__main__":
    unittest.main()
