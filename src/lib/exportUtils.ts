import JSZip from 'jszip';
import { KrakenSegmentation } from './krakenTypes';
import { getPolygonCrop } from './cropUtils';

export async function exportSegmentedImages(
    images: string[],
    segmentationsByPage: Record<number, KrakenSegmentation>,
    transcriptionsByPage: Record<number, Record<string, string>>
): Promise<Blob> {
    const zip = new JSZip();
    let csvContent = "Page,Ligne,ID_Ligne,Fichier_Image,Transcription\n";

    for (let pageIdx = 0; pageIdx < images.length; pageIdx++) {
        const imageSrc = images[pageIdx];
        const segmentation = segmentationsByPage[pageIdx];
        const transcriptions = transcriptionsByPage[pageIdx] || {};

        if (!segmentation || segmentation.lines.length === 0) continue;

        // Load image once per page
        const img = await loadImage(imageSrc);
        const folderName = `Page_${pageIdx + 1}`;
        const pageFolder = zip.folder(folderName);

        if (!pageFolder) continue;

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
            const transcriptionText = transcriptions[line.id] || "";

            // Add to zip folder: page_XX_line_YY.png and .txt
            pageFolder.file(imageFileName, blob);
            pageFolder.file(textFileName, transcriptionText);

            // Add to CSV
            const escapedTranscription = transcriptionText.replace(/"/g, '""'); // Escape quotes for CSV
            csvContent += `${pageIdx + 1},${lineIdx + 1},"${line.id}","${folderName}/${imageFileName}","${escapedTranscription}"\n`;
        }
    }

    // Add CSV to root
    zip.file("metadata.csv", csvContent);

    return await zip.generateAsync({ type: "blob" });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
