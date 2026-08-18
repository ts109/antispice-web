import {availableDefinitions, inheritedParameters, loadLibrary, resolveModel, resolveModelName} from "./api.js?v=2";
import {acConfiguration, compileACSimulation, createACState, runACSweeps} from "./ac.js?v=1";
import {definitionDisplayName, ensureGenericSymbol, library, modelFamily, modelPresentation} from "./library.js?v=16";
import {GRID, distance, rotatePoint, rotatedAxis, routeOrthogonally, snap, snapPoint} from "./routing.js?v=11";
import {circuit, detachCircuitNodes, generateCompilationElements, generateNetlist, netForNode, netNameError, nextReference, nodeAnchor, nodeDegree, nodePosition, rebuildNets as rebuildCircuitNets, referenceError, replaceCircuit, serializeCircuit, takeId, withImmutableId} from "./circuit.js?v=15";
import {TransientPlot, logarithmicAxisTicks} from "./plot.js?v=7";
import {emptyCircuitSnapshot, SchematicStore} from "./schematics.js?v=1";
import {compileSimulation, createTransientState, runTransient, transientConfiguration} from "./simulation.js?v=2";

const NS = "http://www.w3.org/2000/svg";
window.generateNetlist = generateNetlist;
function rebuildNets() {
    rebuildCircuitNets();
    renderLists();
    updateStatus();
    scheduleSchematicSave();
}

const svg = document.querySelector("#editor");
const wireLayer = document.querySelector("#wireLayer");
const junctionLayer = document.querySelector("#junctionLayer");
const elementLayer = document.querySelector("#elementLayer");
const overlayLayer = document.querySelector("#overlayLayer");
const propertyContent = document.querySelector("#propertyContent");
const elementList = document.querySelector("#elementList");
const markerList = document.querySelector("#markerList");
const acInputList = document.querySelector("#acInputList");
const netList = document.querySelector("#netList");
const elementsHeading = document.querySelector("#elementsHeading");
const netsHeading = document.querySelector("#netsHeading");
const propertiesHeading = document.querySelector("#propertiesHeading");
const plotHeading = document.querySelector("#plotHeading");
const componentTools = document.querySelector("#componentTools");
const statusMode = document.querySelector("#statusMode");
const statusZoom = document.querySelector("#statusZoom");
const statusElements = document.querySelector("#statusElements");
const statusNets = document.querySelector("#statusNets");
const statusWires = document.querySelector("#statusWires");
const statusState = document.querySelector("#statusState");
const transientPlot = new TransientPlot(document.querySelector("#transientPlot"));
const schematicName = document.querySelector("#schematicName");
const savedSchematics = document.querySelector("#savedSchematics");
const newSchematicButton = document.querySelector("#newSchematic");
const saveSchematicButton = document.querySelector("#saveSchematic");
const loadSchematicButton = document.querySelector("#loadSchematic");

const schematicStore = new SchematicStore(localStorage);
let saveTimer = null;

function writeSchematicStore() {
    try {
        schematicStore.persist();
        statusState.textContent = "SAVED";
    } catch {
        statusState.textContent = "SAVE ERROR";
    }
}

function renderSchematicControls() {
    const active = schematicStore.active();
    schematicName.value = active?.name ?? "";
    savedSchematics.replaceChildren();
    for (const record of schematicStore.list()) {
        const option = document.createElement("option");
        option.value = record.id;
        option.textContent = record.name;
        option.selected = record.id === active?.id;
        savedSchematics.append(option);
    }
    loadSchematicButton.disabled = !application.libraryReady || !savedSchematics.value;
}

function saveActiveSchematic() {
    if (!application.libraryReady) return;
    if (!schematicStore.save(serializeCircuit())) return;
    writeSchematicStore();
    renderSchematicControls();
}

function scheduleSchematicSave() {
    if (!application?.libraryReady) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveActiveSchematic();
    }, 250);
}

function displayCircuitSnapshot(snapshot) {
    cancelCurrentOperation();
    selected = null;
    replaceCircuit(snapshot);
    rebuildCircuitNets();
    elementLayer.replaceChildren();
    wireLayer.replaceChildren();
    junctionLayer.replaceChildren();
    overlayLayer.replaceChildren();
    for (const element of circuit.elements.values()) {
        element.use ??= element.model;
        element.electricalPorts ??= resolveModel(element.use)?.ports ?? library[element.model]?.ports.map(port => port.name) ?? [];
        renderElement(element);
    }
    for (const marker of circuit.markers.values()) {
        if (isACInputMarker(marker) && !marker.reference) marker.reference = nextACInputReference();
    }
    renderAllMarkers();
    renderAllJunctions();
    renderAllWires();
    renderLists();
    renderProperties();
    updateStatus();
}

function loadStoredSchematic(id) {
    const record = schematicStore.select(id);
    if (!record) return;
    if (application.mode !== "edit") setMode("edit");
    displayCircuitSnapshot(record.circuit);
    writeSchematicStore();
    renderSchematicControls();
}


// ============================================================================
// Editor state
// ============================================================================

// null = normal/select mode
// Library key = temporary one-shot placement
let placingType = null;
let selected = null;
let mousePosition = {x: 0, y: 0};
let placingPosition = null;
let drawingWire = null;
let draggingElement = null;
let draggingMarker = null;
let segmentDrag = null;
let junctionDrag = null;
let viewport = {x: 0, y: 0, width: 0, height: 0};
let viewportPixels = {width: 0, height: 0};
const ZOOM_FACTORS = [15, 18, 22, 27, 33, 39, 47, 56, 68, 82, 100, 120, 150, 180, 220, 270, 330, 390];
const application = {
    mode: "edit",
    libraryReady: false,
    libraryError: "",
    compilation: {state: "idle", message: "", solver: null},
    transient: createTransientState(),
    acCompilation: {state: "idle", message: "", solver: null},
    ac: createACState(),
};

function activeAnalysis() {
    return application.mode === "ac" ? application.ac : application.transient;
}

function symbolForDefinition(use, overrides = {}) {
    const resolved = resolveModel(use);
    const resolvedName = resolveModelName(use);
    if (!resolved) return null;
    const parameters = {...inheritedParameters(use), ...overrides};
    const negative = Number(parameters.polarity) < 0;
    const presentation = modelPresentation(resolvedName, negative);
    if (presentation) return presentation.symbol;
    if (library[resolvedName]) return resolvedName;
    return ensureGenericSymbol(`generic:${resolvedName ?? use}`, resolved.ports);
}

function bindToolButton(button) {
    button.addEventListener("click", () => {
        const type = button.dataset.tool;
        if (type === "select") cancelCurrentOperation();
        else enterPlacementMode(type);
    });
}

function rebuildComponentTools() {
    componentTools.replaceChildren();
    for (const [name, definition] of Object.entries(availableDefinitions())) {
        if (definition.type === "part") continue;
        const button = document.createElement("button");
        const label = document.createElement("span");
        const reference = document.createElement("small");
        const resolvedName = resolveModelName(name);
        button.type = "button";
        button.dataset.tool = name;
        label.textContent = definitionDisplayName(name, definition, resolvedName);
        label.className = "component-name";
        reference.textContent = name;
        reference.className = "component-reference";
        button.title = `${name} (${definition.type})`;
        button.append(label);
        if (label.textContent !== name) button.append(reference);
        bindToolButton(button);
        componentTools.append(button);
    }
}

function compatibleDefinitions(use) {
    const currentModel = resolveModelName(use);
    const currentFamily = modelFamily(currentModel);
    return Object.entries(availableDefinitions()).filter(([name]) => {
        const candidateModel = resolveModelName(name);
        return currentFamily ? modelFamily(candidateModel) === currentFamily : candidateModel === currentModel;
    });
}


// ============================================================================
// Mode handling
// ============================================================================

function enterSelectMode() {
    placingType = null;
    placingPosition = null;

    updateToolbar();
    renderOverlay();
}


function enterPlacementMode(type) {
    if (application.mode !== "edit" || !application.libraryReady) {
        return;
    }
    placingType = type;

    // Starting placement cancels unfinished wiring.
    drawingWire = null;
    placingPosition = {...mousePosition};

    updateToolbar();
    renderOverlay();
}


function cancelCurrentOperation() {
    placingType = null;
    placingPosition = null;

    drawingWire = null;

    draggingElement = null;
    draggingMarker = null;
    segmentDrag = null;
    junctionDrag = null;

    updateToolbar();
    renderOverlay();
}


function updateToolbar() {
    for (const button of document.querySelectorAll("#toolbar [data-mode]")) {
        button.classList.toggle("active", button.dataset.mode === application.mode);
    }

    for (const button of document.querySelectorAll("#toolbar [data-tool]")) {
        const type = button.dataset.tool;
        const active = placingType === null ? type === "select" : type === placingType;

        button.classList.toggle("active", active);
    }

    for (const button of document.querySelectorAll("#toolbar [data-rotate]")) {
        button.disabled = application.mode !== "edit" || selected?.kind !== "element" && selected?.kind !== "marker";
    }
}

function setMode(mode) {
    if (mode === application.mode && document.body.dataset.mode) {
        return;
    }
    application.mode = mode;
    const analysis = activeAnalysis();
    analysis.visibleNets.clear();
    analysis.visibleElementSignals.clear();
    document.body.dataset.mode = mode;
    if (mode === "simulation") {
        transientPlot.setHorizontalAxis("TIME / s", {format: value => `${formatPlotValue(value)} s`});
        plotHeading.textContent = "TRANSIENT / 0001";
        transientPlot.refreshLayout();
        startSimulation();
    } else if (mode === "ac") {
        transientPlot.setHorizontalAxis("FREQUENCY / Hz", {
            format: value => `${formatPlotValue(10 ** value)} Hz`,
            ticks: logarithmicAxisTicks,
        });
        plotHeading.textContent = "SMALL-SIGNAL AC / 0001";
        transientPlot.refreshLayout();
        startACSimulation();
    }
    elementsHeading.textContent = mode === "edit" ? "Elements" : "Element signals";
    netsHeading.textContent = mode === "edit" ? "Nets" : "Net potentials";
    propertiesHeading.textContent = mode === "edit" ? "Properties" : mode === "ac" ? "AC analysis" : "Transient signals";
    cancelCurrentOperation();
    selected = null;
    for (const element of circuit.elements.values()) {
        renderElement(element);
    }
    renderAllMarkers();
    renderAllJunctions();
    renderAllWires();
    renderLists();
    renderProperties();
    updateStatus();
}

function formatPlotValue(value) {
    if (value === 0) return "0";
    const magnitude = Math.abs(value);
    return magnitude >= 1e4 || magnitude < 1e-3 ? value.toExponential(2) : value.toPrecision(4).replace(/\.?0+$/, "");
}

async function startSimulation() {
    const pendingCompilation = {state: "working", message: "Compiling circuit…", solver: null};
    application.compilation = pendingCompilation;
    application.transient.state = "idle";
    application.transient.message = "";
    application.transient.result = null;
    transientPlot.setData(null);
    document.body.setAttribute("aria-busy", "true");
    updateStatus();
    renderProperties();
    try {
        const runtime = await compileSimulation(generateCompilationElements(resolveModel));
        if (application.compilation !== pendingCompilation) return;
        application.compilation = {state: "ready", message: `Compiled ${runtime.stateSize} state variables.`, ...runtime};
        refreshTransientPlot();
    } catch (error) {
        if (application.compilation !== pendingCompilation) return;
        application.compilation = {state: "error", message: error.message, solver: null};
    } finally {
        document.body.toggleAttribute(
            "aria-busy",
            application.compilation.state === "working" || application.acCompilation.state === "working",
        );
        updateStatus();
    }
    if (application.mode === "simulation") renderProperties();
}

function isACInputMarker(marker) {
    return marker?.type === "ACV" || marker?.type === "ACI";
}

function nextACInputReference() {
    let index = 1;
    const references = new Set([...circuit.markers.values()].filter(isACInputMarker).map(marker => marker.reference));
    while (references.has(`AC${index}`)) ++index;
    return `AC${index}`;
}

function acCompilationInputs() {
    return [...circuit.markers.values()].filter(isACInputMarker).map(marker => ({
        reference: marker.reference,
        type: library[marker.type].acInputType,
        net: netForNode(marker.ports[0]).name,
    }));
}

async function startACSimulation() {
    const inputs = acCompilationInputs();
    const pendingCompilation = {state: "working", message: "Compiling AC analysis…", solver: null};
    application.acCompilation = pendingCompilation;
    application.ac.state = "idle";
    application.ac.message = "";
    application.ac.results = new Map();
    transientPlot.setData(null);
    document.body.setAttribute("aria-busy", "true");
    updateStatus();
    renderProperties();
    try {
        if (!inputs.length) throw new Error("Place at least one AC voltage or current input marker.");
        const runtime = await compileACSimulation(generateCompilationElements(resolveModel), inputs);
        if (application.acCompilation !== pendingCompilation) return;
        application.acCompilation = {state: "ready", message: `Compiled ${inputs.length} independent AC case${inputs.length === 1 ? "" : "s"}.`, ...runtime};
        if (!inputs.some(input => input.reference === application.ac.selectedInput)) {
            application.ac.selectedInput = inputs[0].reference;
        }
        refreshACPlot();
    } catch (error) {
        if (application.acCompilation !== pendingCompilation) return;
        application.acCompilation = {state: "error", message: error.message, solver: null};
    } finally {
        document.body.toggleAttribute(
            "aria-busy",
            application.compilation.state === "working" || application.acCompilation.state === "working",
        );
        updateStatus();
    }
    if (application.mode === "ac") {
        renderLists();
        renderProperties();
    }
}

async function runACSimulation() {
    const {solver, layout} = application.acCompilation;
    if (!solver || application.ac.state === "running") return;
    try {
        const configuration = acConfiguration(application.ac);
        application.ac.state = "running";
        application.ac.message = "Running AC sweeps…";
        application.ac.results = new Map();
        transientPlot.setData(null);
        renderProperties();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const {operatingPoint, results} = runACSweeps(solver, layout, configuration);
        application.ac.results = results;
        application.ac.state = "complete";
        application.ac.message = `Operating point converged in ${operatingPoint.iterations} iterations. Solved ${results.size} AC case${results.size === 1 ? "" : "s"}.`;
        refreshACPlot();
    } catch (error) {
        application.ac.state = "error";
        application.ac.message = error.message;
    }
    if (application.mode === "ac") renderProperties();
}

async function runTransientSimulation() {
    const solver = application.compilation.solver;
    if (!solver || application.transient.state === "running") return;
    try {
        const configuration = transientConfiguration(application.transient);
        application.transient.state = "running";
        application.transient.message = "Running transient simulation…";
        application.transient.result = null;
        transientPlot.setData(null);
        renderProperties();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const {operatingPoint, result} = runTransient(solver, configuration);
        application.transient.result = result;
        transientPlot.setData(application.transient.result);
        refreshTransientPlot();
        application.transient.state = "complete";
        application.transient.message = `Operating point converged in ${operatingPoint.iterations} iterations. Accepted ${application.transient.result.acceptedSteps} adaptive steps, rejected ${application.transient.result.rejectedSteps}.`;
    } catch (error) {
        application.transient.state = "error";
        application.transient.message = error.message;
    }
    if (application.mode === "simulation") renderProperties();
}

function updateStatus() {
    const scale = viewportPixels.width && viewport.width ? viewport.width / viewportPixels.width : 1;
    const compilation = application.mode === "ac" ? application.acCompilation : application.compilation;
    const compiling = application.mode !== "edit" && compilation.state === "working";
    statusMode.classList.toggle("compiling", compiling);
    statusMode.replaceChildren();
    if (compiling) {
        statusMode.append("COMPILING");
        const dots = document.createElement("span");
        dots.className = "compiling-dots";
        dots.setAttribute("aria-hidden", "true");
        for (let index = 0; index < 3; ++index) {
            const dot = document.createElement("i");
            dot.textContent = ".";
            dots.append(dot);
        }
        statusMode.append(dots);
        statusMode.setAttribute("aria-label", "Compiling circuit");
    } else {
        statusMode.textContent = application.mode === "edit" ? "EDIT" : application.mode === "ac" ? "AC" : "SIMULATE";
        statusMode.removeAttribute("aria-label");
    }
    statusZoom.textContent = `${Math.round(100 / scale)}%`;
    statusElements.textContent = circuit.elements.size;
    statusNets.textContent = circuit.nets.size;
    statusWires.textContent = circuit.wires.size;
    statusState.textContent = application.mode === "edit" ? "EDITABLE" : "FROZEN";
}

function toggleSet(set, value) {
    if (set.has(value)) {
        set.delete(value);
    }
    else {
        set.add(value);
    }
}

function toggleNetVoltage(nodeId) {
    const netName = netForNode(nodeId).name;
    if (netName === "0") {
        return;
    }
    toggleSet(activeAnalysis().visibleNets, netName);
    renderAllMarkers();
    renderAllJunctions();
    renderAllWires();
    renderLists();
    renderProperties();
    refreshAnalysisPlot();
}

function toggleElementSignal(element, signalName) {
    const analysis = activeAnalysis();
    if (!analysis.visibleElementSignals.has(element.reference)) {
        analysis.visibleElementSignals.set(element.reference, new Set());
    }
    const signals = analysis.visibleElementSignals.get(element.reference);
    toggleSet(signals, signalName);
    if (!signals.size) {
        analysis.visibleElementSignals.delete(element.reference);
    }
    renderElement(element);
    renderLists();
    renderProperties();
    refreshAnalysisPlot();
}

function refreshAnalysisPlot() {
    if (application.mode === "ac") refreshACPlot();
    else refreshTransientPlot();
}

function refreshTransientPlot() {
    const layout = application.compilation.layout;
    const traces = [];
    if (layout) {
        for (const net of application.transient.visibleNets) {
            const index = layout.potentials[net];
            if (index !== undefined) traces.push({label: `φ(${net})`, unit: "V", index});
        }
        for (const [reference, signals] of application.transient.visibleElementSignals) {
            const direct = layout.currents[reference] ?? {};
            const element = [...circuit.elements.values()].find(candidate => candidate.reference === reference);
            const model = resolveModel(element?.use);
            const portNodes = new Map((model?.ports ?? []).map((port, index) => [port, netForNode(element.ports[index]).name]));
            const referencePort = model?.ports[0];
            for (const signal of signals) {
                const kind = signal.slice(0, 2);
                const name = signal.slice(2);
                if (kind === "I:") {
                    const index = direct[name];
                    traces.push(index !== undefined
                        ? {label: `${reference}.I_${name}`, unit: "A", index}
                        : {label: `${reference}.I_${name}`, unit: "A", indices: Object.values(direct), coefficient: -1});
                } else if (kind === "U:") {
                    const positive = layout.potentials[portNodes.get(name)] ?? null;
                    const negative = layout.potentials[portNodes.get(referencePort)] ?? null;
                    traces.push({label: `${reference}.U_${name}`, unit: "V", terms: [[positive, 1], [negative, -1]]});
                } else if (kind === "A:") {
                    const index = layout.auxiliaries?.[reference]?.[name];
                    if (index !== undefined) traces.push({label: `${reference}.${name}`, unit: auxiliaryUnit(name), auxiliaryIndex: index});
                }
            }
        }
    }
    transientPlot.setTraces(traces);
    transientPlot.refreshLayout();
}

function refreshACPlot() {
    const layout = application.acCompilation.layout;
    const result = application.ac.results.get(application.ac.selectedInput);
    if (!layout || !result) {
        transientPlot.setData(null);
        transientPlot.setTraces([]);
        return;
    }
    const analysisCase = layout.acCases.find(candidate => candidate.reference === application.ac.selectedInput);
    const inputUnit = analysisCase?.type === "voltage" ? "V" : "A";
    const traces = [];
    const appendResponse = (label, outputUnit, descriptor) => {
        const {real, imaginary} = acSignalValues(result, descriptor);
        const magnitude = new Float64Array(result.sampleCount);
        const phase = new Float64Array(result.sampleCount);
        for (let sample = 0; sample < result.sampleCount; ++sample) {
            magnitude[sample] = Math.hypot(real[sample], imaginary[sample]);
            phase[sample] = Math.atan2(imaginary[sample], real[sample]);
        }
        traces.push({label: `|${label}|`, unit: `${outputUnit}/${inputUnit}`, values: magnitude, scale: "log-if-positive"});
        traces.push({label: `∠${label}`, unit: "rad", values: phase});
    };
    for (const net of application.ac.visibleNets) {
        const index = layout.potentials[net];
        if (index !== undefined) appendResponse(`φ(${net})`, "V", {index});
    }
    for (const [reference, signals] of application.ac.visibleElementSignals) {
        const direct = layout.currents[reference] ?? {};
        const element = [...circuit.elements.values()].find(candidate => candidate.reference === reference);
        const model = resolveModel(element?.use);
        const portNodes = new Map((model?.ports ?? []).map((port, index) => [port, netForNode(element.ports[index]).name]));
        const referencePort = model?.ports[0];
        for (const signal of signals) {
            const kind = signal.slice(0, 2);
            const name = signal.slice(2);
            if (kind === "I:") {
                const index = direct[name];
                appendResponse(
                    `${reference}.I_${name}`,
                    "A",
                    index !== undefined ? {index} : {terms: Object.values(direct).map(currentIndex => [currentIndex, -1])},
                );
            } else if (kind === "U:") {
                const positive = layout.potentials[portNodes.get(name)] ?? null;
                const negative = layout.potentials[portNodes.get(referencePort)] ?? null;
                appendResponse(`${reference}.U_${name}`, "V", {terms: [[positive, 1], [negative, -1]]});
            } else if (kind === "A:") {
                const index = layout.auxiliaries?.[reference]?.[name];
                if (index !== undefined) appendResponse(`${reference}.${name}`, auxiliaryUnit(name) || "1", {auxiliaryIndex: index});
            }
        }
    }
    transientPlot.setData({
        ...result,
        times: Float64Array.from(result.frequencies, Math.log10),
    });
    transientPlot.setTraces(traces);
    transientPlot.refreshLayout();
}

function acSignalValues(result, descriptor) {
    const real = new Float64Array(result.sampleCount);
    const imaginary = new Float64Array(result.sampleCount);
    for (let sample = 0; sample < result.sampleCount; ++sample) {
        if (descriptor.auxiliaryIndex !== undefined) {
            const offset = sample * result.auxiliaryCount + descriptor.auxiliaryIndex;
            real[sample] = result.auxiliaryReal[offset];
            imaginary[sample] = result.auxiliaryImaginary[offset];
            continue;
        }
        const terms = descriptor.index !== undefined ? [[descriptor.index, 1]] : descriptor.terms;
        for (const [index, coefficient] of terms) {
            if (index === null) continue;
            const offset = sample * result.stateSize + index;
            real[sample] += coefficient * result.realStates[offset];
            imaginary[sample] += coefficient * result.imaginaryStates[offset];
        }
    }
    return {real, imaginary};
}

function netVoltageVisible(nodeId) {
    const netName = netForNode(nodeId).name;
    return netName !== "0" && activeAnalysis().visibleNets.has(netName);
}

function elementSignalVisible(element, signalName) {
    return activeAnalysis().visibleElementSignals.get(element.reference)?.has(signalName) ?? false;
}

function auxiliaryUnit(name) {
    if (/^(v_|voltage)/i.test(name)) return "V";
    if (/^(i_|current)/i.test(name)) return "A";
    return "";
}


for (const button of document.querySelectorAll("#toolbar [data-tool]")) bindToolButton(button);

for (const button of document.querySelectorAll("#toolbar [data-rotate]")) {
    button.addEventListener("click", () => rotateSelected(Number(button.dataset.rotate)));
}

for (const button of document.querySelectorAll("#toolbar [data-mode]")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
}

newSchematicButton.disabled = true;
saveSchematicButton.disabled = true;
loadSchematicButton.disabled = true;
writeSchematicStore();
renderSchematicControls();

newSchematicButton.addEventListener("click", () => {
    saveActiveSchematic();
    const record = schematicStore.create();
    displayCircuitSnapshot(record.circuit);
    writeSchematicStore();
    renderSchematicControls();
});

saveSchematicButton.addEventListener("click", () => saveActiveSchematic());
loadSchematicButton.addEventListener("click", () => {
    const target = savedSchematics.value;
    saveActiveSchematic();
    loadStoredSchematic(target);
});

schematicName.addEventListener("input", () => {
    const record = schematicStore.rename(schematicName.value);
    if (!record) return;
    writeSchematicStore();
    const option = [...savedSchematics.options].find(candidate => candidate.value === record.id);
    if (option) option.textContent = record.name;
});

propertyContent.addEventListener("input", () => scheduleSchematicSave());
propertyContent.addEventListener("change", () => scheduleSchematicSave());
window.addEventListener("beforeunload", () => saveActiveSchematic());


// Initial/default mode.
setMode("edit");
loadLibrary().then(() => {
    application.libraryReady = true;
    rebuildComponentTools();
    const active = schematicStore.active();
    try {
        displayCircuitSnapshot(active.circuit);
    } catch {
        active.circuit = emptyCircuitSnapshot();
        displayCircuitSnapshot(active.circuit);
        writeSchematicStore();
    }
    newSchematicButton.disabled = false;
    saveSchematicButton.disabled = false;
    renderSchematicControls();
}).catch(error => {
    application.libraryError = error.message;
    propertyContent.textContent = error.message;
});


// ============================================================================
// Canvas events
// ============================================================================

new ResizeObserver(() => resizeViewport()).observe(svg);

svg.addEventListener("wheel", event => {
    event.preventDefault();
    if (!event.deltaY || !viewportPixels.width || !viewport.width) {
        return;
    }
    const point = svgPoint(event);
    const currentScale = viewport.width / viewportPixels.width;
    const currentZoom = 100 / currentScale;
    const currentIndex = ZOOM_FACTORS.reduce((best, zoom, index) => Math.abs(zoom - currentZoom) < Math.abs(ZOOM_FACTORS[best] - currentZoom) ? index : best, 0);
    const targetIndex = Math.min(ZOOM_FACTORS.length - 1, Math.max(0, currentIndex + (event.deltaY < 0 ? 1 : -1)));
    if (targetIndex === currentIndex) {
        return;
    }
    const targetScale = 100 / ZOOM_FACTORS[targetIndex];
    const ratio = targetScale / currentScale;
    viewport.x = point.x - (point.x - viewport.x) * ratio;
    viewport.y = point.y - (point.y - viewport.y) * ratio;
    viewport.width = viewportPixels.width * targetScale;
    viewport.height = viewportPixels.height * targetScale;
    updateViewBox();
}, {passive: false});

svg.addEventListener(
    "pointermove",
    event => {

        const raw = svgPoint(event);
        const p = snapPoint(raw);

        mousePosition = p;

        // --------------------------------------------------
        // Component preview
        // --------------------------------------------------
        if (placingType !== null) {
            placingPosition = p;
            renderOverlay();
        }

        // --------------------------------------------------
        // Component dragging
        // --------------------------------------------------
        if (draggingElement) {
            const element = circuit.elements.get(draggingElement);

            element.x = p.x;
            element.y = p.y;

            updateTerminalNodes(element);

            renderElement(element);
            renderAllWires();
        }

        if (draggingMarker) {
            const marker = circuit.markers.get(draggingMarker);
            marker.x = p.x;
            marker.y = p.y;
            updateTerminalNodes(marker);
            renderMarker(marker);
            renderAllWires();
        }


        // --------------------------------------------------
        // Wire drawing preview
        // --------------------------------------------------
        if (drawingWire) {
            drawingWire.mouse = p;
            renderOverlay();
        }


        // --------------------------------------------------
        // Wire segment dragging
        // --------------------------------------------------
        if (segmentDrag) {
            const d = distance(raw, segmentDrag.startMouse);

            if (d > 3)
                segmentDrag.moved = true;

            if (segmentDrag.moved)
                dragWireSegment(segmentDrag, raw);
        }

        if (junctionDrag) {
            if (distance(raw, junctionDrag.startMouse) > 3) {
                junctionDrag.moved = true;
            }
            if (junctionDrag.moved) {
                moveJunction(junctionDrag.id, p);
            }
        }
    }
);


svg.addEventListener("pointerdown", event => {
        if (event.target !== svg)
            return;

        if (application.mode !== "edit") {
            return;
        }

        // --------------------------------------------------
        // Place component
        // --------------------------------------------------
        if (placingType !== null) {
            const p = snapPoint(svgPoint(event));
            const type = placingType;
            const marker = library[type]?.kind === "marker";
            const object = marker ? createMarker(type, p.x, p.y) : createElement(type, p.x, p.y);

            // One-shot placement.
            enterSelectMode();

            select({
                kind: marker ? "marker" : "element",
                id: object.id
            });

            return;
        }

        // --------------------------------------------------
        // Empty canvas
        // --------------------------------------------------

        drawingWire = null;

        select(null);
        renderOverlay();
    }
);


window.addEventListener("pointerup", () => {
        if (application.mode !== "edit") {
            return;
        }
        finishSegmentDrag();
        if (junctionDrag && !junctionDrag.moved) {
            handleNodeClick(junctionDrag.id);
        }
        draggingElement = null;
        draggingMarker = null;
        segmentDrag = null;
        junctionDrag = null;
        scheduleSchematicSave();
    }
);


window.addEventListener("keydown", event => {
    if (application.mode !== "edit") {
        return;
    }
    /*
     * Don't do anything while editing text in the properties panel.
     */
    if (document.activeElement?.tagName !== "INPUT")
    {
        switch (event.key)
        {
            case "Backspace":
            case "Delete":
                event.preventDefault();
                deleteSelected();
                break;

            case "Escape":
                cancelCurrentOperation();
                select(null);
                break;

            case "ArrowLeft":
                rotateSelected(-90);
                break;

            case "ArrowRight":
                rotateSelected(90);
                break;
        }
    }
});


// ============================================================================
// Components
// ============================================================================

function createElement(use, x, y) {
    const model = symbolForDefinition(use, {});
    const definition = library[model];
    const parameters = Object.fromEntries(Object.entries(definition.parameters).filter(([, parameter]) => parameter.default !== undefined).map(([name, parameter]) => [name, parameter.default]));
    const electricalPorts = resolveModel(use)?.ports ?? definition.ports.map(port => port.name);

    const element = withImmutableId({
        model,
        use,
        electricalPorts,
        x,
        y,
        rotation: 0,
        reference: nextReference(definition.referencePrefix),
        parameters,
        ports: []
    }, takeId("element"));

    definition.ports.forEach(
        (port, index) => {
            const node = {
                id: takeId("node"),
                kind: "terminal",
                element: element.id,
                port: port.name,
                x: x + port.x,
                y: y + port.y,
                axis: port.axis
            };

            circuit.nodes.set(node.id, node);

            element.ports.push(
                node.id
            );
        }
    );

    circuit.elements.set(element.id, element);
    rebuildNets();

    renderElement(element);

    return element;
}

function changeElementDefinition(element, use) {
    const resolved = resolveModel(use);
    if (!resolved) return;
    const symbol = symbolForDefinition(use, element.parameters);

    if (element.ports.length !== resolved.ports.length) {
        detachNodes(element.ports);
        element.ports = [];
        library[symbol].ports.forEach((port, index) => {
            const point = rotatePoint(port, element.rotation);
            const node = {id: takeId("node"), kind: "terminal", element: element.id, port: resolved.ports[index], x: element.x + point.x, y: element.y + point.y, axis: rotatedAxis(port.axis, element.rotation)};
            circuit.nodes.set(node.id, node);
            element.ports.push(node.id);
        });
    }

    element.use = use;
    element.model = symbol;
    element.electricalPorts = [...resolved.ports];
    element.parameters = Object.fromEntries(Object.entries(element.parameters).filter(([name]) => resolved.parameters.includes(name)));
    element.ports.forEach((nodeId, index) => circuit.nodes.get(nodeId).port = resolved.ports[index]);
    updateTerminalNodes(element);
    elementLayer.querySelector(`[data-element-id="${element.id}"]`)?.remove();
    rebuildNets();
    renderElement(element);
    renderLists();
    renderProperties();
}

function refreshElementSymbol(element) {
    const symbol = symbolForDefinition(element.use, element.parameters);
    if (!symbol || symbol === element.model) return;
    element.model = symbol;
    updateTerminalNodes(element);
    elementLayer.querySelector(`[data-element-id="${element.id}"]`)?.remove();
    renderElement(element);
    renderLists();
}

function createMarker(type, x, y) {
    const definition = library[type];
    const marker = withImmutableId(
        {type, x, y, rotation: 0, ports: [], ...(definition.acInputType ? {reference: nextACInputReference()} : {})},
        takeId("marker"),
    );
    definition.ports.forEach((port, index) => {
        const node = {id: takeId("node"), kind: "marker", marker: marker.id, port: port.name, x: x + port.x, y: y + port.y, axis: port.axis};
        circuit.nodes.set(node.id, node);
        marker.ports.push(node.id);
    });
    circuit.markers.set(marker.id, marker);
    rebuildNets();
    renderMarker(marker);
    return marker;
}

function renderMarker(marker) {
    let g = elementLayer.querySelector(`[data-marker-id="${marker.id}"]`);
    if (!g) {
        g = svgElement("g");
        g.dataset.markerId = marker.id;
        g.classList.add("element", "marker");
        g.append(svgElement("rect", {...library[marker.type].hitBox, class: "element-hit"}));
        library[marker.type].draw(g);
        if (isACInputMarker(marker)) {
            const label = svgElement("text", {x: 22, y: 7});
            label.classList.add("reference-label", "ac-input-reference");
            g.append(label);
        }
        marker.ports.forEach((nodeId, index) => {
            const port = library[marker.type].ports[index];
            const visible = svgElement("circle", {cx: port.x, cy: port.y, r: 5});
            const hit = svgElement("circle", {cx: port.x, cy: port.y, r: 10});
            visible.classList.add("port-visible");
            visible.dataset.nodeId = nodeId;
            hit.classList.add("port-hit");
            hit.dataset.nodeId = nodeId;
            hit.addEventListener("pointerdown", event => {
                if (placingType !== null) {
                    return;
                }
                event.stopPropagation();
                if (application.mode === "ac" && isACInputMarker(marker)) {
                    selectACInput(marker);
                    return;
                }
                if (application.mode !== "edit") {
                    toggleNetVoltage(nodeId);
                    return;
                }
                handleNodeClick(nodeId);
            });
            g.append(visible, hit);
        });
        g.addEventListener("pointerdown", event => {
            if (placingType !== null || event.target.classList.contains("port-hit")) {
                return;
            }
            event.stopPropagation();
            if (application.mode === "ac" && isACInputMarker(marker)) {
                selectACInput(marker);
                return;
            }
            if (application.mode !== "edit") {
                toggleNetVoltage(marker.ports[0]);
                return;
            }
            drawingWire = null;
            renderOverlay();
            select({kind: "marker", id: marker.id});
            draggingMarker = marker.id;
        });
        elementLayer.append(g);
    }
    g.setAttribute("transform", `translate(${marker.x} ${marker.y}) rotate(${marker.rotation})`);
    const referenceLabel = g.querySelector(".ac-input-reference");
    if (referenceLabel) referenceLabel.textContent = marker.reference;
    g.classList.toggle("selected", selected?.kind === "marker" && selected.id === marker.id);
    g.classList.toggle("signal-selected", application.mode !== "edit" && (
        application.mode === "ac" && isACInputMarker(marker)
            ? application.ac.selectedInput === marker.reference
            : netVoltageVisible(marker.ports[0])
    ));
    for (const nodeId of marker.ports) {
        const visible = g.querySelector(`.port-visible[data-node-id="${nodeId}"]`);
        visible.classList.toggle("signal-active", application.mode !== "edit" && netVoltageVisible(nodeId));
        visible.style.display = nodeDegree(nodeId) > 0 ? "none" : "";
    }
}

function selectACInput(marker) {
    application.ac.selectedInput = marker.reference;
    renderAllMarkers();
    renderLists();
    renderProperties();
    refreshACPlot();
}

function renderAllMarkers() {
    for (const marker of circuit.markers.values())
        renderMarker(marker);
}


// ============================================================================
// Component rendering
// ============================================================================

function renderElement(element) {
    let g = elementLayer.querySelector(`[data-element-id="${element.id}"]`);

    if (!g) {
        g = svgElement("g");
        g.dataset.elementId = element.id;
        g.classList.add("element");

        g.append(svgElement("rect", {...library[element.model].hitBox, class: "element-hit"}));
        library[element.model].draw(g);
        const label = svgElement("text", library[element.model].labelPosition);
        label.classList.add("reference-label");
        g.append(label);

        // --------------------------------------------------
        // Ports
        // --------------------------------------------------

        element.ports.forEach(
            (nodeId, index) => {
                const port = library[element.model].ports[index];
                const visible = svgElement("circle", {cx: port.x, cy: port.y, r: 5});

                visible.classList.add("port-visible");
                visible.dataset.nodeId = nodeId;

                const hit = svgElement("circle", {cx: port.x, cy: port.y, r: 10});

                hit.classList.add("port-hit");
                hit.dataset.nodeId = nodeId;
                hit.addEventListener("pointerdown", event => {
                        if (placingType !== null)
                            return;

                        event.stopPropagation();
                        if (application.mode !== "edit") {
                            const portName = element.electricalPorts?.[index] ?? port.name;
                            toggleElementSignal(element, `I:${portName}`);
                            return;
                        }
                        handleNodeClick(nodeId);
                    }
                );

                g.append(visible, hit);
            }
        );


        // --------------------------------------------------
        // Component selection / dragging
        // --------------------------------------------------

        g.addEventListener("pointerdown", event => {
                if (placingType !== null)
                    return;

                if (event.target.classList.contains("port-hit"))
                    return;

                event.stopPropagation();
                if (application.mode !== "edit") {
                    return;
                }

                // Clicking a component cancels
                // unfinished wire drawing.
                drawingWire = null;
                renderOverlay();

                select({kind: "element", id: element.id});

                const p = svgPoint(event);

                draggingElement = element.id;
            }
        );

        elementLayer.append(g);
    }

    g.setAttribute("transform", `translate(${element.x} ${element.y}) rotate(${element.rotation})`);
    g.querySelector(".reference-label").textContent = element.reference;

    g.classList.toggle(
        "selected",
        selected?.kind === "element" &&
        selected.id === element.id
    );
    g.classList.toggle("signal-selected", application.mode !== "edit" && activeAnalysis().visibleElementSignals.has(element.reference));


    // --------------------------------------------------
    // Terminal circle visibility
    // --------------------------------------------------

    element.ports.forEach((nodeId, index) => {
        const visible = g.querySelector(`.port-visible[data-node-id="${nodeId}"]`);

        if (!visible)
            return;

        const portName = element.electricalPorts?.[index] ?? library[element.model].ports[index].name;
        visible.classList.toggle("signal-active", application.mode !== "edit" && (
            elementSignalVisible(element, `I:${portName}`) || elementSignalVisible(element, `U:${portName}`)
        ));
        visible.style.display = nodeDegree(nodeId) > 0 ? "none" : "";
    });
}


// ============================================================================
// Junction nodes
// ============================================================================

function createJunction(x, y) {
    const node = {id: takeId("node"), kind: "junction", x, y};

    circuit.nodes.set(node.id, node);

    renderJunction(node);

    return node.id;
}


function renderJunction(node) {
    let group = junctionLayer.querySelector(`[data-node-id="${node.id}"]`);

    if (!group) {
        group = svgElement("g");
        group.dataset.nodeId = node.id;

        const dot = svgElement("circle", {r: 4});

        dot.classList.add("junction");

        const hit = svgElement("circle", {r: 10});

        hit.classList.add("junction-hit");
        hit.addEventListener("pointerdown", event => {
                if (placingType !== null)
                    return;

                event.stopPropagation();
                if (application.mode !== "edit") {
                    toggleNetVoltage(node.id);
                    return;
                }
                if (drawingWire) {
                    handleNodeClick(node.id);
                    return;
                }
                select({kind: "junction", id: node.id});
                svg.setPointerCapture(event.pointerId);
                junctionDrag = {id: node.id, startMouse: svgPoint(event), moved: false};
            }
        );

        group.append(dot, hit);
        junctionLayer.append(group);
    }

    group.setAttribute("transform", `translate(${node.x} ${node.y})`);
    group.classList.toggle("selected", application.mode !== "edit" ? netVoltageVisible(node.id) : selected?.kind === "junction" && selected.id === node.id || selected?.kind === "net" && netForNode(node.id)?.id === selected.id);
    group.querySelector(".junction").style.display = nodeDegree(node.id) >= 3 ? "" : "none";
}

function moveJunction(id, point) {
    const node = circuit.nodes.get(id);
    if (!node) {
        return;
    }
    node.x = point.x;
    node.y = point.y;
    renderJunction(node);
    renderAllWires();
}

function renderAllJunctions() {
    for (const node of circuit.nodes.values()) {
        if (node.kind === "junction") {
            renderJunction(node);
        }
    }
}


// ============================================================================
// Node / terminal clicks
// ============================================================================

function handleNodeClick(nodeId) {
    if (application.mode !== "edit") {
        toggleNetVoltage(nodeId);
        return;
    }
    // First endpoint
    if (!drawingWire) {
        select({kind: "node", id: nodeId});
        drawingWire = {startNode: nodeId, mouse: nodePosition(nodeId)};
        renderOverlay();

        return;
    }

    // Clicking starting node again cancels.
    if (drawingWire.startNode === nodeId) {
        drawingWire = null;
        renderOverlay();

        return;
    }

    // Second endpoint
    createWire(drawingWire.startNode, nodeId);
    drawingWire = null;
    renderOverlay();
}


// ============================================================================
// Wire creation
// ============================================================================

function createWire(aNode, bNode) {
    const a = nodePosition(aNode);
    const b = nodePosition(bNode);

    const wire = {
        id: takeId("wire"),
        a: aNode,
        b: bNode,
        waypoints: [],
        points: [a, b]
    };

    circuit.wires.set(wire.id, wire);
    rebuildNets();
    renderWire(wire);
    renderNodeTerminals(aNode, bNode);
    renderProperties();

    return wire;
}


// ============================================================================
// Wire rendering
// ============================================================================

function renderWire(wire) {
    syncWireEndpoints(wire);

    let group = wireLayer.querySelector(`[data-wire-id="${wire.id}"]`);

    if (!group) {
        group = svgElement("g");
        group.dataset.wireId = wire.id;
        wireLayer.append(group);
    }

    group.replaceChildren();

    for (let i = 0; i < wire.points.length - 1; ++i) {
        const a = wire.points[i];
        const b = wire.points[i + 1];

        const hit = svgElement("line", {x1: a.x, y1: a.y, x2: b.x, y2: b.y});

        hit.classList.add("wire-hit");

        const visible = svgElement("line", {x1: a.x, y1: a.y, x2: b.x, y2: b.y});

        visible.classList.add("wire");

        if (wireIsSelected(wire)) {
            visible.classList.add("selected");
        }

        hit.addEventListener("pointerdown", event => {
                if (placingType !== null)
                    return;

                event.stopPropagation();

                if (application.mode !== "edit") {
                    toggleNetVoltage(wire.a);
                    return;
                }

                const p = snapPoint(svgPoint(event));

                if (!drawingWire && event.detail === 2) {
                    const waypoint = addWaypoint(wire, p, i, false);
                    select({kind: "waypoint", wireId: wire.id, id: waypoint.id});
                    return;
                }

                // --------------------------------------------------
                // While drawing:
                // clicking a wire creates a junction and finishes
                // the connection there.
                // --------------------------------------------------

                if (drawingWire) {
                    const nodeId = splitWireAt( wire.id, i, p);

                    if (nodeId !== drawingWire.startNode) {
                        createWire(drawingWire.startNode, nodeId);
                    }

                    drawingWire = null;
                    renderOverlay();
                    return;
                }


                // --------------------------------------------------
                // Otherwise this is normal selection / dragging.
                // --------------------------------------------------

                select({kind: "wire", id: wire.id});
                svg.setPointerCapture(event.pointerId);

                segmentDrag = {
                    wireId: wire.id,
                    segment: i,
                    startMouse: svgPoint(event),
                    moved: false
                };
            }
        );

        group.append(hit, visible);
    }

    if (application.mode === "edit" && wireIsSelected(wire)) {
        for (const waypoint of wire.waypoints) {
            const handle = svgElement("circle", {cx: waypoint.x, cy: waypoint.y, r: 6});
            handle.classList.add("wire-waypoint");
            handle.classList.toggle("selected", selected?.kind === "waypoint" && selected.id === waypoint.id);
            handle.addEventListener("pointerdown", event => {
                event.stopPropagation();
                if (event.detail === 2) {
                    removeWaypoint(wire, waypoint.id);
                    select({kind: "wire", id: wire.id});
                    return;
                }
                select({kind: "waypoint", wireId: wire.id, id: waypoint.id});
                svg.setPointerCapture(event.pointerId);
                segmentDrag = {wireId: wire.id, waypointId: waypoint.id, startMouse: svgPoint(event), moved: true};
            });
            group.append(handle);
        }
    }
}

function wireIsSelected(wire) {
    if (application.mode !== "edit") {
        return netVoltageVisible(wire.a);
    }
    return selected?.kind === "wire" && selected.id === wire.id || selected?.kind === "waypoint" && selected.wireId === wire.id || selected?.kind === "net" && netForNode(wire.a)?.id === selected.id;
}


function renderAllWires() {
    for (const wire of circuit.wires.values()) {
        renderWire(wire);
    }
}

// ============================================================================
// Wire segment dragging
// ============================================================================

function dragWireSegment(drag, mouse) {
    const wire = circuit.wires.get(drag.wireId);
    if (!wire) {
        return;
    }
    if (!drag.waypointId) {
        drag.waypointId = addWaypoint(wire, snapPoint(mouse), drag.segment, false).id;
        drag.created = true;
        selected = {kind: "waypoint", wireId: wire.id, id: drag.waypointId};
        renderProperties();
    }
    const waypoint = wire.waypoints.find(point => point.id === drag.waypointId);
    Object.assign(waypoint, snapPoint(mouse));
    renderWire(wire);
}

function finishSegmentDrag() {
    if (!segmentDrag?.created) {
        return;
    }
    const wire = circuit.wires.get(segmentDrag.wireId);
    if (!wire) {
        return;
    }
    const index = wire.waypoints.findIndex(point => point.id === segmentDrag.waypointId);
    if (!waypointIsRedundant(wire, index)) {
        return;
    }
    wire.waypoints.splice(index, 1);
    selected = {kind: "wire", id: wire.id};
    renderWire(wire);
    renderProperties();
}

function waypointIsRedundant(wire, index) {
    const point = wire.waypoints[index];
    if (!point) {
        return false;
    }
    const before = index ? wire.waypoints[index - 1] : nodePosition(wire.a);
    const after = index + 1 < wire.waypoints.length ? wire.waypoints[index + 1] : nodePosition(wire.b);
    const between = (value, a, b) => value >= Math.min(a, b) && value <= Math.max(a, b);
    return before.x === point.x && point.x === after.x && between(point.y, before.y, after.y) || before.y === point.y && point.y === after.y && between(point.x, before.x, after.x);
}

function addWaypoint(wire, point, segment = wire.points.length, render = true) {
    const waypoint = {id: takeId("waypoint"), ...point};
    const index = wire.waypoints.filter(item => wire.points.findIndex(point => point.x === item.x && point.y === item.y) <= segment).length;
    wire.waypoints.splice(index, 0, waypoint);
    if (render) {
        renderWire(wire);
    }
    return waypoint;
}

function removeWaypoint(wire, id) {
    wire.waypoints = wire.waypoints.filter(point => point.id !== id);
    renderWire(wire);
}


// ============================================================================
// Split wire at arbitrary point
// ============================================================================
function splitWireAt(wireId, segmentIndex, p) {
    const wire = circuit.wires.get(wireId);

    const a = wire.points[segmentIndex];

    const b = wire.points[segmentIndex + 1];

    let q;


    if (a.x === b.x) {
        q = {x: a.x, y: snap(p.y)};
    }

    else {
        q = {x: snap(p.x), y: a.y};
    }

    // --------------------------------------------------
    // Existing endpoint?
    // --------------------------------------------------
    const first = wire.points[0];
    const last = wire.points[wire.points.length - 1];

    if (q.x === first.x && q.y === first.y) {return wire.a;}
    if (q.x === last.x && q.y === last.y) {return wire.b;}

    // --------------------------------------------------
    // Create junction
    // --------------------------------------------------
    const nodeId = createJunction(q.x, q.y);

    const firstPoints = [
        ...wire.points.slice(0, segmentIndex + 1).map(p => ({ ...p })),
        {...q}
    ];

    const secondPoints = [
        {...q},
        ...wire.points.slice(segmentIndex + 1).map(p => ({ ...p }))
    ];

    const oldB = wire.b;


    // Existing wire now ends at junction.
    wire.b = nodeId;
    wire.waypoints = firstPoints.slice(1, -1).map(point => ({id: takeId("waypoint"), ...point}));
    wire.points = firstPoints;

    // Second half becomes another wire.
    const newWire = {
        id: takeId("wire"),
        a: nodeId,
        b: oldB,
        waypoints: secondPoints.slice(1, -1).map(point => ({id: takeId("waypoint"), ...point})),
        points: secondPoints
    };

    circuit.wires.set(newWire.id, newWire);
    rebuildNets();

    renderWire(wire);
    renderWire(newWire);

    return nodeId;
}


// ============================================================================
// Overlay
// ============================================================================

function renderOverlay() {
    overlayLayer.replaceChildren();

    // --------------------------------------------------
    // Component placement preview
    // --------------------------------------------------

    if (placingType !== null && placingPosition) {
        const g = svgElement("g");

        g.classList.add("preview");

        g.setAttribute("transform", `translate(${placingPosition.x} ${placingPosition.y})`);
        library[library[placingType]?.kind === "marker" ? placingType : symbolForDefinition(placingType, {})].draw(g);
        overlayLayer.append(g);
    }

    // --------------------------------------------------
    // Temporary wire
    // --------------------------------------------------

    if (drawingWire) {
        const points = routeOrthogonally([nodeAnchor(drawingWire.startNode), drawingWire.mouse]);
        const path = svgElement("polyline", {points: points.map(point => `${point.x},${point.y}`).join(" ")});

        path.classList.add("temp-wire");
        overlayLayer.append(path);
    }
}


// ============================================================================
// Moving components
// ============================================================================

function updateTerminalNodes(object) {
    const definition = library[object.model ?? object.type];

    object.ports.forEach(
        (nodeId, i) => {
            const node = circuit.nodes.get(nodeId);
            const port = definition.ports[i];
            const p = rotatePoint(port, object.rotation);

            node.x = object.x + p.x;
            node.y = object.y + p.y;
            node.axis = rotatedAxis(port.axis, object.rotation);
        }
    );
}

function rotateSelected(degrees) {
    if (application.mode !== "edit") {
        return;
    }
    if (selected?.kind !== "element" && selected?.kind !== "marker") {
        return;
    }
    const object = selected.kind === "element" ? circuit.elements.get(selected.id) : circuit.markers.get(selected.id);
    if (!object) {
        return;
    }
    object.rotation = (object.rotation + degrees + 360) % 360;
    updateTerminalNodes(object);
    selected.kind === "element" ? renderElement(object) : renderMarker(object);
    renderAllWires();
    scheduleSchematicSave();
}


// ============================================================================
// Keep graphical wire endpoints attached to model nodes
// ============================================================================

function syncWireEndpoints(wire) {
    const a = nodeAnchor(wire.a);
    const b = nodeAnchor(wire.b);
    wire.points = routeOrthogonally([a, ...wire.waypoints, b]);
}

// ============================================================================
// Selection
// ============================================================================

function select(object) {
    selected = object;
    updateToolbar();

    for (const element of circuit.elements.values())
        renderElement(element);

    renderAllMarkers();
    renderAllJunctions();
    renderAllWires();
    renderLists();
    renderProperties();
}

function renderLists() {
    const expandedElements = new Set(
        [...elementList.querySelectorAll("details[open][data-reference]")].map(group => group.dataset.reference)
    );
    elementList.replaceChildren();
    markerList.replaceChildren();
    netList.replaceChildren();
    acInputList.replaceChildren();
    const elements = [...circuit.elements.values()].sort((a, b) => a.reference.localeCompare(b.reference, undefined, {numeric: true}));
    for (const element of elements) {
        if (application.mode === "edit") {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `${element.reference} · ${element.use}`;
            button.classList.toggle("active", selected?.kind === "element" && selected.id === element.id);
            button.addEventListener("click", () => select({kind: "element", id: element.id}));
            elementList.append(button);
        } else {
            const group = document.createElement("details");
            const name = document.createElement("summary");
            const ports = document.createElement("div");
            group.className = "simulation-element";
            group.dataset.reference = element.reference;
            group.open = expandedElements.has(element.reference);
            name.className = "simulation-element-name";
            ports.className = "element-signal-grid";
            name.textContent = `${element.reference} · ${element.use}`;
            const model = resolveModel(element.use);
            const choices = [];
            for (const portName of model?.ports ?? []) choices.push([`I:${portName}`, `I_${portName}`, "current"]);
            for (const portName of model?.ports.slice(1) ?? []) choices.push([`U:${portName}`, `U_${portName}`, "port voltage"]);
            for (const auxiliary of Object.keys(model?.auxiliaries ?? {})) choices.push([`A:${auxiliary}`, auxiliary, "auxiliary"]);
            for (const [signalName, label, kind] of choices) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = label;
                button.title = `Toggle ${kind} ${element.reference}.${label}`;
                button.setAttribute("aria-label", button.title);
                button.classList.toggle("active", elementSignalVisible(element, signalName));
                button.addEventListener("click", () => toggleElementSignal(element, signalName));
                ports.append(button);
            }
            group.append(name, ports);
            elementList.append(group);
        }
    }
    for (const marker of circuit.markers.values()) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = marker.type === "GND" ? "Ground" : marker.type;
        button.classList.toggle("active", selected?.kind === "marker" && selected.id === marker.id);
        button.addEventListener("click", () => select({kind: "marker", id: marker.id}));
        markerList.append(button);
        if (application.mode === "ac" && isACInputMarker(marker)) {
            const input = document.createElement("button");
            input.type = "button";
            input.textContent = `${marker.reference} · ${library[marker.type].acInputType}`;
            input.classList.toggle("active", application.ac.selectedInput === marker.reference);
            input.addEventListener("click", () => selectACInput(marker));
            acInputList.append(input);
        }
    }
    const nets = [...circuit.nets.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    for (const net of nets) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = application.mode !== "edit" && net.name === "0" ? "0 · fixed" : net.name;
        button.disabled = application.mode !== "edit" && net.name === "0";
        if (button.disabled) {
            button.title = "Ground is fixed at 0 V and is not plotted";
        }
        button.classList.toggle("active", application.mode !== "edit" ? activeAnalysis().visibleNets.has(net.name) : selected?.kind === "net" && selected.id === net.id);
        button.addEventListener("click", () => application.mode !== "edit" ? toggleNetVoltage([...net.members][0]) : select({kind: "net", id: net.id}));
        netList.append(button);
    }
}


// ============================================================================
// Properties
// ============================================================================

function renderProperties() {
    propertyContent.replaceChildren();

    if (application.mode === "ac") {
        renderACProperties();
        return;
    }
    if (application.mode === "simulation") {
        renderSimulationProperties();
        return;
    }

    if (selected?.kind === "waypoint") {
        propertyContent.textContent = "Routing point selected. Drag it to move it, or press Delete/Backspace to remove it.";
        return;
    }

    if (selected?.kind === "junction") {
        renderNetProperty(selected.id, "Electrical junction selected. Drag it to move all attached wires.");
        return;
    }

    if (selected?.kind === "node") {
        renderNetProperty(selected.id, "Terminal selected. Click another terminal or wire to complete the connection.");
        return;
    }

    if (selected?.kind === "wire") {
        const wire = circuit.wires.get(selected.id);
        if (wire) {
            renderNetProperty(wire.a, "Drag a segment or double-click it to add a routing point. Select a blue point to move or delete it.");
        }
        return;
    }

    if (selected?.kind === "net") {
        const net = circuit.nets.get(selected.id);
        if (net) {
            renderNetEditor(net, `${net.members.size} connected node${net.members.size === 1 ? "" : "s"}.`);
        }
        return;
    }

    if (selected?.kind === "marker") {
        const marker = circuit.markers.get(selected.id);
        if (!marker) {
            return;
        }
        const identity = propertySection("Marker");
        identity.append(marker.type === "GND" ? "Ground" : marker.type);
        const connections = propertySection("Connection");
        const nets = document.createElement("dl");
        nets.className = "net-assignments";
        const term = document.createElement("dt");
        const name = document.createElement("dd");
        term.textContent = "Net";
        name.textContent = netForNode(marker.ports[0]).name;
        nets.append(term, name);
        connections.append(nets);
        return;
    }

    if (selected?.kind !== "element") {
        propertyContent.textContent = "Nothing selected";
        return;
    }


    const element = circuit.elements.get(selected.id);
    const identity = propertySection("Identity");
    appendProperty("reference", element.reference, input => {
        const error = referenceError(input.value, element);
        input.setCustomValidity(error);
        input.toggleAttribute("aria-invalid", !!error);
        if (!error) {
            element.reference = input.value;
            renderElement(element);
            renderLists();
        }
    }, input => {
        if (referenceError(input.value, element)) {
            input.value = element.reference;
        }
        input.setCustomValidity("");
        input.removeAttribute("aria-invalid");
    }, identity);
    const definitionLabel = document.createElement("label");
    const definitionSelect = document.createElement("select");
    definitionLabel.htmlFor = `definition-${element.id}`;
    definitionLabel.textContent = "Definition";
    definitionSelect.id = `definition-${element.id}`;
    for (const [name, definition] of compatibleDefinitions(element.use)) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = `${name} · ${definition.type}`;
        option.selected = name === element.use;
        definitionSelect.append(option);
    }
    definitionSelect.addEventListener("change", () => changeElementDefinition(element, definitionSelect.value));
    const definitionProperty = document.createElement("div");
    definitionProperty.className = "property";
    definitionProperty.append(definitionLabel, definitionSelect);
    identity.append(definitionProperty);
    if (!resolveModel(element.use)) {
        const warning = document.createElement("p");
        warning.textContent = `Definition ${element.use} is not available from the backend.`;
        identity.append(warning);
    }

    const connections = propertySection("Connections");
    const nets = document.createElement("dl");
    nets.className = "net-assignments";
    element.ports.forEach((nodeId, index) => {
        const port = document.createElement("dt");
        const name = document.createElement("dd");
        port.textContent = element.electricalPorts?.[index] ?? library[element.model].ports[index].name;
        name.textContent = netForNode(nodeId).name;
        nets.append(port, name);
    });
    connections.append(nets);

    const parameters = propertySection("Parameters", "parameters-box");
    const electricalModel = resolveModel(element.use);
    const inherited = inheritedParameters(element.use);
    for (const name of electricalModel?.parameters ?? []) {
        const overridden = Object.hasOwn(element.parameters, name);
        const inheritedValue = inherited[name];
        const value = overridden ? element.parameters[name] : inheritedValue;
        const update = input => {
            const text = input.value.trim();
            if (!text) delete element.parameters[name];
            else {
                const numeric = Number(text);
                element.parameters[name] = Number.isNaN(numeric) ? text : numeric;
            }
            refreshElementSymbol(element);
            renderProperties();
        };
        appendProperty(name, value, null, null, parameters, "", false);
        const row = parameters.lastElementChild;
        const input = row.querySelector("input");
        const source = document.createElement("small");
        source.className = "parameter-source";
        source.textContent = overridden ? "instance override" : inheritedValue !== undefined ? "part value" : "missing";
        row.classList.toggle("parameter-missing", value === undefined);
        input.placeholder = inheritedValue !== undefined ? String(inheritedValue) : "required";
        input.toggleAttribute("aria-invalid", value === undefined);
        input.addEventListener("change", () => update(input));
        row.append(source);
    }
    if (!electricalModel?.parameters.length) {
        parameters.append("No parameters");
    }
    if (electricalModel) renderModelEquations(resolveModelName(element.use), electricalModel);
}

function renderModelEquations(modelName, model) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const reference = document.createElement("p");
    summary.textContent = "Model equations";
    reference.className = "model-reference";
    reference.textContent = modelName ?? "inline model";
    details.className = "model-equations";
    details.append(summary, reference);

    const auxiliaries = Object.entries(model.auxiliaries ?? {});
    if (auxiliaries.length) {
        const heading = document.createElement("h4");
        heading.textContent = "Auxiliary expressions";
        details.append(heading);
        for (const [name, expression] of auxiliaries) {
            const code = document.createElement("code");
            code.textContent = `${name} = ${expression}`;
            details.append(code);
        }
    }

    const heading = document.createElement("h4");
    heading.textContent = "Equations";
    details.append(heading);
    for (const equation of model.equations) {
        const code = document.createElement("code");
        code.textContent = `${equation} = 0`;
        details.append(code);
    }
    propertyContent.append(details);
}

function renderSimulationProperties() {
    const status = propertySection("Simulation mode");
    const explanation = document.createElement("p");
    explanation.textContent = application.compilation.message || "The schematic is frozen while it is compiled.";
    status.dataset.state = application.compilation.state;
    status.append(explanation);

    const controls = propertySection("Transient analysis", "transient-controls");
    const form = document.createElement("form");
    const fields = [
        ["Start time", "startTime", application.transient.startTime, true],
        ["End time", "endTime", application.transient.endTime, true],
        ["Minimum step size", "minimumStepSize", application.transient.minimumStepSize, true],
        ["Maximum step size", "maximumStepSize", application.transient.maximumStepSize, true],
        ["Relative tolerance", "relativeTolerance", application.transient.relativeTolerance, true],
        ["Voltage absolute tolerance", "voltageAbsoluteTolerance", application.transient.voltageAbsoluteTolerance, true],
        ["Current absolute tolerance", "currentAbsoluteTolerance", application.transient.currentAbsoluteTolerance, true],
        ["Newton residual tolerance", "residualTolerance", application.transient.residualTolerance, true],
    ];
    for (const [labelText, name, value, required] of fields) {
        const property = document.createElement("div");
        const label = document.createElement("label");
        const input = document.createElement("input");
        property.className = "property";
        label.htmlFor = `transient-${name}`;
        label.textContent = labelText;
        input.id = label.htmlFor;
        input.name = name;
        input.type = "number";
        input.step = "any";
        input.required = required;
        input.value = value;
        input.disabled = application.transient.state === "running";
        input.addEventListener("input", () => {
            application.transient[name] = input.value;
            application.transient.message = "";
            application.transient.state = "idle";
            application.transient.result = null;
            transientPlot.setData(null);
            controls.querySelector(".transient-result")?.remove();
        });
        property.append(label, input);
        form.append(property);
    }
    const run = document.createElement("button");
    run.type = "submit";
    run.textContent = application.transient.state === "running" ? "Simulating…" : "Run simulation";
    run.disabled = application.compilation.state !== "ready" || application.transient.state === "running";
    form.addEventListener("submit", event => {
        event.preventDefault();
        runTransientSimulation();
    });
    form.append(run);
    controls.append(form);
    if (application.transient.message) {
        const result = document.createElement("p");
        result.className = "transient-result";
        result.dataset.state = application.transient.state;
        result.textContent = application.transient.message;
        controls.append(result);
    }

    const active = propertySection("Displayed signals");
    appendDisplayedSignals(application.transient, active);
}

function appendDisplayedSignals(analysis, section) {
    const signals = [...analysis.visibleNets].map(net => `φ(${net})`);
    for (const [reference, elementSignals] of analysis.visibleElementSignals) {
        for (const signal of elementSignals) {
            const [kind, name] = signal.split(":", 2);
            signals.push(`${reference}.${kind === "A" ? "" : `${kind}_`}${name}`);
        }
    }
    if (!signals.length) {
        section.append("No signals selected");
        return;
    }
    const list = document.createElement("ul");
    for (const signal of signals) {
        const item = document.createElement("li");
        item.textContent = signal;
        list.append(item);
    }
    section.append(list);
}

function renderACProperties() {
    const status = propertySection("AC analysis mode");
    const explanation = document.createElement("p");
    explanation.textContent = application.acCompilation.message || "The schematic is frozen while its small-signal systems are compiled.";
    status.dataset.state = application.acCompilation.state;
    status.append(explanation);

    const controls = propertySection("Frequency sweep", "transient-controls");
    const form = document.createElement("form");
    const fields = [
        ["Operating point time", "operatingTime", application.ac.operatingTime, "any"],
        ["Minimum frequency", "minimumFrequency", application.ac.minimumFrequency, "any"],
        ["Maximum frequency", "maximumFrequency", application.ac.maximumFrequency, "any"],
        ["Frequency points", "pointCount", application.ac.pointCount, "1"],
        ["Newton residual tolerance", "residualTolerance", application.ac.residualTolerance, "any"],
    ];
    for (const [labelText, name, value, step] of fields) {
        const property = document.createElement("div");
        const label = document.createElement("label");
        const input = document.createElement("input");
        property.className = "property";
        label.htmlFor = `ac-${name}`;
        label.textContent = labelText;
        input.id = label.htmlFor;
        input.name = name;
        input.type = "number";
        input.step = step;
        input.required = true;
        input.value = value;
        input.disabled = application.ac.state === "running";
        input.addEventListener("input", () => {
            application.ac[name] = input.value;
            application.ac.message = "";
            application.ac.state = "idle";
            application.ac.results = new Map();
            transientPlot.setData(null);
            controls.querySelector(".transient-result")?.remove();
        });
        property.append(label, input);
        form.append(property);
    }
    const run = document.createElement("button");
    run.type = "submit";
    run.textContent = application.ac.state === "running" ? "Solving…" : "Run AC analysis";
    run.disabled = application.acCompilation.state !== "ready" || application.ac.state === "running";
    form.addEventListener("submit", event => {
        event.preventDefault();
        runACSimulation();
    });
    form.append(run);
    controls.append(form);
    if (application.ac.message) {
        const result = document.createElement("p");
        result.className = "transient-result";
        result.dataset.state = application.ac.state;
        result.textContent = application.ac.message;
        controls.append(result);
    }

    const selectedInput = propertySection("Selected input");
    selectedInput.append(application.ac.selectedInput ?? "Select an AC marker in the schematic or input list.");
    appendDisplayedSignals(application.ac, propertySection("Displayed signals"));
}

function propertySection(title, className = "") {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    section.className = `property-section ${className}`;
    heading.textContent = title;
    section.append(heading);
    propertyContent.append(section);
    return section;
}

function appendProperty(name, value, onInput, onBlur, parent = propertyContent, unit = "", required = false) {
    const div = document.createElement("div");
    const label = document.createElement("label");
    const input = document.createElement("input");
    div.className = "property";
    input.id = `property-${name.replace(/\W/g, "-")}`;
    input.name = name;
    input.value = value === undefined ? "" : value.toString();
    input.required = required;
    input.setCustomValidity(required && value === undefined ? "Numeric value required." : "");
    input.toggleAttribute("aria-invalid", required && value === undefined);
    label.htmlFor = input.id;
    label.textContent = name;
    if (onInput) {
        input.addEventListener("input", () => onInput(input));
    }
    if (onBlur) {
        input.addEventListener("blur", () => onBlur(input));
    }
    div.append(label);
    if (unit) {
        const field = document.createElement("span");
        const suffix = document.createElement("span");
        field.className = "value-with-unit";
        suffix.className = "unit";
        suffix.textContent = unit;
        field.append(input, suffix);
        div.append(field);
    } else div.append(input);
    parent.append(div);
}

function renderNetProperty(nodeId, note) {
    renderNetEditor(netForNode(nodeId), note);
}

function renderNetEditor(net, note) {
    const text = document.createElement("p");
    text.textContent = note;
    propertyContent.append(text);
    appendProperty("net name", net.name, input => {
        const error = netNameError(input.value, net);
        input.setCustomValidity(error);
        input.toggleAttribute("aria-invalid", !!error);
        if (!error) {
            net.name = input.value.trim();
            renderLists();
        }
    }, input => {
        if (netNameError(input.value, net)) {
            input.value = net.name;
        }
        input.setCustomValidity("");
        input.removeAttribute("aria-invalid");
    });
    if (net.name === "0") {
        propertyContent.lastElementChild.querySelector("input").readOnly = true;
    }
}

// ============================================================================
// Deletion
// ============================================================================

function deleteSelected() {
    if (application.mode !== "edit") {
        return;
    }
    if (!selected)
        return;

    // --------------------------------------------------
    // Wire
    // --------------------------------------------------

    if (selected.kind === "waypoint") {
        const wire = circuit.wires.get(selected.wireId);
        if (wire) {
            removeWaypoint(wire, selected.id);
        }
    }

    else if (selected.kind === "wire")
        deleteWire(selected.id);

    else if (selected.kind === "marker") {
        const marker = circuit.markers.get(selected.id);
        if (!marker) {
            return;
        }
        detachNodes(marker.ports);
        circuit.markers.delete(marker.id);
        elementLayer.querySelector(`[data-marker-id="${marker.id}"]`)?.remove();
        rebuildNets();
    }


    // --------------------------------------------------
    // Component
    // --------------------------------------------------

    else if (selected.kind === "element") {
        const element = circuit.elements.get(selected.id);

        if (!element)
            return;

        detachNodes(element.ports);

        circuit.elements.delete(element.id);

        elementLayer.querySelector(`[data-element-id="${element.id}"]`)?.remove();
        rebuildNets();
    }


    selected = null;
    updateToolbar();
    renderAllMarkers();
    renderAllJunctions();
    renderAllWires();
    renderProperties();
    scheduleSchematicSave();
}


// ============================================================================
// Delete wire
// ============================================================================

function deleteWire(id) {
    const wire = circuit.wires.get(id);

    if (!wire)
        return;

    const a = wire.a;
    const b = wire.b;
    removeWireRaw(wire);
    cleanupJunction(a);
    cleanupJunction(b);
    rebuildNets();
    renderNodeTerminals(a, b);
}

function removeWireRaw(wire) {
    circuit.wires.delete(wire.id);
    wireLayer.querySelector(`[data-wire-id="${wire.id}"]`)?.remove();
}

function detachNodes(nodeIds) {
    const {neighbors, removedWires} = detachCircuitNodes(nodeIds);
    for (const wire of removedWires) wireLayer.querySelector(`[data-wire-id="${wire.id}"]`)?.remove();
    for (const nodeId of neighbors) cleanupJunction(nodeId);
}

function cleanupJunction(nodeId) {
    const node = circuit.nodes.get(nodeId);
    if (node?.kind !== "junction") {
        return;
    }
    const wires = [...circuit.wires.values()].filter(wire => wire.a === nodeId || wire.b === nodeId);
    if (wires.length >= 3) {
        renderJunction(node);
        return;
    }
    if (wires.length === 2) {
        const [a, b] = wires;
        const aEnd = a.a === nodeId ? a.b : a.a;
        const bEnd = b.a === nodeId ? b.b : b.a;
        const aPoints = a.b === nodeId ? a.waypoints : [...a.waypoints].reverse();
        const bPoints = b.a === nodeId ? b.waypoints : [...b.waypoints].reverse();
        removeWireRaw(a);
        removeWireRaw(b);
        const merged = {id: takeId("wire"), a: aEnd, b: bEnd, waypoints: [...aPoints, ...bPoints], points: []};
        circuit.wires.set(merged.id, merged);
        renderWire(merged);
        renderNodeTerminals(aEnd, bEnd);
    }
    else if (wires.length === 1) {
        const wire = wires[0];
        const other = wire.a === nodeId ? wire.b : wire.a;
        removeWireRaw(wire);
        cleanupJunction(other);
        renderNodeTerminals(other);
    }
    circuit.nodes.delete(nodeId);
    junctionLayer.querySelector(`[data-node-id="${nodeId}"]`)?.remove();
    if (selected?.kind === "junction" && selected.id === nodeId) {
        selected = null;
    }
}


// ============================================================================
// Update component terminal circles
// ============================================================================

function renderNodeTerminals(...nodeIds) {
    for (const nodeId of nodeIds) {
        const node = circuit.nodes.get(nodeId);

        if (node?.kind === "junction") {
            renderJunction(node);
            continue;
        }

        if (node?.kind === "marker") {
            const marker = circuit.markers.get(node.marker);
            if (marker) {
                renderMarker(marker);
            }
            continue;
        }

        if (node?.kind !== "terminal")
            continue;

        const element = circuit.elements.get(node.element);

        if (element)
            renderElement(element);
    }
}


// ============================================================================
// Geometry
// ============================================================================

function svgPoint(event) {
    const p = new DOMPoint(event.clientX, event.clientY);

    return p.matrixTransform(svg.getScreenCTM().inverse());
}

function resizeViewport() {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) {
        return;
    }
    if (!viewport.width) {
        viewport = {x: 0, y: 0, width: rect.width, height: rect.height};
    }
    else {
        const scale = viewport.width / viewportPixels.width;
        const center = {x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2};
        viewport.width = rect.width * scale;
        viewport.height = rect.height * scale;
        viewport.x = center.x - viewport.width / 2;
        viewport.y = center.y - viewport.height / 2;
    }
    viewportPixels = {width: rect.width, height: rect.height};
    updateViewBox();
}

function updateViewBox() {
    svg.setAttribute("viewBox", `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
    const scale = viewportPixels.width && viewport.width ? viewport.width / viewportPixels.width : 1;
    svg.style.setProperty("--grid-size", `${GRID / scale}px`);
    svg.style.setProperty("--grid-x", `${-viewport.x / scale}px`);
    svg.style.setProperty("--grid-y", `${-viewport.y / scale}px`);
    updateStatus();
}


// ============================================================================
// SVG helpers
// ============================================================================

function svgElement(name, attributes = {}
) {
    const e = document.createElementNS(NS, name);

    for (const [key, value] of Object.entries(attributes))
        e.setAttribute(key, value);

    return e;
}

function addLine(parent, x1, y1, x2, y2) {
    const line = svgElement("line", {x1, y1, x2, y2});
    line.classList.add("symbol");
    parent.append(line);
}

function addPath(parent, d) {
    const path = svgElement("path", {d});
    path.classList.add("symbol");
    parent.append(path);
}

function addCircle(parent, cx, cy, r) {
    const circle = svgElement("circle", {cx, cy, r});
    circle.classList.add("symbol");
    parent.append(circle);
}

function addArrow(parent, x1, y1, x2, y2) {
    addLine(parent, x1, y1, x2, y2);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const a = angle + 2.5;
    const b = angle - 2.5;
    addPath(parent, `M ${x2} ${y2} L ${x2 + 8 * Math.cos(a)} ${y2 + 8 * Math.sin(a)} M ${x2} ${y2} L ${x2 + 8 * Math.cos(b)} ${y2 + 8 * Math.sin(b)}`);
}
