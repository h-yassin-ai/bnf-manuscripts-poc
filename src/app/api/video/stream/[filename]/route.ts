
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ filename: string }> }
) {
    const { filename } = await context.params;
    if (!filename) {
        return new NextResponse("Filename required", { status: 400 });
    }

    // Security: Prevent directory traversal
    const safeFilename = path.basename(filename);
    const filePath = path.join(process.cwd(), 'public', 'transcriptions', safeFilename);

    if (!fs.existsSync(filePath)) {
        return new NextResponse("File not found", { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.get('range');

    const mimeType = filename.endsWith('.mp4') ? 'video/mp4' :
        filename.endsWith('.webm') ? 'video/webm' :
            filename.endsWith('.mkv') ? 'video/x-matroska' :
                'application/octet-stream';

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });

        // Convert node stream to web stream
        const stream = new ReadableStream({
            start(controller) {
                file.on('data', (chunk) => controller.enqueue(chunk));
                file.on('end', () => controller.close());
                file.on('error', (err) => controller.error(err));
            }
        });

        const headers = new Headers();
        headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Length', chunksize.toString());
        headers.set('Content-Type', mimeType);

        return new NextResponse(stream, {
            status: 206,
            headers,
        });
    } else {
        const file = fs.createReadStream(filePath);
        const stream = new ReadableStream({
            start(controller) {
                file.on('data', (chunk) => controller.enqueue(chunk));
                file.on('end', () => controller.close());
                file.on('error', (err) => controller.error(err));
            }
        });

        const headers = new Headers();
        headers.set('Content-Length', fileSize.toString());
        headers.set('Content-Type', mimeType);

        return new NextResponse(stream, {
            status: 200,
            headers,
        });
    }
}
