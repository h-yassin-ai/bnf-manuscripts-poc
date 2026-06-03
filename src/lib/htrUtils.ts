import { Point } from "./krakenTypes";

/**
 * Crops a polygon region from a page image and returns a raw base64 PNG string
 * (without the data: URI prefix — the API strips it anyway, but we send raw).
 */
export async function cropLineToBase64(
    imageSrc: string,
    boundary: Point[]
): Promise<string | null> {
    if (!boundary || boundary.length < 3) return null;

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const xs = boundary.map((p) => p[0]);
            const ys = boundary.map((p) => p[1]);
            const minX = Math.floor(Math.min(...xs));
            const minY = Math.floor(Math.min(...ys));
            const maxX = Math.ceil(Math.max(...xs));
            const maxY = Math.ceil(Math.max(...ys));
            const width = maxX - minX;
            const height = maxY - minY;

            if (width <= 0 || height <= 0) { resolve(null); return; }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) { resolve(null); return; }

            // Create a polygon clipping path
            ctx.beginPath();
            ctx.moveTo(boundary[0][0] - minX, boundary[0][1] - minY);
            for (let i = 1; i < boundary.length; i++) {
                ctx.lineTo(boundary[i][0] - minX, boundary[i][1] - minY);
            }
            ctx.closePath();
            ctx.clip();

            // Draw the image, only the clipped polygon will be rendered
            ctx.drawImage(img, minX, minY, width, height, 0, 0, width, height);

            const dataUrl = canvas.toDataURL("image/png");
            resolve(dataUrl.split(",")[1]);
        };
        img.onerror = () => resolve(null);
        img.src = imageSrc;
    });
}


/**
 * Maps a confidence score (0–1) to a CSS color string.
 *  ≥ 0.80  → emerald green
 *  ≥ 0.55  → amber/yellow
 *  ≥ 0.35  → orange
 *  < 0.35  → rose/red
 */
export function colorFromScore(score: number): string {
    if (score >= 0.80) return "#22c55e"; // green-500
    if (score >= 0.55) return "#eab308"; // yellow-500
    if (score >= 0.35) return "#f97316"; // orange-500
    return "#ef4444";                    // red-500
}

/**
 * Splits text into words and assigns a color to each based on the beam score.
 * Since we have a single beam-level score, all words in a beam get the same color.
 * This is an intentional simplification — better than showing nothing.
 */
export function colorizeWords(
    text: string,
    score: number
): { word: string; color: string }[] {
    if (!text) return [];
    const color = colorFromScore(score);
    return text.split(/\s+/).filter(Boolean).map((word) => ({ word, color }));
}
