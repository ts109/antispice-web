"""Small regression tests for the frontend's pure circuit operations."""

import pathlib
import shutil
import subprocess
import unittest


class FrontendCircuitTest(unittest.TestCase):
    """Exercise mutations that must preserve wire endpoint integrity."""

    def test_landing_page_is_initial_and_links_project_identity(self) -> None:
        """The initial document exposes the project card before the editor."""
        frontend = pathlib.Path(__file__).parents[1] / "src/asweb/frontend"
        document = (frontend / "index.html").read_text()

        self.assertIn('<body data-view="landing">', document)
        self.assertIn('id="enterEditor"', document)
        self.assertIn('id="showLanding"', document)
        self.assertIn("https://github.com/ts109/antispice", document)
        self.assertIn("https://github.com/ts109/antispice-web", document)
        self.assertIn("mailto:ts109@pm.me", document)
        self.assertIn("No cookies", document)
        self.assertIn("MIT License", document)
        self.assertIn('<meta name="viewport" content="width=device-width, initial-scale=1">', document)
        self.assertIn('href="./styles.css?v=39"', document)
        self.assertIn('src="./editor.js?v=59"', document)
        self.assertIn('id="manualHeading"', document)
        self.assertIn("The useful gestures.", document)
        self.assertNotIn("No specialist workflow required", document)

    def test_initial_wire_drawing_supports_provisional_waypoints(self) -> None:
        """Empty-grid taps add bends that are retained when a wire is completed."""
        frontend = pathlib.Path(__file__).parents[1] / "src/asweb/frontend"
        editor = (frontend / "editor.js").read_text()

        self.assertIn("drawingWire.waypoints.push(point)", editor)
        self.assertIn("createWire(drawingWire.startNode, nodeId, drawingWire.waypoints)", editor)
        self.assertIn("...drawingWire.waypoints, drawingWire.mouse", editor)
        self.assertIn('handle.classList.add("temp-waypoint")', editor)

    def test_tablet_editor_has_touch_targets_and_visible_properties(self) -> None:
        """Tablet layouts retain property editing and coarse-pointer hit areas."""
        frontend = pathlib.Path(__file__).parents[1] / "src/asweb/frontend"
        styles = (frontend / "styles.css").read_text()

        self.assertIn("#editor {", styles)
        self.assertIn("touch-action: none", styles)
        self.assertIn("@media (pointer: coarse)", styles)
        self.assertIn("@media (max-width: 820px)", styles)
        self.assertIn("#properties {display: block; grid-row: 2; grid-column: 2", styles)

    def test_mobile_editor_exposes_selection_deletion_and_adaptive_layouts(self) -> None:
        """Touch users get an explicit delete action in portrait and landscape layouts."""
        frontend = pathlib.Path(__file__).parents[1] / "src/asweb/frontend"
        document = (frontend / "index.html").read_text()
        editor = (frontend / "editor.js").read_text()
        styles = (frontend / "styles.css").read_text()

        self.assertEqual(document.count("data-delete-selection"), 2)
        self.assertIn('class="toolbar-brand"', document)
        self.assertIn('button.addEventListener("click", () => deleteSelected())', editor)
        self.assertIn("@media (max-width: 600px)", styles)
        self.assertIn("orientation: landscape", styles)
        self.assertIn("#toolbar .delete-selection:not(:disabled)", styles)
        self.assertIn("deliberately compact horizontal tool rail", styles)
        self.assertIn("grid-template-rows: 156px", styles)
        self.assertIn('componentsHeading"] {flex-basis: 364px; padding: 0 0 8px;', styles)

    def test_plot_resizes_with_its_panel_and_viewport(self) -> None:
        """The canvas follows CSS panel sizing and redraws after viewport changes."""
        frontend = pathlib.Path(__file__).parents[1] / "src/asweb/frontend"
        plot = (frontend / "plot.js").read_text()

        self.assertIn("this.resizeObserver.observe(root);", plot)
        self.assertIn('window.addEventListener("resize", () => this.refreshLayout())', plot)
        self.assertNotIn("canvas.style.width", plot)
        self.assertNotIn("canvas.style.height", plot)

    def test_editor_supports_two_finger_pinch_zoom(self) -> None:
        """Touch pointers drive a midpoint-anchored zoom without mouse changes."""
        frontend = pathlib.Path(__file__).parents[1] / "src/asweb/frontend"
        editor = (frontend / "editor.js").read_text()

        self.assertIn("const touchPointers = new Map();", editor)
        self.assertIn("function startPinch()", editor)
        self.assertIn("function updatePinch()", editor)
        self.assertIn('svg.addEventListener("pointerdown", event => {', editor)
        self.assertIn("let editorPan = null;", editor)
        self.assertIn("editorPan = {pointerId: event.pointerId", editor)

    def test_plot_supports_touch_pan_and_pinch_zoom(self) -> None:
        """Plots retain one-finger panning and add two-finger time-axis zooming."""
        frontend = pathlib.Path(__file__).parents[1] / "src/asweb/frontend"
        plot = (frontend / "plot.js").read_text()

        self.assertIn("trackTouchStart(event)", plot)
        self.assertIn("trackTouchMove(event)", plot)
        self.assertIn("function touchDistance([first, second])", plot)

    def test_editor_exposes_history_filter_and_contextual_actions(self) -> None:
        """High-value editor actions are available without modal dialogs."""
        frontend = pathlib.Path(__file__).parents[1] / "src/asweb/frontend"
        document = (frontend / "index.html").read_text()
        editor = (frontend / "editor.js").read_text()
        styles = (frontend / "styles.css").read_text()

        self.assertIn('data-history="undo"', document)
        self.assertIn("data-duplicate-selection", document)
        self.assertIn('id="componentFilter"', document)
        self.assertIn('id="plotFit"', document)
        self.assertIn("function commitHistory()", editor)
        self.assertIn("function duplicateSelected()", editor)
        self.assertIn("function moveSelected(dx, dy)", editor)
        self.assertIn("body.properties-collapsed", styles)
        self.assertIn("grid-template-rows: repeat(2, 42px)", styles)
        self.assertIn('id="fitSchematic"', document)
        self.assertIn('id="editorToast"', document)
        self.assertIn("function fitSchematic()", editor)
        self.assertIn("function showUndoToast(message)", editor)

    def test_component_browser_uses_library_topology(self) -> None:
        """The palette drills through categories and models before choosing parts."""
        frontend = pathlib.Path(__file__).parents[1] / "src/asweb/frontend"
        document = (frontend / "index.html").read_text()
        editor = (frontend / "editor.js").read_text()
        api = (frontend / "api.js").read_text()
        styles = (frontend / "styles.css").read_text()

        self.assertIn('id="componentBreadcrumb"', document)
        self.assertIn("export function libraryTopology()", api)
        self.assertIn("componentTrail.push", editor)
        self.assertIn("--breadcrumb-depth", editor)
        self.assertIn("appendComponentBrowserChoice", editor)
        self.assertIn('appendDefinitionChoice(location.reference, "model")', editor)
        self.assertIn('appendDefinitionChoice(part, "part")', editor)
        self.assertIn("margin-left: calc(var(--breadcrumb-depth) * 9px)", styles)

    def test_parameter_changes_do_not_rebuild_the_focused_property_form(self) -> None:
        """Native Tab navigation survives committing a parameter edit."""
        frontend = pathlib.Path(__file__).parents[1] / "src/asweb/frontend"
        editor = (frontend / "editor.js").read_text()
        update_start = editor.index("        const update = input => {")
        update_end = editor.index("        };", update_start)
        self.assertNotIn("renderProperties()", editor[update_start:update_end])
        self.assertIn("source.textContent", editor[update_start:update_end])

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

    def test_opamp_uses_a_dedicated_four_terminal_symbol(self) -> None:
        """The op-amp model has conventional signal, output, and supply pins."""
        node = shutil.which("node")
        if node is None:
            message = "Node.js is required to test frontend symbols"
            raise unittest.SkipTest(message)
        module = pathlib.Path(__file__).parents[1] / "src/asweb/frontend/library.js"
        source = """
const {library, modelPresentation} = await import(process.argv[1]);
const presentation = modelPresentation("opamp-slew-limited");
if (presentation?.symbol !== "opamp") process.exit(1);
if (library.opamp?.referencePrefix !== "A") process.exit(2);
const ports = Object.fromEntries(library.opamp.ports.map(port => [port.name, port]));
if (Object.keys(ports).length !== 5) process.exit(3);
if (!(ports.inverting.x < 0 && ports.inverting.y < 0)) process.exit(4);
if (!(ports.noninverting.x < 0 && ports.noninverting.y > 0)) process.exit(5);
if (!(ports.output.x > 0 && ports.output.y === 0)) process.exit(6);
if (!(ports.negative_supply.x === 0 && ports.negative_supply.y > 0)) process.exit(7);
if (!(ports.positive_supply.x === 0 && ports.positive_supply.y < 0)) process.exit(8);
if (typeof library.opamp.draw !== "function") process.exit(9);
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

    def test_phase_axis_uses_canonical_radian_ticks(self) -> None:
        """Phase lanes label the canonical fractions of pi in radians."""
        node = shutil.which("node")
        if node is None:
            message = "Node.js is required to test frontend plot axes"
            raise unittest.SkipTest(message)
        module = pathlib.Path(__file__).parents[1] / "src/asweb/frontend/plot.js"
        source = """
const {radianAxisTicks} = await import(process.argv[1]);
const ticks = radianAxisTicks(-Math.PI / 2, Math.PI / 2);
const expected = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2];
if (ticks.values.length !== expected.length || ticks.values.some((value, index) => value !== expected[index])) process.exit(1);
if (ticks.format(-Math.PI / 4) !== String.fromCodePoint(0x2212) + "π/4" || ticks.format(Math.PI / 2) !== "π/2") process.exit(2);
"""
        subprocess.run([node, "--input-type=module", "--eval", source, module.as_uri()], check=True)


if __name__ == "__main__":
    unittest.main()
