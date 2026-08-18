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

    def test_ac_input_markers_are_registered_as_frontend_markers(self) -> None:
        """AC toolbar tools must resolve to marker definitions, not components."""
        node = shutil.which("node")
        if node is None:
            message = "Node.js is required to test frontend marker definitions"
            raise unittest.SkipTest(message)
        module = pathlib.Path(__file__).parents[1] / "src/asweb/frontend/library.js"
        source = """
const {library} = await import(process.argv[1]);
if (library.ACV?.kind !== "marker" || library.ACV?.acInputType !== "voltage") process.exit(1);
if (library.ACI?.kind !== "marker" || library.ACI?.acInputType !== "current") process.exit(2);
if (typeof library.ACV.draw !== "function" || typeof library.ACI.draw !== "function") process.exit(3);
"""
        subprocess.run([node, "--input-type=module", "--eval", source, module.as_uri()], check=True)

    def test_circuit_snapshot_round_trip_restores_sets_and_id_counters(self) -> None:
        """Saved editor data can be loaded before allocating collision-free IDs."""
        node = shutil.which("node")
        if node is None:
            message = "Node.js is required to test frontend persistence"
            raise unittest.SkipTest(message)
        module = pathlib.Path(__file__).parents[1] / "src/asweb/frontend/circuit.js"
        source = """
const {circuit, replaceCircuit, serializeCircuit, takeId} = await import(process.argv[1]);
replaceCircuit({
  version: 1,
  elements: [{id: 4, model: "resistor", use: "resistor", ports: [8, 9], parameters: {resistance: 1000}}],
  markers: [],
  nodes: [{id: 8, kind: "terminal"}, {id: 9, kind: "terminal"}],
  wires: [{id: 3, a: 8, b: 9, waypoints: [{id: 12, x: 10, y: 20}], points: []}],
  nets: [{id: 6, name: "OUT", members: [8, 9]}],
});
if (!(circuit.nets.get(6).members instanceof Set)) process.exit(1);
const snapshot = serializeCircuit();
if (snapshot.nets[0].name !== "OUT" || snapshot.nets[0].members.length !== 2) process.exit(2);
if (takeId("element") !== 5 || takeId("node") !== 10 || takeId("wire") !== 4 || takeId("waypoint") !== 13) process.exit(3);
"""
        subprocess.run([node, "--input-type=module", "--eval", source, module.as_uri()], check=True)

    def test_schematic_store_restores_active_records(self) -> None:
        """Persistence records remain independent from DOM rendering."""
        node = shutil.which("node")
        if node is None:
            message = "Node.js is required to test frontend persistence"
            raise unittest.SkipTest(message)
        module = pathlib.Path(__file__).parents[1] / "src/asweb/frontend/schematics.js"
        source = """
const {SchematicStore} = await import(process.argv[1]);
const values = new Map();
const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
const first = new SchematicStore(storage, "test");
const original = first.active();
first.rename("AMPLIFIER");
first.save({version: 1, elements: [{id: 1}], markers: [], nodes: [], wires: [], nets: []});
const second = first.create();
first.persist();
const restored = new SchematicStore(storage, "test");
if (restored.active().id !== second.id || restored.list().length !== 2) process.exit(1);
if (restored.select(original.id).name !== "AMPLIFIER") process.exit(2);
if (restored.active().circuit.elements[0].id !== 1) process.exit(3);
"""
        subprocess.run([node, "--input-type=module", "--eval", source, module.as_uri()], check=True)

    def test_simulation_configuration_is_owned_by_simulation_module(self) -> None:
        """Simulation validation converts the UI's text fields in one place."""
        node = shutil.which("node")
        if node is None:
            message = "Node.js is required to test frontend simulation"
            raise unittest.SkipTest(message)
        module = pathlib.Path(__file__).parents[1] / "src/asweb/frontend/simulation.js"
        source = """
const {createTransientState, transientConfiguration} = await import(process.argv[1]);
const state = createTransientState();
Object.assign(state, {endTime: "1", minimumStepSize: "1e-6", maximumStepSize: "1e-2"});
const configuration = transientConfiguration(state);
if (configuration.minimumStepSize !== 1e-6 || configuration.maximumStepSize !== 1e-2) process.exit(1);
state.maximumStepSize = "1e-7";
try { transientConfiguration(state); process.exit(2); } catch (error) {
  if (!error.message.includes("must not be smaller")) process.exit(3);
}
"""
        subprocess.run([node, "--input-type=module", "--eval", source, module.as_uri()], check=True)

    def test_ac_configuration_and_logarithmic_frequency_grid(self) -> None:
        """AC controls produce exactly the requested logarithmic query points."""
        node = shutil.which("node")
        if node is None:
            message = "Node.js is required to test frontend AC analysis"
            raise unittest.SkipTest(message)
        module = pathlib.Path(__file__).parents[1] / "src/asweb/frontend/ac.js"
        source = """
const {acConfiguration, createACState, logarithmicFrequencies} = await import(process.argv[1]);
const state = createACState();
Object.assign(state, {minimumFrequency: "10", maximumFrequency: "1000", pointCount: "3"});
const configuration = acConfiguration(state);
const frequencies = logarithmicFrequencies(configuration.minimumFrequency, configuration.maximumFrequency, configuration.pointCount);
if (frequencies.length !== 3 || frequencies[0] !== 10 || frequencies[1] !== 100 || frequencies[2] !== 1000) process.exit(1);
state.minimumFrequency = "0";
try { acConfiguration(state); process.exit(2); } catch (error) {
  if (!error.message.includes("positive")) process.exit(3);
}
"""
        subprocess.run([node, "--input-type=module", "--eval", source, module.as_uri()], check=True)


if __name__ == "__main__":
    unittest.main()
