
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const filePath = searchParams.get('file');

    if (!filePath) {
        return NextResponse.json({ error: "File path is required" }, { status: 400 });
    }

    console.log("Stream API Request:", filePath);
    console.log("Encoded:", encodeURIComponent(filePath));

    // Security check: ensure file is within allowed directories (optional for local POC but good practice)
    // For this POC, we'll allow absolute paths if they exist, as the python script returns absolute paths.
    // In a production app, we would sanitize strictly.

    if (!fs.existsSync(filePath)) {
        console.error("File not found on disk:", filePath);
        return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'video/mp4';
    if (ext === '.srt') contentType = 'application/x-subrip';
    if (ext === '.vtt') contentType = 'text/vtt';

    const range = req.headers.get('range');

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize.toString(),
            'Content-Type': contentType,
        };

        // ReadableStream from node stream
        const iterator = file[Symbol.asyncIterator]();
        const stream = new ReadableStream({
            async pull(controller) {
                const { value, done } = await iterator.next();
                if (done) controller.close();
                else controller.enqueue(value);
            },
        });

        return new NextResponse(stream, { status: 206, headers: head });
    } else {
        const head = {
            'Content-Length': fileSize.toString(),
            'Content-Type': contentType,
        };
        const file = fs.createReadStream(filePath);

        // ReadableStream from node stream
        const iterator = file[Symbol.asyncIterator]();
        const stream = new ReadableStream({
            async pull(controller) {
                const { value, done } = await iterator.next();
                if (done) controller.close();
                else controller.enqueue(value);
            },
        });

        return new NextResponse(stream, { status: 200, headers: head });
    }
}
