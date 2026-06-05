"use client";

import React, { useState, useEffect, useRef } from "react";
import { pdfToImages } from "../lib/pdfUtils";
import { KrakenSegmentation, KrakenLine, Point } from "../lib/krakenTypes";
import KrakenViewer from "./KrakenViewer";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
    ChevronLeft,
    ChevronRight,
    Upload,
    Scissors,
    FileDown,
    PlusCircle,
    Trash2,
    Save,
    Loader2,
    BookOpen,
    Type,
    ArrowUp,
    ArrowDown,
    Eye,
    EyeOff,
    HardDriveDownload,
    ScanText,
    CheckCircle2,
    Database,
    FileCode2,
    HelpCircle,
    X,
} from "lucide-react";
import { exportSegmentedImages } from "../lib/exportUtils";
import { toast } from "sonner";
import { storage } from "../lib/storage";
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from "./ui/resizable";
import { cropLineToBase64, colorizeWords, colorFromScore } from "../lib/htrUtils";
import JSZip from "jszip";

const HTR_API_URL = "/api/htr"; // Next.js API proxy to Qwen2.5-VL QLora backend

// ─── Types ───────────────────────────────────────────────────────────────────

interface HTRLineResult {
    beams: string[];
    beam_scores: number[]; // normalized 0–1
}
type HTRPageResults = Record<string, HTRLineResult>; // key = line.id → { beams, beam_scores }

// ─── Component ───────────────────────────────────────────────────────────────

export default function ManuscriptWorkbench() {
    const [manuscriptId, setManuscriptId] = useState<string | null>(null);
    const [images, setImages] = useState<string[]>([]);
    const [currentPage, setCurrentPage] = useState(0);
    const [segmentationsByPage, setSegmentationsByPage] = useState<Record<number, KrakenSegmentation>>({});
    const [transcriptionsByPage, setTranscriptionsByPage] = useState<Record<number, Record<string, string>>>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [addLineMode, setAddLineMode] = useState(false);
    const [selectedLine, setSelectedLine] = useState<KrakenLine | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [showPoints, setShowPoints] = useState(true);
    const [isDragging, setIsDragging] = useState(false);
    const [showTutorial, setShowTutorial] = useState(false);

    useEffect(() => {
        const hasSeen = localStorage.getItem("htr_manuscript_tutorial_seen");
        if (!hasSeen) {
            setShowTutorial(true);
        }
    }, []);

    const closeTutorial = () => {
        localStorage.setItem("htr_manuscript_tutorial_seen", "true");
        setShowTutorial(false);
    };

    // HTR results: [page][lineId] → transcription string
    const [htrResults, setHtrResults] = useState<Record<number, HTRPageResults>>({});
    const [isTranscribing, setIsTranscribing] = useState(false);

    const lineRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // ── History ──────────────────────────────────────────────────────────────
    const historyRef = useRef<Record<number, KrakenSegmentation>[]>([]);
    const historyIndexRef = useRef<number>(-1);
    const skipHistoryUpdate = useRef(false);

    const setSegmentationsWithHistory = (
        updater: React.SetStateAction<Record<number, KrakenSegmentation>>,
        saveHistory = true
    ) => {
        setSegmentationsByPage(prev => {
            const newState = typeof updater === 'function' ? updater(prev) : updater;
            if (saveHistory) {
                const newHist = historyRef.current.slice(0, historyIndexRef.current + 1);
                newHist.push(newState);
                if (newHist.length > 50) newHist.shift();
                historyRef.current = newHist;
                historyIndexRef.current = newHist.length - 1;
            }
            return newState;
        });
    };

    const handleUndo = () => {
        if (historyIndexRef.current > 0) {
            historyIndexRef.current -= 1;
            skipHistoryUpdate.current = true;
            setSegmentationsByPage(historyRef.current[historyIndexRef.current]);
            toast.info("Action annulée", { id: "undo-redo", duration: 1000 });
        }
    };

    const handleRedo = () => {
        if (historyIndexRef.current < historyRef.current.length - 1) {
            historyIndexRef.current += 1;
            skipHistoryUpdate.current = true;
            setSegmentationsByPage(historyRef.current[historyIndexRef.current]);
            toast.info("Action refaite", { id: "undo-redo", duration: 1000 });
        }
    };

    // ── Keyboard Shortcuts ───────────────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tagName = document.activeElement?.tagName.toLowerCase();
            if (tagName === "textarea" || tagName === "input") return;
            if (e.ctrlKey && e.code === 'KeyZ') {
                e.preventDefault();
                e.shiftKey ? handleRedo() : handleUndo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // ── Scroll selected line into view ───────────────────────────────────────
    useEffect(() => {
        if (selectedLine?.id && lineRefs.current[selectedLine.id]) {
            lineRefs.current[selectedLine.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [selectedLine]);

    // ── Load last session ────────────────────────────────────────────────────
    useEffect(() => {
        const initSession = async () => {
            const lastId = storage.getLastManuscriptId();
            if (!lastId) return;
            let state: any = null;
            try {
                const res = await fetch(`/api/projects/local?id=${lastId}`);
                if (res.ok) state = await res.json();
            } catch { /* fallback below */ }
            if (!state) state = await storage.loadManuscript(lastId);
            if (state) {
                setManuscriptId(state.id);
                setImages(state.pages || []);
                historyRef.current = [state.segmentations || {}];
                historyIndexRef.current = 0;
                setSegmentationsByPage(state.segmentations || {});
                setTranscriptionsByPage(state.transcriptions || {});
                if (state.currentPage !== undefined) setCurrentPage(state.currentPage);
                toast.info(`Session restaurée : ${state.id}`);
            }
        };
        initSession();
    }, []);

    // ── Auto-save ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!manuscriptId) return;
        const t = setTimeout(async () => {
            setIsSaving(true);
            try {
                await storage.saveManuscript({
                    id: manuscriptId,
                    lastUpdated: Date.now(),
                    pages: images,
                    segmentations: segmentationsByPage,
                    transcriptions: transcriptionsByPage,
                    currentPage,
                });
            } catch {
                toast.error("Échec de la sauvegarde automatique (Espace saturé ?)");
            } finally {
                setTimeout(() => setIsSaving(false), 500);
            }
        }, 500);
        return () => clearTimeout(t);
    }, [manuscriptId, images, segmentationsByPage, transcriptionsByPage, currentPage]);

    // ── File Upload ──────────────────────────────────────────────────────────
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await handleFiles([file]);
    };

    // ── Drag & Drop ──────────────────────────────────────────────────────────
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Only trigger leave if we're actually leaving the container
        if (e.currentTarget === e.target) {
            setIsDragging(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const items = e.dataTransfer.items;
        if (!items) return;

        const entries: any[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry?.();
                if (entry) {
                    entries.push(entry);
                } else {
                    const file = item.getAsFile();
                    if (file) entries.push(file);
                }
            }
        }

        if (entries.length > 0) {
            await handleFiles(entries);
        }
    };

    const handleFiles = async (items: (File | any)[]) => {
        setIsProcessing(true);
        try {
            let allImages: string[] = [];
            let firstItemName = "";

            for (const item of items) {
                if (!firstItemName) {
                    firstItemName = item.name.replace(/\.[^/.]+$/, "");
                }

                // FileSystemEntry check (isDirectory exists on entry)
                if (item.isDirectory !== undefined) {
                    const foundImages = await processEntry(item);
                    allImages = [...allImages, ...foundImages];
                } else if (item.isFile !== undefined) {
                    const file = await new Promise<File>((resolve, reject) => item.file(resolve, reject));
                    const imgs = await processSingleFile(file);
                    allImages = [...allImages, ...imgs];
                } else if (item instanceof File) {
                    const imgs = await processSingleFile(item);
                    allImages = [...allImages, ...imgs];
                }
            }

            if (allImages.length > 0) {
                setImages(prev => [...prev, ...allImages]);
                if (!manuscriptId && firstItemName) {
                    setManuscriptId(firstItemName);
                }
                toast.success(`${allImages.length} image(s) chargée(s)`);
            }
        } catch (error) {
            console.error(error);
            toast.error("Erreur lors du traitement des fichiers");
        } finally {
            setIsProcessing(false);
        }
    };

    const processSingleFile = async (file: File): Promise<string[]> => {
        if (file.type === "application/pdf") {
            return await pdfToImages(file);
        } else if (file.type.startsWith("image/")) {
            const b64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target?.result as string);
                reader.readAsDataURL(file);
            });
            return [b64];
        } else if (file.name.toLowerCase().endsWith(".zip")) {
            return await processZip(file);
        }
        return [];
    };

    const processEntry = async (entry: any): Promise<string[]> => {
        let results: string[] = [];
        if (entry.isFile) {
            const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
            results = await processSingleFile(file);
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const entries = await new Promise<any[]>((resolve, reject) => {
                reader.readEntries(resolve, reject);
            });
            for (const e of entries) {
                const childResults = await processEntry(e);
                results = [...results, ...childResults];
            }
        }
        return results;
    };

    const processZip = async (file: File): Promise<string[]> => {
        const zip = await JSZip.loadAsync(file);
        const imgUrls: string[] = [];
        const imageFiles = Object.keys(zip.files).filter(name =>
            /\.(jpe?g|png|webp|gif)$/i.test(name) && !zip.files[name].dir
        );

        toast.info(`Extraction de ${imageFiles.length} images du ZIP...`, { id: "zip-extract" });

        for (const name of imageFiles) {
            const blob = await zip.files[name].async("blob");
            const b64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target?.result as string);
                reader.readAsDataURL(blob);
            });
            imgUrls.push(b64);
        }
        toast.dismiss("zip-extract");
        return imgUrls;
    };

    // ── PAGE XML Import ──────────────────────────────────────────────────────
    const handleXMLUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || images.length === 0) return;

        setIsProcessing(true);
        try {
            const text = await file.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");

            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) throw new Error("Fichier XML invalide");

            const textLines = Array.from(xmlDoc.querySelectorAll("TextLine"));
            if (textLines.length === 0) {
                toast.warning("Aucune ligne (TextLine) trouvée dans le XML.");
                return;
            }

            const newLines: KrakenLine[] = [];
            const newTranscriptions: Record<string, string> = { ...(transcriptionsByPage[currentPage] || {}) };

            textLines.forEach((lineEl, idx) => {
                const id = lineEl.getAttribute("id") || `xml_line_${idx}`;

                const coordsNode = lineEl.querySelector("Coords");
                const pointsStr = coordsNode?.getAttribute("points");
                let boundary: Point[] | null = null;

                if (pointsStr) {
                    const pairs = pointsStr.trim().split(/\s+/);
                    boundary = pairs.map(pair => {
                        const [x, y] = pair.split(",").map(Number);
                        return [x, y] as Point;
                    }).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
                }

                const baselineNode = lineEl.querySelector("Baseline");
                const baselineStr = baselineNode?.getAttribute("points");
                let baseline: Point[] | null = null;

                if (baselineStr) {
                    const pairs = baselineStr.trim().split(/\s+/);
                    baseline = pairs.map(pair => {
                        const [x, y] = pair.split(",").map(Number);
                        return [x, y] as Point;
                    }).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
                }

                const textNode = lineEl.querySelector("TextEquiv Unicode");
                const textContent = textNode?.textContent;

                if (boundary && boundary.length > 2) {
                    newLines.push({
                        id,
                        boundary,
                        baseline,
                        text: textContent || ""
                    });
                    if (textContent && textContent.trim()) {
                        newTranscriptions[id] = textContent;
                    }
                }
            });

            if (newLines.length > 0) {
                const currentLines = segmentationsByPage[currentPage]?.lines || [];
                // Merge current lines and new lines directly for simplicity
                const mergedLines = [...currentLines, ...newLines];

                setSegmentationsWithHistory(prev => ({
                    ...prev,
                    [currentPage]: {
                        ...(prev[currentPage] || {}),
                        type: prev[currentPage]?.type || "baselines",
                        text_direction: prev[currentPage]?.text_direction || "horizontal-rl",
                        imagename: prev[currentPage]?.imagename || `page_${currentPage}.png`,
                        lines: mergedLines
                    }
                }));

                setTranscriptionsByPage(prev => ({
                    ...prev,
                    [currentPage]: newTranscriptions
                }));

                toast.success(`${newLines.length} lignes importées depuis le XML`);
            } else {
                toast.warning("Aucun polygone valide trouvé dans le XML");
            }
        } catch (e: any) {
            console.error(e);
            toast.error(`Erreur import XML: ${e.message}`);
        } finally {
            setIsProcessing(false);
            e.target.value = '';
        }
    };

    // ── Segmentation ─────────────────────────────────────────────────────────
    const runSegmentation = async () => {
        if (!images[currentPage]) return;
        setIsProcessing(true);
        try {
            const formData = new FormData();
            const blob = await (await fetch(images[currentPage])).blob();
            formData.append("file", blob, `page_${currentPage}.png`);
            const res = await fetch("/api/segment", { method: "POST", body: formData });
            if (!res.ok) throw new Error("Erreur segmentation API");
            const data = await res.json();
            setSegmentationsWithHistory(prev => ({ ...prev, [currentPage]: data }));
            toast.success("Segmentation générée");
        } catch {
            toast.error("Échec de la segmentation");
        } finally {
            setIsProcessing(false);
        }
    };

    const runSegmentationAll = async () => {
        if (images.length === 0) return;
        setIsProcessing(true);
        let errorOccurred = false;
        try {
            for (let i = 0; i < images.length; i++) {
                toast.loading(`Segmentation page ${i + 1}/${images.length}...`, { id: 'seg-all' });
                const formData = new FormData();
                const blob = await (await fetch(images[i])).blob();
                formData.append("file", blob, `page_${i}.png`);
                const res = await fetch("/api/segment", { method: "POST", body: formData });
                if (!res.ok) { errorOccurred = true; continue; }
                const data = await res.json();
                setSegmentationsWithHistory(prev => ({ ...prev, [i]: data }));
            }
            toast.dismiss('seg-all');
            errorOccurred ? toast.warning("Segmentation terminée avec quelques erreurs") : toast.success("Toutes les pages ont été segmentées !");
        } catch {
            toast.dismiss('seg-all');
            toast.error("Échec de la segmentation globale");
        } finally {
            setIsProcessing(false);
        }
    };

    // ── HTR – Core function ───────────────────────────────────────────────────
    const runHTR = async () => {
        const lines = segmentationsByPage[currentPage]?.lines || [];
        if (lines.length === 0) {
            toast.error("Aucune ligne à transcrire sur cette page");
            return;
        }
        const targetLines = selectedLine
            ? lines.filter(l => l.id === selectedLine.id)
            : lines;

        if (targetLines.length === 0) return;
        setIsTranscribing(true);
        toast.loading(`Transcription de ${targetLines.length} ligne(s)...`, { id: 'htr' });

        try {
            const imageSrc = images[currentPage];

            // Crop each line into base64
            const base64List: (string | null)[] = await Promise.all(
                targetLines.map(line =>
                    line.boundary
                        ? cropLineToBase64(imageSrc, line.boundary)
                        : Promise.resolve(null)
                )
            );

            const validPairs = targetLines
                .map((line, i) => ({ line, b64: base64List[i] }))
                .filter(p => p.b64 !== null) as { line: KrakenLine; b64: string }[];

            if (validPairs.length === 0) {
                toast.dismiss('htr');
                toast.error("Aucune ligne ne possède de contour valide");
                return;
            }

            // Call local HTR API → { results: [{ beams, beam_scores }] }
            const response = await fetch(HTR_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ images_base64: validPairs.map(p => p.b64) }),
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`HTR API error ${response.status}: ${err}`);
            }

            const data: { results: HTRLineResult[] } = await response.json();

            const newPageHTR: HTRPageResults = { ...(htrResults[currentPage] || {}) };
            const newPageTranscriptions = { ...(transcriptionsByPage[currentPage] || {}) };

            validPairs.forEach(({ line }, i) => {
                const res = data.results[i];
                if (!res) return;
                newPageHTR[line.id] = res;
                // Auto-fill top beam into textarea
                if (res.beams[0]) newPageTranscriptions[line.id] = res.beams[0];
            });

            setHtrResults(prev => ({ ...prev, [currentPage]: newPageHTR }));
            setTranscriptionsByPage(prev => ({
                ...prev,
                [currentPage]: newPageTranscriptions,
            }));

            toast.dismiss('htr');
            toast.success(`${validPairs.length} ligne(s) transcrite(s) ✓`);
        } catch (e: any) {
            toast.dismiss('htr');
            console.error(e);
            toast.error(`Erreur HTR: ${e?.message || "Vérifiez que le serveur est démarré"}`);
        } finally {
            setIsTranscribing(false);
        }
    };

    // ── Transcription helpers ─────────────────────────────────────────────────
    const handleTranscriptionChange = (lineId: string, text: string) => {
        setTranscriptionsByPage(prev => ({
            ...prev,
            [currentPage]: { ...(prev[currentPage] || {}), [lineId]: text },
        }));
    };

    // ── Dataset Export ────────────────────────────────────────────────
    const exportDataset = async () => {
        const allPages = Object.keys(segmentationsByPage).map(Number).sort((a, b) => a - b);
        if (allPages.length === 0) { toast.error('Aucune segmentation disponible'); return; }

        const zip = new JSZip();
        const imagesFolder = zip.folder('images')!;
        const csvRows: string[] = ['image,text'];
        let lineCount = 0, skipped = 0;

        toast.loading('Création du dataset...', { id: 'dataset' });

        for (const pageIdx of allPages) {
            const seg = segmentationsByPage[pageIdx];
            const imgSrc = images[pageIdx];
            if (!seg || !imgSrc) continue;

            for (const line of seg.lines) {
                const text = transcriptionsByPage[pageIdx]?.[line.id] || '';
                if (!text.trim() || !line.boundary) { skipped++; continue; }
                try {
                    const b64 = await cropLineToBase64(imgSrc, line.boundary);
                    if (!b64) { skipped++; continue; }
                    const imgName = `p${String(pageIdx).padStart(3, '0')}_l${line.id}.png`;
                    const binaryStr = atob(b64);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                    imagesFolder.file(imgName, bytes);
                    csvRows.push(`images/${imgName},"${text.replace(/"/g, '""')}"`);
                    lineCount++;
                } catch { skipped++; }
            }
        }

        if (lineCount === 0) { toast.dismiss('dataset'); toast.error('Aucune ligne transcrite trouvée'); return; }

        zip.file('labels.csv', csvRows.join('\n'));
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `htr_dataset_${lineCount}lignes.zip`; a.click();
        URL.revokeObjectURL(url);
        toast.dismiss('dataset');
        toast.success(`Dataset exporté : ${lineCount} images + labels.csv (${skipped} ignorées)`);
    };

    // ── Segmentation change ───────────────────────────────────────────────
    const handleSegmentationChange = (newSeg: KrakenSegmentation) => {
        if (skipHistoryUpdate.current) {
            skipHistoryUpdate.current = false;
            setSegmentationsByPage(prev => ({ ...prev, [currentPage]: newSeg }));
        } else {
            setSegmentationsWithHistory(prev => ({ ...prev, [currentPage]: newSeg }));
        }
    };

    // ── Export / Save ─────────────────────────────────────────────────────────
    const handleExport = async () => {
        if (Object.keys(segmentationsByPage).length === 0) { toast.error("Rien à exporter"); return; }
        setIsProcessing(true);
        try {
            const zipBlob = await exportSegmentedImages(images, segmentationsByPage, transcriptionsByPage);
            const url = URL.createObjectURL(zipBlob as Blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${manuscriptId || 'manuscript'}_segments.zip`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Export terminé");
        } catch {
            toast.error("Erreur lors de l'export");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSaveToDisk = async () => {
        if (Object.keys(segmentationsByPage).length === 0) { toast.error("Rien à sauvegarder"); return; }
        setIsProcessing(true);
        try {
            const res = await fetch("/api/save-local", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    manuscriptId: manuscriptId || "manuscrit_sans_nom",
                    data: {
                        id: manuscriptId,
                        lastUpdated: Date.now(),
                        pages: images,
                        segmentations: segmentationsByPage,
                        transcriptions: transcriptionsByPage,
                        currentPage,
                    },
                }),
            });
            if (!res.ok) throw new Error();
            toast.success("Sauvegardé sur le disque (saved_projects/)");
        } catch {
            toast.error("Échec de la sauvegarde sur disque");
        } finally {
            setIsProcessing(false);
        }
    };

    // ── Line reorder helpers ──────────────────────────────────────────────────
    const moveLineUp = (index: number) => {
        if (index === 0) return;
        const newLines = [...(segmentationsByPage[currentPage]?.lines || [])];
        [newLines[index - 1], newLines[index]] = [newLines[index], newLines[index - 1]];
        handleSegmentationChange({ ...segmentationsByPage[currentPage], lines: newLines });
    };

    const moveLineDown = (index: number) => {
        const lines = segmentationsByPage[currentPage]?.lines || [];
        if (index === lines.length - 1) return;
        const newLines = [...lines];
        [newLines[index + 1], newLines[index]] = [newLines[index], newLines[index + 1]];
        handleSegmentationChange({ ...segmentationsByPage[currentPage], lines: newLines });
    };

    const currentLines = segmentationsByPage[currentPage]?.lines || [];
    const isDisabled = isProcessing || isTranscribing;

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <Card
            className="w-full h-full flex flex-col border-none shadow-none bg-transparent relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {isDragging && (
                <div className="absolute inset-0 z-[100] bg-indigo-600/10 backdrop-blur-[2px] border-4 border-dashed border-indigo-500 rounded-xl flex flex-col items-center justify-center p-12 pointer-events-none animate-in fade-in duration-200">
                    <div className="p-8 rounded-full bg-white shadow-2xl scale-125 animate-bounce mb-8">
                        <Upload className="w-16 h-16 text-indigo-600" />
                    </div>
                    <div className="text-center bg-white/90 backdrop-blur px-8 py-6 rounded-2xl shadow-xl border border-indigo-100">
                        <h2 className="text-3xl font-serif font-bold text-indigo-900 mb-2">Déposez vos manuscrits</h2>
                        <p className="text-indigo-600 font-medium">Images, PDF, Dossiers ou Archives ZIP</p>
                    </div>
                </div>
            )}
            {/* ── Header ── */}
            <CardHeader className="flex flex-row items-center justify-between pb-4 border-b bg-white">
                <div className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-stone-500" />
                    <div className="flex flex-col">
                        <CardTitle className="text-lg font-bold flex items-center gap-2">
                            {manuscriptId || "Nouveau Manuscrit"}
                            <span className="text-[10px] font-normal uppercase tracking-wider text-stone-400 border border-stone-200 px-1.5 py-0.5 rounded-full bg-stone-50">
                                Atelier
                            </span>
                        </CardTitle>
                        {images.length > 0 && (
                            <div className="flex items-center gap-2 text-[10px] text-stone-400">
                                <span>{images.length} page{images.length > 1 ? 's' : ''}</span>
                                <span>•</span>
                                <span className="text-emerald-600 font-medium">
                                    {Object.values(transcriptionsByPage).reduce((acc, page) =>
                                        acc + Object.values(page).filter(t => t && t.trim().length > 0).length, 0
                                    )} lignes transcrites
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowTutorial(true)}
                        className="h-8 w-8 text-stone-400 hover:text-indigo-600 rounded-full"
                        title="Guide d'utilisation"
                    >
                        <HelpCircle className="w-5 h-5" />
                    </Button>

                    {isSaving && (
                        <div className="flex items-center gap-1 text-[10px] text-stone-400 uppercase tracking-wider animate-pulse">
                            <Save className="w-3 h-3" /> Sauvegarde...
                        </div>
                    )}

                    <div className="flex gap-2 flex-wrap justify-end">
                        {/* Upload */}
                        <div className="relative">
                            <input
                                type="file"
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                onChange={handleFileUpload}
                                accept="application/pdf,image/*"
                                disabled={isDisabled}
                            />
                            <Button variant="outline" size="sm" className="gap-2 bg-white">
                                <Upload className="w-4 h-4" />
                                {images.length > 0 ? "Changer" : "Charger PDF/Image"}
                            </Button>
                        </div>

                        {images.length > 0 && (
                            <div className="relative">
                                <input
                                    type="file"
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    onChange={handleXMLUpload}
                                    accept=".xml"
                                    disabled={isDisabled}
                                />
                                <Button variant="outline" size="sm" className="gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 border-none">
                                    <FileCode2 className="w-4 h-4" />
                                    Importer XML
                                </Button>
                            </div>
                        )}

                        {images.length > 0 && (
                            <>
                                {/* Segment page */}
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={runSegmentation}
                                    disabled={isDisabled}
                                    className="gap-2"
                                >
                                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                                    Segmenter Page
                                </Button>

                                {/* Segment all */}
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={runSegmentationAll}
                                    disabled={isDisabled || images.length === 0}
                                    className="gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 border-none"
                                >
                                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                                    Segmenter Tout
                                </Button>

                                {/* ── TRANSCRIRE button ── */}
                                <Button
                                    size="sm"
                                    onClick={runHTR}
                                    disabled={isDisabled || currentLines.length === 0}
                                    className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white border-none shadow-md shadow-indigo-200"
                                >
                                    {isTranscribing
                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                        : <ScanText className="w-4 h-4" />
                                    }
                                    {isTranscribing
                                        ? "Transcription..."
                                        : selectedLine
                                            ? "Transcrire Ligne"
                                            : "Transcrire Page"
                                    }
                                </Button>

                                {/* Export Dataset */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={exportDataset}
                                    className="h-8 gap-1.5 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                    title="Exporter les lignes croppées + transcriptions en ZIP (dataset HTR)"
                                    disabled={Object.keys(segmentationsByPage).length === 0}
                                >
                                    <Database className="w-3.5 h-3.5" />
                                    Dataset
                                </Button>
                                {/* Save to disk */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleSaveToDisk}
                                    disabled={isDisabled || Object.keys(segmentationsByPage).length === 0}
                                    className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                >
                                    <HardDriveDownload className="w-4 h-4" />
                                    Sauvegarder (Disque)
                                </Button>

                                {/* Export zip */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleExport}
                                    disabled={isDisabled || Object.keys(segmentationsByPage).length === 0}
                                    className="gap-2 border-stone-200 text-stone-600"
                                >
                                    <FileDown className="w-4 h-4" />
                                    Exporter (.zip)
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </CardHeader>

            {/* ── Content ── */}
            <CardContent className="flex-1 overflow-hidden p-0 bg-stone-100 h-full">
                {images.length > 0 ? (
                    <ResizablePanelGroup orientation="horizontal" className="h-full w-full">

                        {/* Viewer */}
                        <ResizablePanel defaultSize={65} minSize={30} className="relative flex flex-col bg-white">
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 bg-white/90 backdrop-blur shadow-sm border px-3 py-1 rounded-full border-stone-200">
                                <Button
                                    variant="ghost" size="icon"
                                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                    disabled={currentPage === 0}
                                    className="h-8 w-8 text-stone-600"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </Button>
                                <span className="text-xs font-bold text-stone-500 tabular-nums">P {currentPage + 1} / {images.length}</span>
                                <Button
                                    variant="ghost" size="icon"
                                    onClick={() => setCurrentPage(p => Math.min(images.length - 1, p + 1))}
                                    disabled={currentPage === images.length - 1}
                                    className="h-8 w-8 text-stone-600"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </Button>
                            </div>

                            <div className="absolute top-4 right-4 z-20 flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => setShowPoints(!showPoints)} className="gap-2 shadow-sm bg-white">
                                    {showPoints ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    {showPoints ? "Cacher Points" : "Voir Points"}
                                </Button>
                                <Button
                                    variant={addLineMode ? "destructive" : "outline"}
                                    size="sm"
                                    onClick={() => setAddLineMode(!addLineMode)}
                                    className="gap-2 shadow-sm bg-white"
                                >
                                    <PlusCircle className="w-4 h-4" />
                                    {addLineMode ? "Terminer (Entrée)" : "Ajouter Ligne"}
                                </Button>
                            </div>

                            <div className="flex-1 overflow-hidden">
                                <KrakenViewer
                                    imageSrc={images[currentPage]}
                                    segmentation={segmentationsByPage[currentPage] || { lines: [] }}
                                    ocrMapping={null}
                                    onLineSelect={setSelectedLine}
                                    isEditing={true}
                                    addLineMode={addLineMode}
                                    onSegmentationChange={handleSegmentationChange}
                                    selectedLineId={selectedLine?.id}
                                    showPoints={showPoints}
                                />
                            </div>

                            {addLineMode && (
                                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-stone-900/90 backdrop-blur text-white px-6 py-2 rounded-full text-xs shadow-xl animate-in fade-in slide-in-from-bottom-4">
                                    <span className="opacity-70">Cliquez pour ajouter des points.</span>
                                    <b className="mx-2 text-emerald-400">ENTRÉE</b>
                                    <span className="opacity-70">pour terminer,</span>
                                    <b className="mx-2 text-rose-400">ESC</b>
                                    <span className="opacity-70">pour annuler.</span>
                                </div>
                            )}
                        </ResizablePanel>

                        <ResizableHandle className="w-1 bg-stone-200 hover:bg-stone-400 transition-colors cursor-col-resize active:bg-indigo-500" />

                        {/* Transcription Panel */}
                        <ResizablePanel defaultSize={35} minSize={20} className="flex flex-col bg-[#FDFCF8] shadow-[-10px_0_20px_rgba(0,0,0,0.02)] h-full">
                            <div className="p-3 border-b bg-white flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Type className="w-4 h-4 text-stone-400" />
                                    <h4 className="text-xs font-bold uppercase tracking-widest text-stone-500">Transcription</h4>
                                </div>
                                <div className="flex items-center gap-3">
                                    {/* Confidence legend */}
                                    <div className="hidden sm:flex items-center gap-1.5 text-[9px] text-stone-400 font-mono">
                                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Élevé
                                        <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block ml-1" />Moyen
                                        <span className="w-2 h-2 rounded-full bg-orange-500 inline-block ml-1" />Faible
                                        <span className="w-2 h-2 rounded-full bg-red-500 inline-block ml-1" />Incertain
                                    </div>
                                    <span className="text-[10px] font-mono text-stone-400">{currentLines.length} LIGNES</span>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth touch-auto">
                                <div className="p-4 flex flex-col gap-2 min-h-0">
                                    {currentLines.length > 0 ? (
                                        currentLines.map((line, idx) => {
                                            const isSelected = selectedLine?.id === line.id;
                                            const htrResult = htrResults[currentPage]?.[line.id];
                                            const hasHTR = !!htrResult;
                                            const topBeamWords = hasHTR ? colorizeWords(htrResult.beams[0], htrResult.beam_scores[0]) : null;
                                            const altBeams = hasHTR ? htrResult.beams.slice(1) : [];
                                            const altScores = hasHTR ? htrResult.beam_scores.slice(1) : [];

                                            return (
                                                <div
                                                    key={line.id}
                                                    ref={el => { lineRefs.current[line.id] = el; }}
                                                    className={`group relative flex gap-2 p-2 rounded-lg transition-all duration-200 border ${isSelected
                                                        ? 'bg-indigo-50 border-indigo-200 shadow-sm'
                                                        : 'bg-white border-transparent hover:border-stone-200'
                                                        }`}
                                                    onClick={() => setSelectedLine(line)}
                                                >
                                                    {/* Index & reorder controls */}
                                                    <div className="flex-shrink-0 flex flex-col items-center justify-start mt-1 gap-1">
                                                        <input
                                                            type="number"
                                                            className={`text-[10px] font-bold w-6 h-6 flex items-center justify-center text-center rounded-sm outline-none appearance-none cursor-text ${isSelected
                                                                ? 'bg-indigo-600 text-white'
                                                                : 'bg-stone-100 text-stone-500 hover:bg-stone-200 focus:bg-white focus:ring-1 focus:ring-indigo-500'
                                                                }`}
                                                            value={idx + 1}
                                                            onChange={(e) => {
                                                                let newIdx = parseInt(e.target.value, 10) - 1;
                                                                if (isNaN(newIdx)) return;
                                                                const lines = segmentationsByPage[currentPage]?.lines || [];
                                                                newIdx = Math.max(0, Math.min(lines.length - 1, newIdx));
                                                                if (newIdx === idx) return;
                                                                const newLines = [...lines];
                                                                const [moved] = newLines.splice(idx, 1);
                                                                newLines.splice(newIdx, 0, moved);
                                                                handleSegmentationChange({ ...segmentationsByPage[currentPage], lines: newLines });
                                                            }}
                                                            title="Modifier la position"
                                                        />
                                                        <div className={`flex flex-col gap-0 opacity-0 group-hover:opacity-100 ${isSelected ? 'opacity-100' : ''} transition-opacity`}>
                                                            <button
                                                                className="text-stone-400 hover:text-indigo-600 p-0.5 disabled:opacity-20"
                                                                onClick={e => { e.stopPropagation(); moveLineUp(idx); }}
                                                                disabled={idx === 0}
                                                                title="Monter"
                                                            >
                                                                <ArrowUp className="w-3 h-3" />
                                                            </button>
                                                            <button
                                                                className="text-stone-400 hover:text-indigo-600 p-0.5 disabled:opacity-20"
                                                                onClick={e => { e.stopPropagation(); moveLineDown(idx); }}
                                                                disabled={idx === currentLines.length - 1}
                                                                title="Descendre"
                                                            >
                                                                <ArrowDown className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Main content */}
                                                    <div className="flex-1 flex flex-col gap-1.5 min-w-0">

                                                        {/* ── Colored top beam + alternatives ── */}
                                                        {topBeamWords && topBeamWords.length > 0 && (
                                                            <div
                                                                className="flex flex-wrap gap-x-1 gap-y-0.5 justify-end text-right font-scheherazade text-base leading-relaxed p-1.5 rounded-md bg-indigo-50/60 border border-indigo-100"
                                                                dir="rtl"
                                                                title={`Confiance top beam : ${Math.round((htrResult?.beam_scores[0] ?? 0) * 100)}%`}
                                                            >
                                                                {topBeamWords.map((w, wi) => (
                                                                    <span key={wi} style={{ color: w.color }} className="font-medium">{w.word}</span>
                                                                ))}
                                                                <CheckCircle2 className="w-3 h-3 ml-auto self-start mt-1 flex-shrink-0" style={{ color: htrResult ? colorFromScore(htrResult.beam_scores[0]) : '#999' }} />
                                                            </div>
                                                        )}
                                                        {altBeams.length > 0 && (
                                                            <div className="flex flex-col gap-0.5" dir="rtl">
                                                                {altBeams.map((beam, bi) => (
                                                                    <button
                                                                        key={bi}
                                                                        onClick={e => { e.stopPropagation(); handleTranscriptionChange(line.id, beam); }}
                                                                        title={`Variante ${bi + 2} — ${Math.round(altScores[bi] * 100)}%`}
                                                                        className="text-right text-xs text-stone-400 hover:text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded border border-transparent hover:border-indigo-100 transition-all w-full font-scheherazade leading-relaxed truncate"
                                                                    >
                                                                        <span className="text-[9px] text-stone-300 mr-1 font-mono">{Math.round(altScores[bi] * 100)}%</span>
                                                                        {beam}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* ── Editable textarea ── */}
                                                        <textarea
                                                            placeholder={hasHTR ? "Corriger la transcription..." : "Transcription manuelle..."}
                                                            className="w-full bg-transparent border-none resize-none focus:ring-0 p-1 text-stone-800 text-right font-scheherazade text-lg leading-snug outline-none min-h-[28px]"
                                                            value={transcriptionsByPage[currentPage]?.[line.id] || ""}
                                                            dir="rtl"
                                                            rows={1}
                                                            onChange={(e) => {
                                                                handleTranscriptionChange(line.id, e.target.value);
                                                                e.target.style.height = 'auto';
                                                                e.target.style.height = e.target.scrollHeight + 'px';
                                                            }}
                                                            onFocus={() => setSelectedLine(line)}
                                                            ref={el => {
                                                                if (el) {
                                                                    el.style.height = 'auto';
                                                                    el.style.height = el.scrollHeight + 'px';
                                                                }
                                                            }}
                                                        />
                                                    </div>

                                                    {/* Delete button */}
                                                    <div className="flex items-start justify-center pl-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 pt-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 text-stone-300 hover:text-rose-500 hover:bg-rose-50 rounded"
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                const newLines = segmentationsByPage[currentPage].lines.filter(l => l.id !== line.id);
                                                                handleSegmentationChange({ ...segmentationsByPage[currentPage], lines: newLines });
                                                                setSelectedLine(null);
                                                            }}
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-20 text-stone-300">
                                            <Scissors className="w-12 h-12 mb-4 opacity-10" />
                                            <p className="text-sm italic">Aucune ligne segmentée sur cette page</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </ResizablePanel>
                    </ResizablePanelGroup>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-stone-500 bg-white">
                        <div className="p-8 rounded-full bg-stone-50 mb-6 ring-1 ring-stone-100">
                            <Upload className="w-16 h-16 opacity-30 text-stone-400" />
                        </div>
                        <h3 className="text-xl font-serif italic mb-2">Aucun manuscrit chargé</h3>
                        <p className="max-w-md text-sm text-stone-400">
                            Uploadez un fichier PDF ou une image pour commencer le travail de segmentation et de transcription.
                        </p>
                    </div>
                )}
            </CardContent>

            {/* Tutorial Popup Modal */}
            {showTutorial && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-stone-900/60 backdrop-blur-md transition-opacity duration-300 animate-in fade-in">
                    <div className="relative max-w-lg w-full bg-white/95 rounded-2xl shadow-2xl border border-stone-200/50 p-8 m-4 transform transition-all duration-300 scale-100 animate-in zoom-in-95">
                        {/* Close Button */}
                        <button 
                            onClick={closeTutorial} 
                            className="absolute top-4 right-4 text-stone-400 hover:text-stone-700 transition-colors p-1.5 rounded-full hover:bg-stone-100"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        
                        {/* Header */}
                        <div className="text-center mb-6">
                            <span className="inline-block text-[10px] font-bold uppercase tracking-widest text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full mb-2">
                                Tutoriel Interactif
                            </span>
                            <h3 className="text-2xl font-serif font-bold text-stone-900">
                                Bienvenue dans l'Atelier Manuscrit
                            </h3>
                            <p className="text-sm text-stone-500 mt-1">
                                Suivez ces 3 étapes simples pour transcrire vos manuscrits arabes :
                            </p>
                        </div>

                        {/* Steps Container */}
                        <div className="flex flex-col gap-4 mb-6">
                            {/* Step 1 */}
                            <div className="flex gap-4 items-start p-4 rounded-xl bg-stone-50 border border-stone-100 hover:border-indigo-100 transition-all duration-200 group">
                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition-transform">
                                    1
                                </div>
                                <div>
                                    <h4 className="font-semibold text-stone-850 text-sm flex items-center gap-1.5">
                                        <Upload className="w-4 h-4 text-indigo-500" />
                                        Étape 1 : Upload votre image
                                    </h4>
                                    <p className="text-xs text-stone-500 mt-0.5">
                                        Glissez-déposez ou cliquez sur <b>"Charger PDF/Image"</b> pour ajouter votre document.
                                    </p>
                                </div>
                            </div>

                            {/* Step 2 */}
                            <div className="flex gap-4 items-start p-4 rounded-xl bg-stone-50 border border-stone-100 hover:border-indigo-100 transition-all duration-200 group">
                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition-transform">
                                    2
                                </div>
                                <div>
                                    <h4 className="font-semibold text-stone-850 text-sm flex items-center gap-1.5">
                                        <Scissors className="w-4 h-4 text-emerald-500" />
                                        Étape 2 : Cliquez sur "Segmenter page"
                                    </h4>
                                    <p className="text-xs text-stone-500 mt-0.5">
                                        Découpez automatiquement la page en lignes de texte prêtes pour l'analyse.
                                    </p>
                                </div>
                            </div>

                            {/* Step 3 */}
                            <div className="flex gap-4 items-start p-4 rounded-xl bg-stone-50 border border-stone-100 hover:border-indigo-100 transition-all duration-200 group">
                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center font-bold text-lg group-hover:scale-110 transition-transform">
                                    3
                                </div>
                                <div>
                                    <h4 className="font-semibold text-stone-850 text-sm flex items-center gap-1.5">
                                        <ScanText className="w-4 h-4 text-violet-500" />
                                        Étape 3 : Cliquer sur "Transcrire page" et attendre.
                                    </h4>
                                    <p className="text-xs text-stone-500 mt-0.5">
                                        Notre intelligence artificielle Qwen HTR transcrira chaque ligne en écriture arabe propre.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Action Button */}
                        <div className="flex justify-center">
                            <Button 
                                onClick={closeTutorial} 
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 py-2.5 rounded-xl font-medium transition-all cursor-pointer"
                            >
                                Commencer l'atelier
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}
