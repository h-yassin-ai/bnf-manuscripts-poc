import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<Response> {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        const includeImages = formData.get("includeImages") === "true";

        if (!file) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Use HTR API URL base to target the /segment endpoint
        const targetUrl = (process.env.PYTHON_HTR_API_URL || "http://127.0.0.1:8001/predict_batch").replace("/predict_batch", "/segment");

        console.log(`[Next.js HTR Proxy] Forwarding segmentation to ${targetUrl}`);
        
        const formDataToSend = new FormData();
        const imageBlob = new Blob([buffer], { type: file.type || "image/png" });
        formDataToSend.append("file", imageBlob, file.name || "image.png");

        const response = await fetch(targetUrl, {
            method: "POST",
            body: formDataToSend,
        });

        if (!response.ok) {
            const err = await response.text();
            console.error(`[Next.js HTR Proxy] Segmentation backend returned error: ${err}`);
            return NextResponse.json({ error: `Python Kraken API error: ${err}` }, { status: response.status });
        }

        const segmentation = await response.json();

        if (includeImages && segmentation.lines) {
            const image = sharp(buffer);
            const { width, height } = await image.metadata();

            const linesWithImages = await Promise.all(segmentation.lines.map(async (line: any, index: number) => {
                // Kraken returns baseline and boundary. We use boundary for cropping.
                // Boundary is a list of points [[x,y], [x,y], ...]
                const points = line.boundary;
                if (!points || points.length === 0) return line;

                const xs = points.map((p: any) => p[0]);
                const ys = points.map((p: any) => p[1]);
                const minX = Math.max(0, Math.min(...xs));
                const minY = Math.max(0, Math.min(...ys));
                const maxX = Math.min(width || 0, Math.max(...xs));
                const maxY = Math.min(height || 0, Math.max(...ys));

                const w = maxX - minX;
                const h = maxY - minY;

                if (w <= 0 || h <= 0) return line;

                try {
                    const croppedBuffer = await image
                        .extract({ left: Math.floor(minX), top: Math.floor(minY), width: Math.floor(w), height: Math.floor(h) })
                        .png()
                        .toBuffer();

                    return {
                        ...line,
                        id: `line_${index + 1}`,
                        image: `data:image/png;base64,${croppedBuffer.toString("base64")}`,
                        bbox: { x: minX, y: minY, w, h }
                    };
                } catch (err) {
                    console.error(`Error cropping line ${index}:`, err);
                    return line;
                }
            }));

            segmentation.lines = linesWithImages;
        }

        return NextResponse.json(segmentation);

    } catch (error: any) {
        console.error("Segmentation Route Error:", error);
        return NextResponse.json({ error: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
