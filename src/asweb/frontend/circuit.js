export const circuit = {
    elements: new Map(),
    markers: new Map(),
    nodes: new Map(),
    wires: new Map(),
    nets: new Map()
};

const nextIds = {element: 1, marker: 1, node: 1, wire: 1, waypoint: 1, net: 1};

export function takeId(kind) {
    return nextIds[kind]++;
}

export function withImmutableId(object, id) {
    Object.defineProperty(object, "id", {value: id, enumerable: true});
    return object;
}

export function rebuildNets() {
    const parent = new Map([...circuit.nodes.keys()].map(id => [id, id]));
    const find = id => {
        while (parent.get(id) !== id) {
            parent.set(id, parent.get(parent.get(id)));
            id = parent.get(id);
        }
        return id;
    };
    const join = (a, b) => {
        a = find(a);
        b = find(b);
        if (a !== b) {
            parent.set(b, a);
        }
    };

    for (const wire of circuit.wires.values()) {
        join(wire.a, wire.b);
    }

    const grounds = [...circuit.markers.values()].filter(marker => marker.type === "GND").flatMap(marker => marker.ports);
    for (let i = 1; i < grounds.length; ++i) {
        join(grounds[0], grounds[i]);
    }

    const groups = new Map();
    for (const id of circuit.nodes.keys()) {
        const root = find(id);
        if (!groups.has(root)) {
            groups.set(root, new Set());
        }
        groups.get(root).add(id);
    }

    const oldNets = [...circuit.nets.values()];
    const usedIds = new Set();
    const usedNames = new Set();
    const nets = new Map();
    const orderedGroups = [...groups.values()].sort((a, b) => Math.min(...a) - Math.min(...b));

    for (const members of orderedGroups) {
        const ground = grounds.some(id => members.has(id));
        const candidates = oldNets.filter(net => !usedIds.has(net.id)).map(net => ({net, overlap: [...members].filter(id => net.members.has(id)).length})).filter(item => item.overlap).sort((a, b) => b.overlap - a.overlap || a.net.id - b.net.id);
        const previous = candidates[0]?.net;
        const id = previous?.id ?? takeId("net");
        let name = ground ? "0" : previous?.name;

        if (!ground && (!name || name === "0" || usedNames.has(name.toUpperCase()))) {
            name = nextNetName(usedNames);
        }

        nets.set(id, withImmutableId({name, members}, id));
        usedIds.add(id);
        usedNames.add(name.toUpperCase());
    }

    circuit.nets = nets;
}

export function nextNetName(usedNames = new Set([...circuit.nets.values()].map(net => net.name.toUpperCase()))) {
    let index = 1;
    while (usedNames.has(`N${index}`)) {
        ++index;
    }
    return `N${index}`;
}

export function netForNode(nodeId) {
    return [...circuit.nets.values()].find(net => net.members.has(nodeId));
}

export function nextReference(prefix) {
    let index = 1;
    while ([...circuit.elements.values()].some(element => element.reference.trim().toUpperCase() === (prefix + index).toUpperCase())) {
        ++index;
    }
    return prefix + index;
}

export function referenceError(reference, owner) {
    if (!reference.trim()) {
        return "Reference cannot be empty.";
    }
    return [...circuit.elements.values()].some(element => element !== owner && element.reference.trim().toUpperCase() === reference.trim().toUpperCase()) ? "Reference is already in use." : "";
}

export function netNameError(name, owner) {
    name = name.trim();
    if (!name) {
        return "Net name cannot be empty.";
    }
    return [...circuit.nets.values()].some(net => net !== owner && net.name.toUpperCase() === name.toUpperCase()) ? "Net name is already in use." : "";
}

export function generateNetlist() {
    const components = [...circuit.elements.values()].sort((a, b) => a.reference.localeCompare(b.reference, undefined, {numeric: true}));
    return components.map(element => ({reference: element.reference, model: element.model, nodes: Object.fromEntries(element.ports.map(nodeId => [circuit.nodes.get(nodeId).port, netForNode(nodeId).name])), parameters: structuredClone(element.parameters)}));
}

export function nodeDegree(nodeId) {
    let result = 0;
    for (const wire of circuit.wires.values()) {
        if (wire.a === nodeId || wire.b === nodeId) {
            ++result;
        }
    }
    return result;
}

export function nodePosition(nodeId) {
    const node = circuit.nodes.get(nodeId);
    return {x: node.x, y: node.y};
}

export function nodeAnchor(nodeId) {
    const node = circuit.nodes.get(nodeId);
    return {x: node.x, y: node.y, axis: node.axis};
}
