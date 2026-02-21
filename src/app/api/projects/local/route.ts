import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');
        const saveDir = path.join(process.cwd(), 'saved_projects');

        // Check if directory exists
        try {
            await fs.access(saveDir);
        } catch {
            // No saved projects yet
            return NextResponse.json(id ? { error: 'Project not found' } : []);
        }

        if (id) {
            // Load specific project
            const safeFilename = id.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
            const filePath = path.join(saveDir, `${safeFilename}.json`);
            try {
                const data = await fs.readFile(filePath, 'utf8');
                return NextResponse.json(JSON.parse(data));
            } catch {
                return NextResponse.json({ error: 'Project not found' }, { status: 404 });
            }
        }

        // List all projects
        const files = await fs.readdir(saveDir);
        const projects = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const filePath = path.join(saveDir, file);
                    const data = await fs.readFile(filePath, 'utf8');
                    const parsed = JSON.parse(data);

                    // Count pages from segmentations keys
                    const pagesFound = parsed.segmentations ? Object.keys(parsed.segmentations).length : 0;

                    projects.push({
                        id: parsed.id || file.replace('.json', ''),
                        lastUpdated: parsed.lastUpdated || (await fs.stat(filePath)).mtimeMs,
                        pageCount: pagesFound,
                        isLocal: true // flag to distinguish from IndexedDB
                    });
                } catch (err) {
                    console.error(`Error reading project file ${file}:`, err);
                }
            }
        }

        // Sort by last updated descending
        projects.sort((a, b) => b.lastUpdated - a.lastUpdated);

        return NextResponse.json(projects);
    } catch (error) {
        console.error('Error in local projects API:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
