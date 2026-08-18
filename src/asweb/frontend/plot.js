const COLORS = ["#174aff", "#ff3d2e", "#00a878", "#8b2cff", "#f08c00", "#111111", "#009ec1", "#d10078"];

export class TransientPlot {
    constructor(root) {
        this.root = root;
        this.legend = root.querySelector(".plot-legend");
        this.canvases = [...root.querySelectorAll("canvas")];
        [this.background, this.tracesCanvas, this.interaction] = this.canvases;
        this.contexts = this.canvases.map(canvas => canvas.getContext("2d"));
        this.data = null;
        this.traces = [];
        this.view = null;
        this.cursor = null;
        this.drag = null;
        this.frame = null;
        this.downsampleScratch = [];
        this.horizontal = {label: "TIME / s", format: formatTime, ticks: axisTicks};
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(root.querySelector(".plot-canvas-stack"));
        this.interaction.addEventListener("wheel", event => this.zoom(event), {passive: false});
        this.interaction.addEventListener("pointerdown", event => this.beginPan(event));
        this.interaction.addEventListener("pointermove", event => this.pointerMove(event));
        this.interaction.addEventListener("pointerup", event => this.endPan(event));
        this.interaction.addEventListener("pointercancel", event => this.endPan(event));
        this.interaction.addEventListener("pointerleave", () => {
            if (!this.drag) {
                this.cursor = null;
                this.drawInteraction();
            }
        });
        this.interaction.addEventListener("dblclick", () => this.fit());
    }

    setData(data) {
        this.data = data;
        this.refreshLayout();
        this.fit();
    }

    setTraces(traces) {
        this.traces = traces.map((trace, index) => ({...trace, color: COLORS[index % COLORS.length]}));
        this.renderLegend();
        this.refreshLayout();
        this.scheduleRender();
    }

    setHorizontalAxis(label, {format = formatValue, ticks = axisTicks} = {}) {
        this.horizontal = {label, format, ticks};
        this.scheduleRender();
    }

    refreshLayout() {
        // The plot is constructed while edit mode hides it. ResizeObserver does
        // not consistently report the subsequent display:none -> grid change,
        // so measure it explicitly whenever it becomes relevant.
        requestAnimationFrame(() => this.resize());
    }

    fit() {
        if (this.data?.sampleCount) {
            this.view = {start: this.data.times[0], end: this.data.times[this.data.sampleCount - 1]};
        } else {
            this.view = null;
        }
        this.scheduleRender();
    }

    resize() {
        const bounds = this.interaction.getBoundingClientRect();
        if (!(bounds.width > 0 && bounds.height > 0)) return;
        const ratio = window.devicePixelRatio || 1;
        for (const canvas of this.canvases) {
            canvas.width = Math.max(1, Math.round(bounds.width * ratio));
            canvas.height = Math.max(1, Math.round(bounds.height * ratio));
            canvas.style.width = `${bounds.width}px`;
            canvas.style.height = `${bounds.height}px`;
        }
        for (const context of this.contexts) context.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.width = bounds.width;
        this.height = bounds.height;
        this.scheduleRender();
    }

    scheduleRender() {
        if (this.frame !== null) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            this.draw();
        });
    }

    renderLegend() {
        this.legend.replaceChildren();
        for (const trace of this.traces) {
            const item = document.createElement("span");
            const swatch = document.createElement("i");
            swatch.style.background = trace.color;
            item.textContent = trace.label;
            item.prepend(swatch);
            this.legend.append(item);
        }
    }

    geometry() {
        const left = 58;
        const right = 16;
        const top = 22;
        const bottom = 30;
        const units = [...new Set(this.traces.map(trace => trace.unit))];
        const lanes = new Map();
        const laneHeight = Math.max(1, (this.height - top - bottom) / Math.max(1, units.length));
        units.forEach((unit, index) => lanes.set(unit, {top: top + index * laneHeight, bottom: top + (index + 1) * laneHeight}));
        return {left, right, top, bottom, plotWidth: Math.max(1, this.width - left - right), lanes, units};
    }

    visibleIndices() {
        if (!this.data?.sampleCount || !this.view) return [0, 0];
        const times = this.data.times;
        let low = 0;
        let high = this.data.sampleCount;
        while (low < high) {
            const middle = low + high >> 1;
            if (times[middle] < this.view.start) low = middle + 1;
            else high = middle;
        }
        const first = Math.max(0, low - 1);
        low = first;
        high = this.data.sampleCount;
        while (low < high) {
            const middle = low + high >> 1;
            if (times[middle] <= this.view.end) low = middle + 1;
            else high = middle;
        }
        return [first, Math.min(this.data.sampleCount, low + 1)];
    }

    ranges(first, end) {
        const ranges = new Map();
        for (const unit of new Set(this.traces.map(trace => trace.unit))) {
            let minimum = Infinity;
            let maximum = -Infinity;
            let strictlyPositive = true;
            const unitTraces = this.traces.filter(trace => trace.unit === unit);
            for (const trace of this.traces) {
                if (trace.unit !== unit) continue;
                for (let sample = first; sample < end; ++sample) {
                    const value = traceValue(this.data, trace, sample);
                    if (Number.isFinite(value)) {
                        strictlyPositive &&= value > 0;
                        minimum = Math.min(minimum, value);
                        maximum = Math.max(maximum, value);
                    }
                }
            }
            if (minimum !== Infinity) {
                const logarithmic = unitTraces.every(trace => trace.scale === "log-if-positive") && strictlyPositive;
                if (logarithmic) {
                    let plotMinimum = Math.log10(minimum);
                    let plotMaximum = Math.log10(maximum);
                    if (plotMinimum === plotMaximum) {
                        plotMinimum -= 0.1;
                        plotMaximum += 0.1;
                    } else {
                        const padding = (plotMaximum - plotMinimum) * 0.08;
                        plotMinimum -= padding;
                        plotMaximum += padding;
                    }
                    ranges.set(unit, {minimum, maximum, plotMinimum, plotMaximum, scale: "log"});
                } else if (minimum === maximum) {
                    const padding = Math.max(1e-12, Math.abs(minimum) * 0.1, 1e-6);
                    minimum -= padding;
                    maximum += padding;
                    ranges.set(unit, {minimum, maximum, plotMinimum: minimum, plotMaximum: maximum, scale: "linear"});
                } else {
                    const padding = (maximum - minimum) * 0.08;
                    minimum -= padding;
                    maximum += padding;
                    ranges.set(unit, {minimum, maximum, plotMinimum: minimum, plotMaximum: maximum, scale: "linear"});
                }
            }
        }
        return ranges;
    }

    draw() {
        if (!this.width || !this.height) return;
        this.contexts.forEach(context => context.clearRect(0, 0, this.width, this.height));
        const geometry = this.geometry();
        if (!this.data?.sampleCount || !this.traces.length || !geometry.units.length) {
            this.drawEmpty();
            return;
        }
        const [first, end] = this.visibleIndices();
        const ranges = this.ranges(first, end);
        this.currentGeometry = geometry;
        this.currentRanges = ranges;
        this.drawBackground(geometry, ranges);
        this.drawTraces(geometry, ranges, first, end);
        this.drawInteraction();
    }

    drawEmpty() {
        const context = this.contexts[0];
        context.fillStyle = "#f4f1e8";
        context.fillRect(0, 0, this.width, this.height);
        context.fillStyle = "#0a0a0a";
        context.font = "900 18px 'Courier New', monospace";
        context.fillText(this.data ? "SELECT SIGNALS" : "NO SIMULATION DATA", 24, 42);
    }

    drawBackground(geometry, ranges) {
        const context = this.contexts[0];
        context.fillStyle = "#f4f1e8";
        context.fillRect(0, 0, this.width, this.height);
        context.font = "700 10px 'Courier New', monospace";
        context.textBaseline = "middle";
        const timeTicks = this.horizontal.ticks(this.view.start, this.view.end, Math.max(2, Math.floor(geometry.plotWidth / 90)));
        for (const unit of geometry.units) {
            const lane = geometry.lanes.get(unit);
            const range = ranges.get(unit);
            context.strokeStyle = "#0a0a0a";
            context.lineWidth = 3;
            context.strokeRect(geometry.left, lane.top, geometry.plotWidth, lane.bottom - lane.top);
            context.fillStyle = "#0a0a0a";
            context.textAlign = "left";
            context.fillText(unit === "V" ? "VOLT" : unit === "A" ? "AMP" : unit || "VALUE", 8, lane.top + 9);
            if (range) {
                const targetCount = Math.max(2, Math.floor((lane.bottom - lane.top) / 45));
                const valueTicks = unit === "rad"
                    ? radianAxisTicks(range.plotMinimum, range.plotMaximum)
                    : range.scale === "log"
                        ? logarithmicValueTicks(range.plotMinimum, range.plotMaximum)
                        : axisTicks(range.plotMinimum, range.plotMaximum, targetCount);
                for (const value of valueTicks.values) {
                    const y = lane.bottom - (axisCoordinate(value, range) - range.plotMinimum) / (range.plotMaximum - range.plotMinimum) * (lane.bottom - lane.top);
                    context.strokeStyle = value === 0 ? "#737373" : "#b8b6ae";
                    context.lineWidth = value === 0 ? 2 : 1;
                    context.beginPath();
                    context.moveTo(geometry.left, Math.round(y) + 0.5);
                    context.lineTo(geometry.left + geometry.plotWidth, Math.round(y) + 0.5);
                    context.stroke();
                    context.fillStyle = "#0a0a0a";
                    context.textAlign = "right";
                    context.fillText(valueTicks.format?.(value) ?? formatValue(value), geometry.left - 6, y);
                }
            }
            for (const value of timeTicks.values) {
                const x = geometry.left + (value - this.view.start) / (this.view.end - this.view.start || 1) * geometry.plotWidth;
                context.strokeStyle = value === 0 ? "#737373" : "#d4d1c8";
                context.lineWidth = value === 0 ? 2 : 1;
                context.beginPath();
                context.moveTo(Math.round(x) + 0.5, lane.top);
                context.lineTo(Math.round(x) + 0.5, lane.bottom);
                context.stroke();
            }
        }
        context.textAlign = "center";
        context.fillStyle = "#0a0a0a";
        for (const value of timeTicks.values) {
            const x = geometry.left + (value - this.view.start) / (this.view.end - this.view.start || 1) * geometry.plotWidth;
            context.fillText(this.horizontal.format(value), x, this.height - 13);
        }
        context.textAlign = "left";
        context.fillText(this.horizontal.label, 8, this.height - 13);
    }

    drawTraces(geometry, ranges, first, end) {
        const context = this.contexts[1];
        const duration = this.view.end - this.view.start || 1;
        for (const [traceIndex, trace] of this.traces.entries()) {
            const lane = geometry.lanes.get(trace.unit);
            const range = ranges.get(trace.unit);
            if (!lane || !range) continue;
            const yFor = value => lane.bottom - (axisCoordinate(value, range) - range.plotMinimum) / (range.plotMaximum - range.plotMinimum) * (lane.bottom - lane.top);
            context.strokeStyle = trace.color;
            context.lineWidth = 2.5;
            context.lineCap = "square";
            if (end - first <= geometry.plotWidth * 2) {
                context.beginPath();
                let started = false;
                for (let sample = first; sample < end; ++sample) {
                    const value = traceValue(this.data, trace, sample);
                    if (!Number.isFinite(value)) continue;
                    const x = geometry.left + (this.data.times[sample] - this.view.start) / duration * geometry.plotWidth;
                    if (started) context.lineTo(x, yFor(value));
                    else {
                        context.moveTo(x, yFor(value));
                        started = true;
                    }
                }
                context.stroke();
                continue;
            }
            const width = Math.max(1, Math.ceil(geometry.plotWidth));
            let scratch = this.downsampleScratch[traceIndex];
            if (!scratch || scratch.minima.length !== width) {
                scratch = {minima: new Float64Array(width), maxima: new Float64Array(width)};
                this.downsampleScratch[traceIndex] = scratch;
            }
            const minima = scratch.minima;
            const maxima = scratch.maxima;
            minima.fill(Infinity);
            maxima.fill(-Infinity);
            for (let sample = first; sample < end; ++sample) {
                const value = traceValue(this.data, trace, sample);
                const pixel = Math.floor((this.data.times[sample] - this.view.start) / duration * width);
                if (pixel >= 0 && pixel < width && Number.isFinite(value)) {
                    minima[pixel] = Math.min(minima[pixel], value);
                    maxima[pixel] = Math.max(maxima[pixel], value);
                }
            }
            context.beginPath();
            for (let pixel = 0; pixel < width; ++pixel) {
                if (minima[pixel] === Infinity) continue;
                const x = geometry.left + pixel;
                context.moveTo(x, yFor(minima[pixel]));
                context.lineTo(x, yFor(maxima[pixel]));
            }
            context.stroke();
        }
    }

    drawInteraction() {
        if (!this.width || !this.height) return;
        const context = this.contexts[2];
        context.clearRect(0, 0, this.width, this.height);
        if (!this.cursor || !this.data?.sampleCount || !this.currentGeometry) return;
        const geometry = this.currentGeometry;
        if (this.cursor.x < geometry.left || this.cursor.x > geometry.left + geometry.plotWidth) return;
        const time = this.view.start + (this.cursor.x - geometry.left) / geometry.plotWidth * (this.view.end - this.view.start);
        const sample = nearestIndex(this.data.times, this.data.sampleCount, time);
        const x = geometry.left + (this.data.times[sample] - this.view.start) / (this.view.end - this.view.start || 1) * geometry.plotWidth;
        context.strokeStyle = "#0a0a0a";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x, this.currentGeometry.top);
        context.lineTo(x, this.height - this.currentGeometry.bottom);
        context.stroke();
        const lines = [this.horizontal.format(this.data.times[sample])];
        for (const trace of this.traces) {
            const value = traceValue(this.data, trace, sample);
            lines.push(`${trace.label} ${formatValue(value)} ${trace.unit}`);
        }
        context.font = "700 11px 'Courier New', monospace";
        const boxWidth = Math.max(...lines.map(line => context.measureText(line).width)) + 16;
        const boxHeight = lines.length * 16 + 10;
        const boxX = Math.min(this.width - boxWidth - 5, Math.max(5, x + 10));
        context.fillStyle = "#eaff00";
        context.fillRect(boxX, 6, boxWidth, boxHeight);
        context.strokeStyle = "#0a0a0a";
        context.lineWidth = 3;
        context.strokeRect(boxX, 6, boxWidth, boxHeight);
        context.fillStyle = "#0a0a0a";
        lines.forEach((line, index) => context.fillText(line, boxX + 8, 20 + index * 16));
    }

    zoom(event) {
        if (!this.view || !this.data?.sampleCount) return;
        event.preventDefault();
        const geometry = this.geometry();
        const bounds = this.interaction.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const anchor = Math.max(0, Math.min(1, (x - geometry.left) / geometry.plotWidth));
        const fullStart = this.data.times[0];
        const fullEnd = this.data.times[this.data.sampleCount - 1];
        const fullDuration = fullEnd - fullStart;
        const duration = this.view.end - this.view.start;
        const nextDuration = Math.max(fullDuration / Math.max(1, this.data.sampleCount - 1), Math.min(fullDuration, duration * Math.exp(event.deltaY * 0.0015)));
        const anchorTime = this.view.start + anchor * duration;
        this.setView(anchorTime - anchor * nextDuration, anchorTime + (1 - anchor) * nextDuration);
    }

    beginPan(event) {
        if (!this.view) return;
        this.interaction.setPointerCapture(event.pointerId);
        this.drag = {pointerId: event.pointerId, x: event.clientX, start: this.view.start, end: this.view.end};
    }

    pointerMove(event) {
        const bounds = this.interaction.getBoundingClientRect();
        this.cursor = {x: event.clientX - bounds.left, y: event.clientY - bounds.top};
        if (this.drag) {
            const geometry = this.geometry();
            const shift = -(event.clientX - this.drag.x) / geometry.plotWidth * (this.drag.end - this.drag.start);
            this.setView(this.drag.start + shift, this.drag.end + shift);
        } else this.drawInteraction();
    }

    endPan(event) {
        if (this.drag?.pointerId === event.pointerId) {
            this.interaction.releasePointerCapture(event.pointerId);
            this.drag = null;
        }
    }

    setView(start, end) {
        const fullStart = this.data.times[0];
        const fullEnd = this.data.times[this.data.sampleCount - 1];
        const duration = end - start;
        if (start < fullStart) {
            start = fullStart;
            end = start + duration;
        }
        if (end > fullEnd) {
            end = fullEnd;
            start = end - duration;
        }
        this.view = {start: Math.max(fullStart, start), end: Math.min(fullEnd, end)};
        this.scheduleRender();
    }
}

function nearestIndex(values, count, target) {
    let low = 0;
    let high = count - 1;
    while (low < high) {
        const middle = low + high >> 1;
        if (values[middle] < target) low = middle + 1;
        else high = middle;
    }
    if (low > 0 && Math.abs(values[low - 1] - target) < Math.abs(values[low] - target)) return low - 1;
    return low;
}

function traceValue(data, trace, sample) {
    if (trace.values) return trace.values[sample];
    if (trace.index !== undefined) return data.states[sample * data.stateSize + trace.index];
    if (trace.auxiliaryIndex !== undefined) return data.auxiliaries[sample * data.auxiliaryCount + trace.auxiliaryIndex];
    if (trace.terms) {
        let value = 0;
        for (const [index, coefficient] of trace.terms) {
            if (index !== null) value += coefficient * data.states[sample * data.stateSize + index];
        }
        return value;
    }
    let value = 0;
    for (const index of trace.indices ?? []) value += data.states[sample * data.stateSize + index];
    return value * (trace.coefficient ?? 1);
}

export function logarithmicAxisTicks(minimum, maximum) {
    const values = [];
    const firstDecade = Math.floor(minimum);
    const lastDecade = Math.ceil(maximum);
    for (let decade = firstDecade; decade <= lastDecade; ++decade) {
        for (const factor of [1, 2, 5]) {
            const value = decade + Math.log10(factor);
            if (value >= minimum - 1e-12 && value <= maximum + 1e-12) values.push(value);
        }
    }
    return {step: 1, values};
}

function logarithmicValueTicks(minimumExponent, maximumExponent) {
    const values = [];
    for (let decade = Math.floor(minimumExponent); decade <= Math.ceil(maximumExponent); ++decade) {
        for (const factor of [1, 2, 5]) {
            const value = factor * 10 ** decade;
            const exponent = Math.log10(value);
            if (exponent >= minimumExponent - 1e-12 && exponent <= maximumExponent + 1e-12) values.push(value);
        }
    }
    return {values};
}

export function radianAxisTicks(minimum, maximum) {
    const ticks = [
        [-Math.PI, "−π"],
        [-Math.PI / 2, "−π/2"],
        [-Math.PI / 4, "−π/4"],
        [0, "0"],
        [Math.PI / 4, "π/4"],
        [Math.PI / 2, "π/2"],
        [Math.PI, "π"],
    ];
    const labels = new Map(ticks);
    return {
        values: ticks.map(([value]) => value).filter(value => value >= minimum - 1e-12 && value <= maximum + 1e-12),
        format: value => labels.get(value),
    };
}

function axisCoordinate(value, range) {
    return range.scale === "log" ? Math.log10(value) : value;
}

function axisTicks(minimum, maximum, targetCount) {
    const span = maximum - minimum;
    if (!(span > 0) || !Number.isFinite(span)) return {step: 1, values: []};
    const roughStep = span / Math.max(1, targetCount);
    const power = 10 ** Math.floor(Math.log10(roughStep));
    const normalized = roughStep / power;
    const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    const step = factor * power;
    const first = Math.ceil(minimum / step - 1e-12) * step;
    const values = [];
    for (let value = first; value <= maximum + step * 1e-12 && values.length < 1000; value += step) {
        values.push(Math.abs(value) < step * 1e-12 ? 0 : value);
    }
    return {step, values};
}

function formatValue(value) {
    if (!Number.isFinite(value)) return "—";
    if (value === 0) return "0";
    const magnitude = Math.abs(value);
    if (magnitude >= 1e4 || magnitude < 1e-3) return value.toExponential(2);
    return value.toPrecision(4).replace(/\.?0+$/, "");
}

function formatTime(value) {
    return `${formatValue(value)} s`;
}
