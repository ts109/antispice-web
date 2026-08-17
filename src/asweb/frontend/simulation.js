import {compileCircuit} from "./api.js?v=1";

export function createTransientState() {
    return {
        visibleNets: new Set(),
        visiblePorts: new Map(),
        startTime: "0",
        endTime: "",
        minimumStepSize: "",
        maximumStepSize: "",
        relativeTolerance: "1e-4",
        voltageAbsoluteTolerance: "1e-7",
        currentAbsoluteTolerance: "1e-10",
        residualTolerance: "1e-10",
        state: "idle",
        message: "",
        result: null,
    };
}

function positiveFinite(state, name, message) {
    const text = state[name].trim();
    const value = Number(text);
    if (!text || !Number.isFinite(value) || !(value > 0)) throw new Error(message);
    return value;
}

export function transientConfiguration(state) {
    const startTime = Number(state.startTime);
    const endTime = Number(state.endTime);
    if (!state.startTime.trim() || !Number.isFinite(startTime)) throw new Error("Start time must be a finite number.");
    if (!state.endTime.trim() || !Number.isFinite(endTime)) throw new Error("Choose a finite end time.");
    if (!(endTime > startTime)) throw new Error("End time must be greater than start time.");
    const minimumStepSize = positiveFinite(state, "minimumStepSize", "Choose a positive, finite lower step-size limit.");
    const maximumStepSize = positiveFinite(state, "maximumStepSize", "Choose a positive, finite upper step-size limit.");
    if (maximumStepSize < minimumStepSize) throw new Error("The upper step-size limit must not be smaller than the lower limit.");
    return {
        startTime,
        endTime,
        minimumStepSize,
        maximumStepSize,
        relativeTolerance: positiveFinite(state, "relativeTolerance", "Relative tolerance must be positive and finite."),
        voltageAbsoluteTolerance: positiveFinite(state, "voltageAbsoluteTolerance", "Voltage absolute tolerance must be positive and finite."),
        currentAbsoluteTolerance: positiveFinite(state, "currentAbsoluteTolerance", "Current absolute tolerance must be positive and finite."),
        residualTolerance: positiveFinite(state, "residualTolerance", "Newton residual tolerance must be positive and finite."),
    };
}

export async function compileSimulation(elements) {
    const compilation = await compileCircuit(elements);
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

export function runTransient(solver, configuration) {
    solver.reset();
    const operatingPoint = solver.initializeOperatingPoint(configuration.startTime, {residualTolerance: configuration.residualTolerance});
    const result = solver.integrateAdaptiveArrays(configuration);
    return {operatingPoint, result};
}
