"""Tests for the Antispice Web HTTP boundary."""

import base64
import unittest
from unittest.mock import patch

from asweb.app import (
    CompileRequest,
    ElementRequest,
    _cached_compile_response,
    _CompilationBusy,
    _compile_cache,
    _compile_response,
    _library_response,
    _make_circuit,
)


class CircuitTranslationTest(unittest.TestCase):
    """Verify translation from the wire format to core dataclasses."""

    def test_named_ports_are_ordered_by_the_resolved_model(self) -> None:
        """Node objects follow model port order rather than JSON order."""
        request = CompileRequest(
            elements=[
                ElementRequest(
                    reference="R1",
                    use="resistor",
                    nodes={"p": "output", "ref": "0"},
                    parameters={"resistance": 1_000},
                )
            ]
        )

        circuit = _make_circuit(request)

        self.assertEqual(circuit.elements["R1"].nodes, ("0", "output"))

    def test_duplicate_references_are_rejected(self) -> None:
        """Element references remain unique when converted to a mapping."""
        element = ElementRequest(
            reference="R1",
            use="resistor",
            nodes={"ref": "0", "p": "output"},
            parameters={"resistance": 1_000},
        )
        with self.assertRaisesRegex(ValueError, "duplicate element reference"):
            _make_circuit(CompileRequest(elements=[element, element]))


class ApiTest(unittest.TestCase):
    """Exercise the responses exposed by the HTTP endpoints."""

    def test_library_exposes_core_definitions(self) -> None:
        """The public library mirrors the core built-in library."""
        resistor = _library_response()["definitions"]["resistor"]
        self.assertEqual(resistor["type"], "model")
        self.assertEqual(resistor["ports"], ["ref", "p"])
        self.assertEqual(resistor["parameters"], ["resistance"])
        self.assertEqual(resistor["auxiliaries"], {})
        self.assertEqual(_library_response()["definitions"]["bjt-ebers-moll"]["ports"], ["E", "B", "C"])
        self.assertEqual(_library_response()["definitions"]["fet-shichman-hodges"]["ports"], ["S", "G", "D"])
        self.assertTrue({"1n4007", "2n7000", "bs170", "bc547", "bc548", "bc549"} <= _library_response()["definitions"].keys())

    def test_compile_returns_wasm_and_wrapper(self) -> None:
        """A valid request produces executable artifacts and metadata."""
        with self.assertLogs("asweb.backend", level="INFO") as captured:
            result = _compile_response(
                CompileRequest.model_validate(
                    {
                        "elements": [
                            {"reference": "V1", "use": "voltage-source", "nodes": {"ref": "0", "p": "in"}, "parameters": {"voltage": 1}},
                            {"reference": "R1", "use": "resistor", "nodes": {"ref": "in", "p": "0"}, "parameters": {"resistance": 1000}},
                        ]
                    }
                ),
                compilation_id="test-compile",
            )
        self.assertTrue(base64.b64decode(result["wasm"]).startswith(b"\0asm"))
        self.assertIn("export class AntispiceSolver", result["javascript"])
        self.assertGreater(result["stateSize"], 0)
        log = "\n".join(captured.output)
        self.assertIn("compile[test-compile] stage=circuit flattening completed", log)
        self.assertIn("compile[test-compile] stage=residual/Jacobian transpilation completed", log)
        self.assertIn("compile[test-compile] completed", log)

    def test_compile_reports_core_validation_errors(self) -> None:
        """Core validation rejects an incomplete model-backed instance."""
        request = CompileRequest.model_validate({"elements": [{"reference": "R1", "use": "resistor", "nodes": {"ref": "0", "p": "out"}, "parameters": {}}]})
        with self.assertRaisesRegex(ValueError, "missing model parameters"):
            _compile_response(request)

    def test_compile_exposes_canonical_auxiliary_indices(self) -> None:
        """Model auxiliary names remain available to the generated frontend runtime."""
        request = CompileRequest(elements=[ElementRequest(reference="Q1", use="2n3904", nodes={"E": "0", "B": "base", "C": "collector"})])

        result = _compile_response(request)

        self.assertIn('"Q1": {"v_be": 0, "v_bc": 1, "i_forward": 2, "i_reverse": 3}', result["javascript"])
        self.assertIn("evaluate_auxiliaries", result["javascript"])

    def test_identical_compile_requests_use_the_process_cache(self) -> None:
        """A normalized request is compiled only once while its entry remains cached."""
        request = CompileRequest(elements=[ElementRequest(reference="R1", use="resistor", nodes={"ref": "0", "p": "out"}, parameters={"resistance": 1_000})])
        artifact = {"wasm": "cached"}
        _compile_cache.clear()
        with patch("asweb.app._compile_response", return_value=artifact) as compile_response:
            first = _cached_compile_response(request, "first")
            second = _cached_compile_response(request, "second")

        self.assertIs(first, artifact)
        self.assertIs(second, artifact)
        compile_response.assert_called_once_with(request, "first")

    def test_busy_compiler_rejects_cache_misses(self) -> None:
        """A cache miss does not queue unbounded CPU work."""
        request = CompileRequest(elements=[])
        _compile_cache.clear()
        with patch("asweb.app._compile_slots") as slots:
            slots.acquire.return_value = False
            with self.assertRaises(_CompilationBusy):
                _cached_compile_response(request, "busy")


if __name__ == "__main__":
    unittest.main()
