// This utility MUST only be called on the client side.
export async function pdfToImages(file: File): Promise<string[]> {
    // Dynamic import to avoid SSR issues with DOMMatrix/Canvas
    const pdfjs = await import('pdfjs-dist');

    // Configure worker
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 }); // Standard scale for better compatibility
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) continue;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport,
        };
        // @ts-ignore - Handle version-specific type differences
        await page.render(renderContext).promise;

        // Revert to PNG as it's more standard for some vision models
        images.push(canvas.toDataURL('image/png'));
    }

    return images;
}
