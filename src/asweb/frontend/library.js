const NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
    const element = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, value);
    }
    return element;
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

function sourceDefinition(controlled, current, referencePrefix) {
    const ports = controlled ? [{name: "+", x: 0, y: -40, axis: "v"}, {name: "-", x: 0, y: 40, axis: "v"}, {name: "control+", x: -40, y: -20, axis: "h"}, {name: "control-", x: -40, y: 20, axis: "h"}] : [{name: "+", x: 0, y: -40, axis: "v"}, {name: "-", x: 0, y: 40, axis: "v"}];

    return {
        referencePrefix,
        labelPosition: {x: 28, y: -14},
        parameters: controlled ? {gain: {unit: "", default: 1}} : current ? {current: {unit: "A"}} : {voltage: {unit: "V"}},
        hitBox: {x: -45, y: -45, width: 90, height: 90},
        ports,
        draw(g) {
            addLine(g, 0, -40, 0, -24);
            addLine(g, 0, 24, 0, 40);
            if (controlled) {
                addPath(g, "M 0 -24 L 24 0 L 0 24 L -24 0 Z");
                addLine(g, -40, -20, -20, -20);
                addLine(g, -40, 20, -20, 20);
            } else {
                addCircle(g, 0, 0, 24);
            }
            if (current) {
                addLine(g, 0, 13, 0, -13);
                addPath(g, "M -6 -6 L 0 -14 L 6 -6");
            } else {
                addLine(g, -6, -9, 6, -9);
                addLine(g, 0, -15, 0, -3);
                addLine(g, -6, 10, 6, 10);
            }
        }
    };
}

function transistorDefinition(npn) {
    return {
        referencePrefix: "Q",
        labelPosition: {x: 32, y: -14},
        parameters: {},
        hitBox: {x: -45, y: -42, width: 90, height: 84},
        ports: [{name: "B", x: -40, y: 0, axis: "h"}, {name: "C", x: 20, y: -40, axis: "v"}, {name: "E", x: 20, y: 40, axis: "v"}],
        draw(g) {
            addLine(g, -40, 0, -10, 0);
            addLine(g, -10, -20, -10, 20);
            addLine(g, -10, -12, 20, -40);
            addLine(g, -10, 12, 20, 40);
            addArrow(g, npn ? -6 : 6, npn ? 16 : 27, npn ? 6 : -6, npn ? 27 : 16);
            addCircle(g, 0, 0, 30);
        }
    };
}

function fetDefinition(p) {
    return {
        referencePrefix: "Q",
        labelPosition: {x: 32, y: -14},
        parameters: {},
        hitBox: {x: -45, y: -42, width: 90, height: 84},
        ports: [{name: "G", x: -40, y: 0, axis: "h"}, {name: "D", x: 20, y: -40, axis: "v"}, {name: "S", x: 20, y: 40, axis: "v"}],
        draw(g) {
            addLine(g, -40, 0, -15, 0);
            addLine(g, -10, -22, -10, 22);
            addLine(g, 3, -20, 3, 20);
            addLine(g, 3, -16, 20, -16);
            addLine(g, 20, -16, 20, -40);
            addLine(g, 3, 16, 20, 16);
            addLine(g, 20, 16, 20, 40);
            addLine(g, 3, 0, 14, 0);
            addArrow(g, p ? -11 : -21, 0, p ? -21 : -11, 0);
            addCircle(g, 0, 0, 30);
        }
    };
}

export const library = {
    resistor: {
        referencePrefix: "R",
        labelPosition: {x: -18, y: -18},
        parameters: {resistance: {unit: "Ω"}},
        hitBox: {x: -45, y: -15, width: 90, height: 30},
        ports: [{name: "1", x: -40, y: 0, axis: "h"}, {name: "2", x: 40, y: 0, axis: "h"}],
        draw(g) {
            addLine(g, -40, 0, -25, 0);
            addPath(g, "M -25 0 L -20 -10 L -10 10 L 0 -10 L 10 10 L 20 -10 L 25 0");
            addLine(g, 25, 0, 40, 0);
        }
    },
    capacitor: {
        referencePrefix: "C",
        labelPosition: {x: -18, y: -20},
        parameters: {capacitance: {unit: "F"}},
        hitBox: {x: -45, y: -20, width: 90, height: 40},
        ports: [{name: "1", x: -40, y: 0, axis: "h"}, {name: "2", x: 40, y: 0, axis: "h"}],
        draw(g) {
            addLine(g, -40, 0, -8, 0);
            addLine(g, 8, 0, 40, 0);
            addLine(g, -8, -15, -8, 15);
            addLine(g, 8, -15, 8, 15);
        }
    },
    inductor: {
        referencePrefix: "L",
        labelPosition: {x: -18, y: -20},
        parameters: {inductance: {unit: "H"}},
        hitBox: {x: -45, y: -18, width: 90, height: 36},
        ports: [{name: "1", x: -40, y: 0, axis: "h"}, {name: "2", x: 40, y: 0, axis: "h"}],
        draw(g) {
            addLine(g, -40, 0, -24, 0);
            addPath(g, "M -24 0 C -24 -16 -8 -16 -8 0 C -8 -16 8 -16 8 0 C 8 -16 24 -16 24 0");
            addLine(g, 24, 0, 40, 0);
        }
    },
    diode: {
        referencePrefix: "D",
        labelPosition: {x: -18, y: -20},
        parameters: {},
        hitBox: {x: -45, y: -18, width: 90, height: 36},
        ports: [{name: "A", x: -40, y: 0, axis: "h"}, {name: "K", x: 40, y: 0, axis: "h"}],
        draw(g) {
            addLine(g, -40, 0, -14, 0);
            addPath(g, "M -14 -14 L 14 0 L -14 14 Z");
            addLine(g, 14, -16, 14, 16);
            addLine(g, 14, 0, 40, 0);
        }
    },
    "voltage-source": sourceDefinition(false, false, "V"),
    "current-source": sourceDefinition(false, true, "I"),
    "npn-bjt": transistorDefinition(true),
    "pnp-bjt": transistorDefinition(false),
    "n-fet": fetDefinition(false),
    "p-fet": fetDefinition(true),
    GND: {
        kind: "marker",
        hitBox: {x: -20, y: -35, width: 40, height: 52},
        ports: [{name: "GND", x: 0, y: -30, axis: "v"}],
        draw(g) {
            addLine(g, 0, -30, 0, 0);
            addLine(g, -16, 0, 16, 0);
            addLine(g, -10, 6, 10, 6);
            addLine(g, -4, 12, 4, 12);
        }
    }
};
