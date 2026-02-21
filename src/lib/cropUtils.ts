import { Point } from "./krakenTypes";

/**
 * Extracts an image area defined by a polygon boundary.
 */
export function getPolygonCrop(image: HTMLImageElement, boundary: Point[]): string | null {
    if (!boundary || boundary.length < 3) return null;

    // 1. Calculate bounding box
    const xs = boundary.map(p => p[0]);
    const ys = boundary.map(p => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;

    if (width <= 0 || height <= 0) return null;

    // 2. Create offscreen canvas for the crop
    const offCanvas = document.createElement("canvas");
    offCanvas.width = width;
    offCanvas.height = height;
    const ctx = offCanvas.getContext("2d");
    if (!ctx) return null;

    // 3. Create clipping region from boundary (relative to minX, minY)
    ctx.beginPath();
    boundary.forEach(([x, y], idx) => {
        if (idx === 0) ctx.moveTo(x - minX, y - minY);
        else ctx.lineTo(x - minX, y - minY);
    });
    ctx.closePath();
    ctx.clip();

    // 4. Draw the image (displaced by -minX, -minY)
    ctx.drawImage(
        image,
        minX, minY, width, height, // Source rectangle
        0, 0, width, height      // Destination rectangle
    );

    return offCanvas.toDataURL("image/png");
}
