import { Point } from "./krakenTypes";

/**
 * Extracts an image area defined by a polygon boundary.
 */
export function getPolygonCrop(image: HTMLImageElement, boundary: Point[]): string | null {
    if (!boundary || boundary.length < 3) return null;

    const xs = boundary.map(p => p[0]);
    const ys = boundary.map(p => p[1]);
    const minX = Math.floor(Math.min(...xs));
    const minY = Math.floor(Math.min(...ys));
    const width = Math.ceil(Math.max(...xs)) - minX;
    const height = Math.ceil(Math.max(...ys)) - minY;

    if (width <= 0 || height <= 0) return null;

    const offCanvas = document.createElement("canvas");
    offCanvas.width = width;
    offCanvas.height = height;
    const ctx = offCanvas.getContext("2d");
    if (!ctx) return null;

    // Create a polygon clipping path
    ctx.beginPath();
    ctx.moveTo(boundary[0][0] - minX, boundary[0][1] - minY);
    for (let i = 1; i < boundary.length; i++) {
        ctx.lineTo(boundary[i][0] - minX, boundary[i][1] - minY);
    }
    ctx.closePath();
    ctx.clip();

    // Draw the image, only the clipped polygon will be rendered
    ctx.drawImage(image, minX, minY, width, height, 0, 0, width, height);

    return offCanvas.toDataURL("image/png");
}
