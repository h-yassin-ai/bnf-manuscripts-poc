import { Point } from "./krakenTypes";

/**
 * Checks if a point is inside a polygon using the Ray Casting algorithm.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];

        const intersect =
            yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Calculates the shortest distance from a point to a polyline.
 */
export function distanceToPolyline(point: Point, polyline: Point[]): number {
    let minDistance = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
        const d = distanceToSegment(point, polyline[i], polyline[i + 1]);
        if (d < minDistance) minDistance = d;
    }
    return minDistance;
}

function distanceToSegment(p: Point, v: Point, w: Point): number {
    const [px, py] = p;
    const [vx, vy] = v;
    const [wx, wy] = w;

    const l2 = (vx - wx) ** 2 + (vy - wy) ** 2;
    if (l2 === 0) return Math.sqrt((px - vx) ** 2 + (py - vy) ** 2);

    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
    t = Math.max(0, Math.min(1, t));

    const projX = vx + t * (wx - vx);
    const projY = vy + t * (wy - vy);

    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}
