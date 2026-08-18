import {compileAC} from "./api.js?v=2";

export function createACState() {
    return {
        visibleNets: new Set(),
        visibleElementSignals: new Map(),
        selectedInput: null,
        operatingTime: "0",
        minimumFrequency: "",
        maximumFrequency: "",
        pointCount: "201",
        residualTolerance: "1e-10",
        state: "idle",
        message: "",
        results: new Map(),
    };
}

export function acConfiguration(state) {
    const operatingTime = Number(state.operatingTime);
    const minimumFrequency = Number(state.minimumFrequency);
    const maximumFrequency = Number(state.maximumFrequency);
    const pointCount = Number(state.pointCount);
    const residualTolerance = Number(state.residualTolerance);
    if (!state.operatingTime.trim() || !Number.isFinite(operatingTime)) throw new Error("Operating-point time must be finite.");
    if (!state.minimumFrequency.trim() || !Number.isFinite(minimumFrequency) || !(minimumFrequency > 0)) {
        throw new Error("Minimum frequency must be positive and finite.");
    }
    if (!state.maximumFrequency.trim() || !Number.isFinite(maximumFrequency) || !(maximumFrequency > minimumFrequency)) {
        throw new Error("Maximum frequency must be greater than minimum frequency.");
    }
    if (!Number.isSafeInteger(pointCount) || pointCount < 2) throw new Error("Frequency point count must be an integer of at least 2.");
    if (!Number.isFinite(residualTolerance) || !(residualTolerance > 0)) throw new Error("Newton residual tolerance must be positive and finite.");
    return {operatingTime, minimumFrequency, maximumFrequency, pointCount, residualTolerance};
}

export async function compileACSimulation(elements, inputs) {
    const compilation = await compileAC(elements, inputs);
    const bytes = Uint8Array.from(atob(compilation.wasm), character => character.charCodeAt(0));
    const wrapper = new Blob([compilation.javascript], {type: "text/javascript"});
    const url = URL.createObjectURL(wrapper);
    try {
        const module = await import(url);
        return {
            solver: await module.AntispiceSolver.instantiate(bytes),
            layout: module.circuitLayout,
            stateSize: compilation.stateSize,
        };
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function logarithmicFrequencies(minimum, maximum, count) {
    const frequencies = new Float64Array(count);
    const ratio = maximum / minimum;
    for (let index = 0; index < count; ++index) frequencies[index] = minimum * ratio ** (index / (count - 1));
    return frequencies;
}

export function runACSweeps(solver, layout, configuration) {
    solver.reset();
    const operatingPoint = solver.initializeAC(configuration.operatingTime, {residualTolerance: configuration.residualTolerance});
    const frequencies = logarithmicFrequencies(configuration.minimumFrequency, configuration.maximumFrequency, configuration.pointCount);
    const results = new Map();
    for (const [index, analysisCase] of layout.acCases.entries()) {
        results.set(analysisCase.reference, solver.sweepAC(index, frequencies));
    }
    return {operatingPoint, results};
}
