export const GRID = 20;

export function snap(value) {
    return Math.round(value / GRID) * GRID;
}

export function snapPoint(point) {
    return {x: snap(point.x), y: snap(point.y)};
}

export function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function rotatePoint(point, degrees) {
    const radians = degrees * Math.PI / 180;
    return {x: Math.round(point.x * Math.cos(radians) - point.y * Math.sin(radians)), y: Math.round(point.x * Math.sin(radians) + point.y * Math.cos(radians))};
}

export function rotatedAxis(axis, degrees) {
    return degrees % 180 ? axis === "h" ? "v" : "h" : axis;
}

export function routeOrthogonally(anchors) {
    const points = [{...anchors[0]}];
    for (let i = 1; i < anchors.length; ++i) {
        points.push(...routeSpan(anchors[i - 1], anchors[i]));
    }
    return simplifyRoute(points);
}

function routeSpan(a, b) {
    if (a.y === b.y && a.axis !== "v" && b.axis !== "v" || a.x === b.x && a.axis !== "h" && b.axis !== "h") {
        return [{...b}];
    }
    if (a.axis === "h" && b.axis === "h") {
        let x = snap((a.x + b.x) / 2);
        if (x === a.x || x === b.x) {
            x = a.x + (b.x > a.x ? -GRID : GRID);
        }
        return [{x, y: a.y}, {x, y: b.y}, {...b}];
    }
    if (a.axis === "v" && b.axis === "v") {
        let y = snap((a.y + b.y) / 2);
        if (y === a.y || y === b.y) {
            y = a.y + (b.y > a.y ? -GRID : GRID);
        }
        return [{x: a.x, y}, {x: b.x, y}, {...b}];
    }
    if (a.axis === "v" || b.axis === "h") {
        return mixedRoute(a, b, "v");
    }
    return mixedRoute(a, b, "h");
}

function mixedRoute(a, b, firstAxis) {
    const corner = firstAxis === "h" ? {x: b.x, y: a.y} : {x: a.x, y: b.y};
    if ((corner.x !== a.x || corner.y !== a.y) && (corner.x !== b.x || corner.y !== b.y)) {
        return [corner, {...b}];
    }
    if (firstAxis === "h") {
        const x = a.x + (b.x >= a.x ? GRID : -GRID);
        const y = b.y + (b.y >= a.y ? GRID : -GRID);
        return [{x, y: a.y}, {x, y}, {x: b.x, y}, {...b}];
    }
    const y = a.y + (b.y >= a.y ? GRID : -GRID);
    const x = b.x + (b.x >= a.x ? GRID : -GRID);
    return [{x: a.x, y}, {x, y}, {x, y: b.y}, {...b}];
}

export function simplifyRoute(points) {
    const result = [];
    const between = (value, a, b) => value >= Math.min(a, b) && value <= Math.max(a, b);
    for (const point of points) {
        result.push({x: point.x, y: point.y});
        while (result.length > 1) {
            const a = result.at(-3);
            const b = result.at(-2);
            const c = result.at(-1);
            if (b.x === c.x && b.y === c.y) {
                result.pop();
                break;
            }
            if (a && (a.x === b.x && b.x === c.x && between(b.y, a.y, c.y) || a.y === b.y && b.y === c.y && between(b.x, a.x, c.x))) {
                result.splice(-2, 1);
            } else {
                break;
            }
        }
    }
    return result;
}
