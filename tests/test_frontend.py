"""Small regression tests for the frontend's pure circuit operations."""

import pathlib
import shutil
import subprocess
import unittest


class FrontendCircuitTest(unittest.TestCase):
    """Exercise mutations that must preserve wire endpoint integrity."""

    def test_detaching_nodes_removes_every_incident_wire_before_cleanup(self) -> None:
        """Multiple wires on one terminal cannot leave a dangling replacement."""
        node = shutil.which("node")
        if node is None:
            message = "Node.js is required to test frontend circuit operations"
            raise unittest.SkipTest(message)
        module = pathlib.Path(__file__).parents[1] / "src/asweb/frontend/circuit.js"
        source = """
const {circuit, detachCircuitNodes} = await import(process.argv[1]);
circuit.nodes = new Map([[1, {id: 1}], [2, {id: 2}], [3, {id: 3}]]);
circuit.wires = new Map([
  [1, {id: 1, a: 1, b: 2}],
  [2, {id: 2, a: 1, b: 3}],
]);
const {neighbors, removedWires} = detachCircuitNodes([1]);
if (circuit.nodes.has(1) || circuit.wires.size !== 0) process.exit(1);
if (removedWires.length !== 2 || !neighbors.has(2) || !neighbors.has(3)) process.exit(2);
"""
        subprocess.run([node, "--input-type=module", "--eval", source, module.as_uri()], check=True)

    def test_model_family_prefixes_are_classified(self) -> None:
        """Related model implementations share one frontend family."""
        node = shutil.which("node")
        if node is None:
            message = "Node.js is required to test frontend model families"
            raise unittest.SkipTest(message)
        module = pathlib.Path(__file__).parents[1] / "src/asweb/frontend/library.js"
        source = """
const {modelFamily} = await import(process.argv[1]);
if (modelFamily("bjt-ebers-moll") !== "bjt-") process.exit(1);
if (modelFamily("bjt-gummel-poon") !== "bjt-") process.exit(2);
if (modelFamily("resistor") !== null) process.exit(3);
"""
        subprocess.run([node, "--input-type=module", "--eval", source, module.as_uri()], check=True)


if __name__ == "__main__":
    unittest.main()
