import {library} from "./library.js?v=12";
import {GRID, distance, rotatePoint, rotatedAxis, routeOrthogonally, snap, snapPoint} from "./routing.js?v=11";
import {circuit, generateNetlist, netForNode, netNameError, nextReference, nodeAnchor, nodeDegree, nodePosition, rebuildNets as rebuildCircuitNets, referenceError, takeId, withImmutableId} from "./circuit.js?v=12";

const NS = "http://www.w3.org/2000/svg";
window.generateNetlist = generateNetlist;
function rebuildNets() {
    rebuildCircuitNets();
    renderLists();
    updateStatus();
}

const svg = document.querySelector("#editor");
const wireLayer = document.querySelector("#wireLayer");
const junctionLayer = document.querySelector("#junctionLayer");
const elementLayer = document.querySelector("#elementLayer");
const overlayLayer = document.querySelector("#overlayLayer");
const propertyContent = document.querySelector("#propertyContent");
const elementList = document.querySelector("#elementList");
const markerList = document.querySelector("#markerList");
const netList = document.querySelector("#netList");
const elementsHeading = document.querySelector("#elementsHeading");
const netsHeading = document.querySelector("#netsHeading");
const propertiesHeading = document.querySelector("#propertiesHeading");
const statusMode = document.querySelector("#statusMode");
const statusZoom = document.querySelector("#statusZoom");
const statusElements = document.querySelector("#statusElements");
const statusNets = document.querySelector("#statusNets");
const statusWires = document.querySelector("#statusWires");
const statusState = document.querySelector("#statusState");


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
const application = {mode: "edit", transient: {visibleNets: new Set(), visiblePorts: new Map()}};


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
    if (application.mode === "simulation") {
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
        button.disabled = application.mode === "simulation" || selected?.kind !== "element" && selected?.kind !== "marker";
    }
}

function setMode(mode) {
    if (mode === application.mode && document.body.dataset.mode) {
        return;
    }
    application.mode = mode;
    application.transient.visibleNets.clear();
    application.transient.visiblePorts.clear();
    document.body.dataset.mode = mode;
    if (mode === "simulation") startSimulation();
    elementsHeading.textContent = mode === "edit" ? "Elements" : "Port currents";
    netsHeading.textContent = mode === "edit" ? "Nets" : "Net voltages";
    propertiesHeading.textContent = mode === "edit" ? "Properties" : "Transient signals";
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

function startSimulation() {
    console.log(JSON.stringify(generateNetlist(), null, 2));
}

function updateStatus() {
    const scale = viewportPixels.width && viewport.width ? viewport.width / viewportPixels.width : 1;
    statusMode.textContent = application.mode === "edit" ? "EDIT" : "SIMULATE";
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
    toggleSet(application.transient.visibleNets, netName);
    renderAllMarkers();
    renderAllJunctions();
    renderAllWires();
    renderLists();
    renderProperties();
}

function togglePortCurrent(element, portName) {
    if (!application.transient.visiblePorts.has(element.reference)) {
        application.transient.visiblePorts.set(element.reference, new Set());
    }
    const ports = application.transient.visiblePorts.get(element.reference);
    toggleSet(ports, portName);
    if (!ports.size) {
        application.transient.visiblePorts.delete(element.reference);
    }
    renderElement(element);
    renderLists();
    renderProperties();
}

function netVoltageVisible(nodeId) {
    const netName = netForNode(nodeId).name;
    return netName !== "0" && application.transient.visibleNets.has(netName);
}

function portCurrentVisible(element, portName) {
    return application.transient.visiblePorts.get(element.reference)?.has(portName) ?? false;
}


for (const button of document.querySelectorAll("#toolbar [data-tool]")) {

    button.addEventListener(
        "click",
        () => {

            const type = button.dataset.tool;

            if (type === "select")
                cancelCurrentOperation();
            else
                enterPlacementMode(type);
        }
    );
}

for (const button of document.querySelectorAll("#toolbar [data-rotate]")) {
    button.addEventListener("click", () => rotateSelected(Number(button.dataset.rotate)));
}

for (const button of document.querySelectorAll("#toolbar [data-mode]")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
}


// Initial/default mode.
setMode("edit");


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

        if (application.mode === "simulation") {
            return;
        }

        // --------------------------------------------------
        // Place component
        // --------------------------------------------------
        if (placingType !== null) {
            const p = snapPoint(svgPoint(event));
            const type = placingType;
            const marker = library[type].kind === "marker";
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
        if (application.mode === "simulation") {
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
    }
);


window.addEventListener("keydown", event => {
    if (application.mode === "simulation") {
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

function createElement(model, x, y) {
    const definition = library[model];
    const parameters = Object.fromEntries(Object.entries(definition.parameters).map(([name, parameter]) => [name, parameter.default]));

    const element = withImmutableId({
        model,
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

function createMarker(type, x, y) {
    const definition = library[type];
    const marker = withImmutableId({type, x, y, rotation: 0, ports: []}, takeId("marker"));
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
                if (application.mode === "simulation") {
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
            if (application.mode === "simulation") {
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
    g.classList.toggle("selected", selected?.kind === "marker" && selected.id === marker.id);
    g.classList.toggle("signal-selected", application.mode === "simulation" && netVoltageVisible(marker.ports[0]));
    for (const nodeId of marker.ports) {
        const visible = g.querySelector(`.port-visible[data-node-id="${nodeId}"]`);
        visible.classList.toggle("signal-active", application.mode === "simulation" && netVoltageVisible(nodeId));
        visible.style.display = nodeDegree(nodeId) > 0 ? "none" : "";
    }
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
                        if (application.mode === "simulation") {
                            togglePortCurrent(element, port.name);
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
                if (application.mode === "simulation") {
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
    g.classList.toggle("signal-selected", application.mode === "simulation" && element.ports.some((nodeId, index) => portCurrentVisible(element, library[element.model].ports[index].name)));


    // --------------------------------------------------
    // Terminal circle visibility
    // --------------------------------------------------

    element.ports.forEach((nodeId, index) => {
        const visible = g.querySelector(`.port-visible[data-node-id="${nodeId}"]`);

        if (!visible)
            return;

        visible.classList.toggle("signal-active", application.mode === "simulation" && portCurrentVisible(element, library[element.model].ports[index].name));
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
                if (application.mode === "simulation") {
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
    group.classList.toggle("selected", application.mode === "simulation" ? netVoltageVisible(node.id) : selected?.kind === "junction" && selected.id === node.id || selected?.kind === "net" && netForNode(node.id)?.id === selected.id);
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
    if (application.mode === "simulation") {
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

                if (application.mode === "simulation") {
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
    if (application.mode === "simulation") {
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
        library[placingType].draw(g);
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
    if (application.mode === "simulation") {
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
    elementList.replaceChildren();
    markerList.replaceChildren();
    netList.replaceChildren();
    const elements = [...circuit.elements.values()].sort((a, b) => a.reference.localeCompare(b.reference, undefined, {numeric: true}));
    for (const element of elements) {
        if (application.mode === "edit") {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `${element.reference} · ${element.model}`;
            button.classList.toggle("active", selected?.kind === "element" && selected.id === element.id);
            button.addEventListener("click", () => select({kind: "element", id: element.id}));
            elementList.append(button);
        } else {
            const group = document.createElement("section");
            const name = document.createElement("div");
            const ports = document.createElement("div");
            group.className = "simulation-element";
            name.className = "simulation-element-name";
            ports.className = "simulation-ports";
            name.textContent = `${element.reference} · ${element.model}`;
            element.ports.forEach((nodeId, index) => {
                const portName = library[element.model].ports[index].name;
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = portName;
                button.title = `Toggle current at ${element.reference}, port ${portName}`;
                button.setAttribute("aria-label", button.title);
                button.classList.toggle("active", portCurrentVisible(element, portName));
                button.addEventListener("click", () => togglePortCurrent(element, portName));
                ports.append(button);
            });
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
    }
    const nets = [...circuit.nets.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    for (const net of nets) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = application.mode === "simulation" && net.name === "0" ? "0 · fixed" : net.name;
        button.disabled = application.mode === "simulation" && net.name === "0";
        if (button.disabled) {
            button.title = "Ground is fixed at 0 V and is not plotted";
        }
        button.classList.toggle("active", application.mode === "simulation" ? application.transient.visibleNets.has(net.name) : selected?.kind === "net" && selected.id === net.id);
        button.addEventListener("click", () => application.mode === "simulation" ? toggleNetVoltage([...net.members][0]) : select({kind: "net", id: net.id}));
        netList.append(button);
    }
}


// ============================================================================
// Properties
// ============================================================================

function renderProperties() {
    propertyContent.replaceChildren();

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
    const model = document.createElement("p");
    model.textContent = `Model: ${element.model}`;
    identity.append(model);

    const connections = propertySection("Connections");
    const nets = document.createElement("dl");
    nets.className = "net-assignments";
    element.ports.forEach((nodeId, index) => {
        const port = document.createElement("dt");
        const name = document.createElement("dd");
        port.textContent = library[element.model].ports[index].name;
        name.textContent = netForNode(nodeId).name;
        nets.append(port, name);
    });
    connections.append(nets);

    const parameters = propertySection("Parameters", "parameters-box");
    for (const [name, value] of Object.entries(element.parameters)) {
        const definition = library[element.model].parameters[name];
        const update = input => {
            const value = parseFloat(input.value);
            element.parameters[name] = Number.isNaN(value) ? undefined : value;
            input.setCustomValidity(Number.isNaN(value) ? "Numeric value required." : "");
            input.toggleAttribute("aria-invalid", Number.isNaN(value));
        };
        const normalize = input => {
            update(input);
            if (element.parameters[name] !== undefined) {
                input.value = element.parameters[name].toString();
            }
        };
        appendProperty(name, value, update, normalize, parameters, definition.unit, true);
    }
    if (!Object.keys(element.parameters).length) {
        parameters.append("No parameters");
    }
}

function renderSimulationProperties() {
    const status = propertySection("Simulation mode");
    const explanation = document.createElement("p");
    explanation.textContent = "The schematic is frozen. Toggle net voltages and port currents in the schematic or signal lists.";
    status.append(explanation);

    const active = propertySection("Displayed signals", "simulation-signals");
    const signals = [];
    for (const net of application.transient.visibleNets) {
        signals.push(`V(${net})`);
    }
    for (const [reference, ports] of application.transient.visiblePorts) {
        for (const port of ports) {
            signals.push(`I(${reference}, ${port})`);
        }
    }
    if (!signals.length) {
        active.append("No signals selected");
        return;
    }
    const list = document.createElement("ul");
    for (const signal of signals) {
        const item = document.createElement("li");
        item.textContent = signal;
        list.append(item);
    }
    active.append(list);
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
    if (application.mode === "simulation") {
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
        for (const nodeId of marker.ports) {
            for (const wire of [...circuit.wires.values()]) {
                if (wire.a === nodeId || wire.b === nodeId) {
                    deleteWire(wire.id);
                }
            }
            circuit.nodes.delete(nodeId);
        }
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

        for (const nodeId of element.ports) {
            for (const wire of [...circuit.wires.values()]) {

                if (wire.a === nodeId || wire.b === nodeId) {
                    deleteWire(wire.id);
                }
            }

            circuit.nodes.delete(nodeId);
        }

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
