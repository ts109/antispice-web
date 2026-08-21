let definitions = {};
let topology = {name: "Library", models: [], categories: []};

export async function loadLibrary() {
    const response = await fetch("/api/library");
    if (!response.ok) throw new Error(`Unable to load model library (${response.status})`);
    ({definitions, topology} = await response.json());
    return definitions;
}

export function availableDefinitions() {
    return definitions;
}

export function libraryTopology() {
    return topology;
}

export function resolveModelName(use) {
    const definition = definitions[use];
    if (!definition) return null;
    return definition.type === "model" ? use : typeof definition.model === "string" ? definition.model : null;
}

export function resolveModel(use) {
    const definition = definitions[use];
    if (!definition) return null;
    if (definition.type === "model") return definition;
    if (typeof definition.model === "string") return definitions[definition.model] ?? null;
    return definition.model?.type === "model" ? definition.model : null;
}

export function inheritedParameters(use) {
    const definition = definitions[use];
    return definition?.type === "part" ? definition.parameters : {};
}

export async function compileCircuit(elements) {
    const response = await fetch("/api/compile", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({version: 1, elements}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail ?? `Compilation failed (${response.status})`);
    return result;
}

export async function compileAC(elements, inputs) {
    const response = await fetch("/api/compile/ac", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({version: 1, elements, inputs}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail ?? `AC compilation failed (${response.status})`);
    return result;
}
