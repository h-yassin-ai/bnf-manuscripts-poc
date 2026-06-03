import JSZip from 'jszip';
import { KrakenSegmentation } from './krakenTypes';
import { getPolygonCrop } from './cropUtils';

/**
 * Normalizes Arabic text according to user requirements:
 * - Removes diacritics (harakat/vowels)
 * - Normalizes Alifs: آ, أ, إ -> ا
 * - Replaces اهـ with هـ
 */
export function normalizeArabicText(text: string): string {
    if (!text) return "";

    let normalized = text;

    // 1. Remove diacritics/vowels (Unicode range U+064B to U+065F)
    // 064B: FATHATAN, 064C: DAMMATAN, 064D: KASRATAN, 064E: FATHA, 064F: DAMMA, 0650: KASRA, 0651: SHADDA, 0652: SUKUN, etc.
    normalized = normalized.replace(/[\u064B-\u065F]/g, "");

    // 2. Normalize Alifs (أ, إ, آ -> ا)
    normalized = normalized.replace(/[أإآ]/g, "ا");

    // 3. Replace اهـ with هـ
    normalized = normalized.replace(/اهـ/g, "هـ");

    // 4. Remove <DEL> tags
    normalized = normalized.replace(/<DEL>/g, "");

    return normalized;
}


function escapeXml(unsafe: string): string {
    if (!unsafe) return "";
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
        return c;
    });
}


export async function exportSegmentedImages(
    images: string[],
    segmentationsByPage: Record<number, KrakenSegmentation>,
    transcriptionsByPage: Record<number, Record<string, string>>,
    projectPrefix: string = "",
    normalize: boolean = true
): Promise<Blob | JSZip> {
    const zip = new JSZip();
    const root = projectPrefix ? zip.folder(projectPrefix) : zip;
    if (!root) throw new Error("Could not create project folder in ZIP");

    let csvContent = "Projet,Page,Ligne,ID_Ligne,Fichier_Image,Transcription,Transcription_Originale\n";
    let myDataContent = "img_path,text\n";

    for (let pageIdx = 0; pageIdx < images.length; pageIdx++) {
        const imageSrc = images[pageIdx];
        const segmentation = segmentationsByPage[pageIdx];
        const transcriptions = transcriptionsByPage[pageIdx] || {};

        if (!segmentation || segmentation.lines.length === 0) continue;

        // Load image once per page
        const img = await loadImage(imageSrc);
        const folderName = `Page_${pageIdx + 1}`;
        const pageFolder = root.folder(folderName);

        if (!pageFolder) continue;

        // Export full page image
        const pageImageFileName = `page_${pageIdx + 1}.png`;
        const pageImageResponse = await fetch(imageSrc);
        const pageImageBlob = await pageImageResponse.blob();
        pageFolder.file(pageImageFileName, pageImageBlob);

        // XML content for the page
        let xmlContent = `<?xml version="1.0" encoding="UTF-8"?>\n<page image="${pageImageFileName}">\n`;

        // CSV entry for full page image (empty transcription fields)
        const pageCsvPath = projectPrefix ? `${projectPrefix}/${folderName}/${pageImageFileName}` : `${folderName}/${pageImageFileName}`;
        csvContent += `"${projectPrefix || 'N/A'}",${pageIdx + 1},0,"","${pageCsvPath}","",""\n`;


        for (let lineIdx = 0; lineIdx < segmentation.lines.length; lineIdx++) {
            const line = segmentation.lines[lineIdx];
            if (!line.boundary || line.boundary.length < 3) continue;

            const cropDataUrl = getPolygonCrop(img, line.boundary);
            if (!cropDataUrl) continue;

            // Convert DataURL to Blob
            const response = await fetch(cropDataUrl);
            const blob = await response.blob();

            // Filenames
            const baseFileName = `page_${pageIdx + 1}_line_${lineIdx + 1}`;
            const imageFileName = `${baseFileName}.png`;
            const textFileName = `${baseFileName}.txt`;

            // Transcription
            const originalText = transcriptions[line.id] || "";


            const finalContent = normalize ? normalizeArabicText(originalText) : originalText;

            // Add to zip folder: page_XX_line_YY.png and .txt
            pageFolder.file(imageFileName, blob);
            pageFolder.file(textFileName, finalContent);

            // Add to CSV
            const escapedOriginal = originalText.replace(/"/g, '""');
            const escapedFinal = finalContent.replace(/"/g, '""');
            const csvPath = projectPrefix ? `${projectPrefix}/${folderName}/${imageFileName}` : `${folderName}/${imageFileName}`;

            csvContent += `"${projectPrefix || 'N/A'}",${pageIdx + 1},${lineIdx + 1},"${line.id}","${csvPath}","${escapedFinal}","${escapedOriginal}"\n`;
            myDataContent += `"${csvPath}","${escapedFinal}"\n`;

            // Add to XML
            const pointsString = line.boundary.map(p => `${p[0]},${p[1]}`).join(" ");
            xmlContent += `  <line id="${line.id}" index="${lineIdx + 1}">\n`;
            xmlContent += `    <polygon points="${pointsString}" />\n`;
            xmlContent += `    <transcription>${escapeXml(finalContent)}</transcription>\n`;
            xmlContent += `  </line>\n`;
        }

        xmlContent += `</page>`;
        pageFolder.file(`page_${pageIdx + 1}_coords.xml`, xmlContent);
    }

    // Add CSVs to project root
    root.file("metadata.csv", csvContent);
    root.file("my_data.csv", myDataContent);

    // If we are part of a bulk export, return the zip object, otherwise return the blob
    return projectPrefix ? zip : await zip.generateAsync({ type: "blob" });
}

export async function bulkExportProjects(
    projectsData: Array<{
        id: string,
        images: string[],
        segmentations: Record<number, KrakenSegmentation>,
        transcriptions: Record<number, Record<string, string>>
    }>
): Promise<Blob> {
    const globalZip = new JSZip();
    let masterCsv = "Projet,Page,Ligne,ID_Ligne,Fichier_Image,Transcription,Transcription_Originale\n";
    let masterMyData = "img_path,text\n";

    for (const project of projectsData) {
        // Generate ZIP for this project
        const projectZip = await exportSegmentedImages(
            project.images,
            project.segmentations,
            project.transcriptions,
            project.id,
            true
        ) as JSZip;

        // Merge project folder into global zip
        const projectFolder = projectZip.folder(project.id);
        if (projectFolder) {
            const projectRoot = globalZip.folder(project.id);
            if (projectRoot) {
                // Read files from projectFolder and add to globalZip
                for (const [relativePath, file] of Object.entries(projectFolder.files)) {
                    if (!file.dir) {
                        const content = await (file as any).async("blob");
                        projectRoot.file(relativePath.replace(`${project.id}/`, ''), content);
                    }
                }
            }

            // Extract project CSV and append to master
            const projectCsvFile = projectFolder.file("metadata.csv");
            if (projectCsvFile) {
                const projectCsvText = await projectCsvFile.async("text");
                const lines = projectCsvText.split("\n").slice(1); // Skip header
                masterCsv += lines.filter((l: string) => l.trim()).join("\n") + "\n";
            }

            // Extract project my_data.csv and append to master
            const myDataFile = projectFolder.file("my_data.csv");
            if (myDataFile) {
                const myDataText = await myDataFile.async("text");
                const mLines = myDataText.split("\n").slice(1); // Skip header
                masterMyData += mLines.filter((l: string) => l.trim()).join("\n") + "\n";
            }
        }
    }

    globalZip.file("master_summary.csv", masterCsv);
    globalZip.file("my_data.csv", masterMyData);
    return await globalZip.generateAsync({ type: "blob" });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
