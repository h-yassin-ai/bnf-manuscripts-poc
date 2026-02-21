import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { manuscriptId, data } = body;

        if (!manuscriptId || !data) {
            return NextResponse.json({ error: 'Missing manuscriptId or data' }, { status: 400 });
        }

        // Project root directory
        const saveDir = path.join(process.cwd(), 'saved_projects');

        // Ensure directory exists
        try {
            await fs.access(saveDir);
        } catch {
            await fs.mkdir(saveDir, { recursive: true });
        }

        // Sanitize filename
        const safeFilename = manuscriptId.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
        const filePath = path.join(saveDir, `${safeFilename}.json`);

        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');

        return NextResponse.json({ success: true, path: filePath });
    } catch (error) {
        console.error('Error saving to disk:', error);
        return NextResponse.json({ error: 'Failed to save to disk' }, { status: 500 });
    }
}
