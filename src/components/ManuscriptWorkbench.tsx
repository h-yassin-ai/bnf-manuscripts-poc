"use client";

import React, { useState, useEffect, useRef } from "react";
import { pdfToImages } from "../lib/pdfUtils";
import { KrakenSegmentation, KrakenLine } from "../lib/krakenTypes";
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
    HardDriveDownload
} from "lucide-react";
import { exportSegmentedImages } from "../lib/exportUtils";
import { toast } from "sonner";
import { storage } from "../lib/storage";
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from "./ui/resizable";

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
    const lineRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // History for Undo/Redo
    const historyRef = useRef<Record<number, KrakenSegmentation>[]>([]);
    const historyIndexRef = useRef<number>(-1);
    const skipHistoryUpdate = useRef(false);

    // Custom setter to track history
    const setSegmentationsWithHistory = (
        updater: React.SetStateAction<Record<number, KrakenSegmentation>>,
        saveHistory = true
    ) => {
        setSegmentationsByPage(prev => {
            const newState = typeof updater === 'function' ? updater(prev) : updater;
            if (saveHistory) {
                const currentHist = historyRef.current;
                const idx = historyIndexRef.current;

                const newHist = currentHist.slice(0, idx + 1);
                newHist.push(newState);
                if (newHist.length > 50) newHist.shift(); // Keep last 50 edits

                historyRef.current = newHist;
                historyIndexRef.current = newHist.length - 1;
            }
            return newState;
        });
    };

    useEffect(() => {
        if (selectedLine?.id && lineRefs.current[selectedLine.id]) {
            lineRefs.current[selectedLine.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [selectedLine]);

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

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tagName = document.activeElement?.tagName.toLowerCase();
            if (tagName === "textarea" || tagName === "input") {
                return; // Let native text undo/redo work
            }

            if (e.ctrlKey && e.code === 'KeyZ') {
                e.preventDefault();
                if (e.shiftKey) {
                    handleRedo();
                } else {
                    handleUndo();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Load last session on mount
    useEffect(() => {
        const initSession = async () => {
            const lastId = storage.getLastManuscriptId();
            if (lastId) {
                let state: any = null;
                try {
                    // Try to load from server APIs first
                    const res = await fetch(`/api/projects/local?id=${lastId}`);
                    if (res.ok) {
                        state = await res.json();
                    }
                } catch (e) {
                    console.error("Failed to fetch from local API", e);
                }

                if (!state) {
                    // Fallback to IndexedDB
                    state = await storage.loadManuscript(lastId);
                }

                if (state) {
                    setManuscriptId(state.id);
                    setImages(state.pages || []); // Handle missing 'pages' from disk saves

                    historyRef.current = [state.segmentations || {}];
                    historyIndexRef.current = 0;

                    setSegmentationsByPage(state.segmentations || {});
                    setTranscriptionsByPage(state.transcriptions || {});
                    if (state.currentPage !== undefined) {
                        setCurrentPage(state.currentPage);
                    }
                    toast.info(`Session restaurée : ${state.id}`);
                }
            }
        };
        initSession();
    }, []);

    // Auto-save logic
    useEffect(() => {
        if (!manuscriptId) return;

        const saveTimeout = setTimeout(async () => {
            setIsSaving(true);
            try {
                await storage.saveManuscript({
                    id: manuscriptId,
                    lastUpdated: Date.now(),
                    pages: images,
                    segmentations: segmentationsByPage,
                    transcriptions: transcriptionsByPage,
                    currentPage: currentPage
                });
            } catch (error) {
                console.error("Auto-save failed:", error);
                toast.error("Échec de la sauvegarde automatique (Espace saturé ?)");
            } finally {
                setTimeout(() => setIsSaving(false), 500);
            }
        }, 500);

        return () => clearTimeout(saveTimeout);
    }, [manuscriptId, images, segmentationsByPage, transcriptionsByPage, currentPage]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsProcessing(true);
        try {
            let imgDataUrls: string[] = [];
            if (file.type === "application/pdf") {
                imgDataUrls = await pdfToImages(file);
            } else {
                imgDataUrls = await new Promise<string[]>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        resolve(event.target?.result ? [event.target.result as string] : []);
                    };
                    reader.readAsDataURL(file);
                });
            }

            setImages(imgDataUrls);
            setCurrentPage(0);

            const hasExistingData = Object.keys(segmentationsByPage).length > 0;
            if (!hasExistingData) {
                setManuscriptId(file.name);
                setSegmentationsByPage({});
                historyRef.current = [{}];
                historyIndexRef.current = 0;
                setTranscriptionsByPage({});
                toast.success("Fichier chargé avec succès");
            } else {
                toast.success("Fichier lié avec succès aux données du projet !");
            }
        } catch (error) {
            console.error(error);
            toast.error("Erreur lors du chargement du fichier");
        } finally {
            setIsProcessing(false);
        }
    };

    const runSegmentation = async () => {
        if (!images[currentPage]) return;

        setIsProcessing(true);
        try {
            const formData = new FormData();
            const blob = await (await fetch(images[currentPage])).blob();
            formData.append("file", blob, `page_${currentPage}.png`);

            const res = await fetch("/api/segment", {
                method: "POST",
                body: formData
            });

            if (!res.ok) throw new Error("Erreur segmentation API");

            const data = await res.json();
            setSegmentationsWithHistory(prev => ({
                ...prev,
                [currentPage]: data
            }));
            toast.success("Segmentation générée");
        } catch (error) {
            console.error(error);
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

                const res = await fetch("/api/segment", {
                    method: "POST",
                    body: formData
                });

                if (!res.ok) {
                    errorOccurred = true;
                    console.error(`Erreur segmentation page ${i}`);
                    continue;
                }

                const data = await res.json();
                setSegmentationsWithHistory(prev => ({
                    ...prev,
                    [i]: data
                }));
            }
            toast.dismiss('seg-all');
            if (errorOccurred) {
                toast.warning("Segmentation terminée avec quelques erreurs");
            } else {
                toast.success("Toutes les pages ont été segmentées !");
            }
        } catch (error) {
            toast.dismiss('seg-all');
            console.error(error);
            toast.error("Échec de la segmentation globale");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSegmentationChange = (newSeg: KrakenSegmentation) => {
        if (skipHistoryUpdate.current) {
            skipHistoryUpdate.current = false;
            setSegmentationsByPage(prev => ({ ...prev, [currentPage]: newSeg }));
        } else {
            setSegmentationsWithHistory(prev => ({
                ...prev,
                [currentPage]: newSeg
            }));
        }
    };

    const handleTranscriptionChange = (lineId: string, text: string) => {
        setTranscriptionsByPage(prev => ({
            ...prev,
            [currentPage]: {
                ...(prev[currentPage] || {}),
                [lineId]: text
            }
        }));
    };

    const handleExport = async () => {
        if (Object.keys(segmentationsByPage).length === 0) {
            toast.error("Rien à exporter");
            return;
        }

        setIsProcessing(true);
        try {
            const zipBlob = await exportSegmentedImages(images, segmentationsByPage, transcriptionsByPage);
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${manuscriptId || 'manuscript'}_segments.zip`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Export terminé");
        } catch (error) {
            console.error(error);
            toast.error("Erreur lors de l'export");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSaveToDisk = async () => {
        if (Object.keys(segmentationsByPage).length === 0) {
            toast.error("Rien à sauvegarder");
            return;
        }

        setIsProcessing(true);
        try {
            const dataToSave = {
                id: manuscriptId,
                lastUpdated: Date.now(),
                pages: images, // On intègre les images (base64) pour que le projet local soit 100% autonome
                segmentations: segmentationsByPage,
                transcriptions: transcriptionsByPage,
                currentPage: currentPage
            };

            const res = await fetch("/api/save-local", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    manuscriptId: manuscriptId || "manuscrit_sans_nom",
                    data: dataToSave
                }),
            });

            if (!res.ok) throw new Error("Erreur lors de la sauvegarde sur disque");

            toast.success("Sauvegardé sur le disque (saved_projects/)");
        } catch (error) {
            console.error(error);
            toast.error("Échec de la sauvegarde sur disque");
        } finally {
            setIsProcessing(false);
        }
    };

    const moveLineUp = (index: number) => {
        if (index === 0) return;
        const newLines = [...(segmentationsByPage[currentPage]?.lines || [])];
        const temp = newLines[index - 1];
        newLines[index - 1] = newLines[index];
        newLines[index] = temp;
        handleSegmentationChange({
            ...segmentationsByPage[currentPage],
            lines: newLines
        });
    };

    const moveLineDown = (index: number) => {
        const lines = segmentationsByPage[currentPage]?.lines || [];
        if (index === lines.length - 1) return;
        const newLines = [...lines];
        const temp = newLines[index + 1];
        newLines[index + 1] = newLines[index];
        newLines[index] = temp;
        handleSegmentationChange({
            ...segmentationsByPage[currentPage],
            lines: newLines
        });
    };

    const currentLines = segmentationsByPage[currentPage]?.lines || [];

    return (
        <Card className="w-full h-full flex flex-col border-none shadow-none bg-transparent">
            <CardHeader className="flex flex-row items-center justify-between pb-4 border-b bg-white">
                <div className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-stone-500" />
                    <div>
                        <CardTitle className="text-lg font-bold">Atelier Manuscrit</CardTitle>
                        {manuscriptId && <p className="text-xs text-stone-400 font-mono">{manuscriptId}</p>}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {isSaving && (
                        <div className="flex items-center gap-1 text-[10px] text-stone-400 uppercase tracking-wider animate-pulse">
                            <Save className="w-3 h-3" /> Sauvegarde...
                        </div>
                    )}

                    <div className="flex gap-2">
                        <div className="relative">
                            <input
                                type="file"
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                onChange={handleFileUpload}
                                accept="application/pdf,image/*"
                                disabled={isProcessing}
                            />
                            <Button variant="outline" size="sm" className="gap-2 bg-white">
                                <Upload className="w-4 h-4" />
                                {images.length > 0 ? "Changer" : "Charger PDF/Image"}
                            </Button>
                        </div>

                        {images.length > 0 && (
                            <>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={runSegmentation}
                                    disabled={isProcessing}
                                    className="gap-2"
                                >
                                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                                    Segmenter Page
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={runSegmentationAll}
                                    disabled={isProcessing || images.length === 0}
                                    className="gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 border-none"
                                >
                                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                                    Segmenter Tout
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleSaveToDisk}
                                    disabled={isProcessing || Object.keys(segmentationsByPage).length === 0}
                                    className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                >
                                    <HardDriveDownload className="w-4 h-4" />
                                    Sauvegarder (Disque)
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleExport}
                                    disabled={isProcessing || Object.keys(segmentationsByPage).length === 0}
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

            <CardContent className="flex-1 overflow-hidden p-0 bg-stone-100 h-full">
                {images.length > 0 ? (
                    <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
                        {/* Viewer Section */}
                        <ResizablePanel defaultSize={65} minSize={30} className="relative flex flex-col bg-white">
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 bg-white/90 backdrop-blur shadow-sm border px-3 py-1 rounded-full border-stone-200">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                    disabled={currentPage === 0}
                                    className="h-8 w-8 text-stone-600"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </Button>
                                <span className="text-xs font-bold text-stone-500 tabular-nums">P {currentPage + 1} / {images.length}</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setCurrentPage(p => Math.min(images.length - 1, p + 1))}
                                    disabled={currentPage === images.length - 1}
                                    className="h-8 w-8 text-stone-600"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </Button>
                            </div>

                            <div className="absolute top-4 right-4 z-20 flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowPoints(!showPoints)}
                                    className="gap-2 shadow-sm bg-white"
                                >
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
                                    <b className="mx-2 text-emerald-400">ENTRÉE</b> <span className="opacity-70">pour terminer,</span>
                                    <b className="mx-2 text-rose-400">ESC</b> <span className="opacity-70">pour annuler.</span>
                                </div>
                            )}
                        </ResizablePanel>

                        <ResizableHandle className="w-1 bg-stone-200 hover:bg-stone-400 transition-colors cursor-col-resize active:bg-emerald-500" />

                        {/* Transcription Panel */}
                        <ResizablePanel defaultSize={35} minSize={20} className="flex flex-col bg-[#FDFCF8] shadow-[-10px_0_20px_rgba(0,0,0,0.02)] h-full">
                            <div className="p-3 border-b bg-white flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Type className="w-4 h-4 text-stone-400" />
                                    <h4 className="text-xs font-bold uppercase tracking-widest text-stone-500">Transcription</h4>
                                </div>
                                <span className="text-[10px] font-mono text-stone-400">{currentLines.length} LIGNES</span>
                            </div>

                            <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth touch-auto">
                                <div className="p-4 flex flex-col gap-1.5 min-h-0">
                                    {currentLines.length > 0 ? (
                                        currentLines.map((line, idx) => {
                                            const isSelected = selectedLine?.id === line.id;
                                            return (
                                                <div
                                                    key={line.id}
                                                    ref={(el) => { lineRefs.current[line.id] = el; }}
                                                    className={`group relative flex gap-2 p-1.5 rounded-md transition-all duration-200 border ${isSelected ? 'bg-emerald-50 border-emerald-200 shadow-sm' : 'bg-white border-transparent hover:border-stone-200'
                                                        }`}
                                                    onClick={() => setSelectedLine(line)}
                                                >
                                                    <div className="flex-shrink-0 flex flex-col items-center justify-start mt-1 gap-1">
                                                        <input
                                                            type="number"
                                                            className={`text-[10px] font-bold w-6 h-6 flex items-center justify-center text-center rounded-sm outline-none appearance-none cursor-text ${isSelected ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500 hover:bg-stone-200 focus:bg-white focus:ring-1 focus:ring-emerald-500'}`}
                                                            value={idx + 1}
                                                            onChange={(e) => {
                                                                let newIdx = parseInt(e.target.value, 10) - 1;
                                                                if (isNaN(newIdx)) return;
                                                                const lines = segmentationsByPage[currentPage]?.lines || [];
                                                                newIdx = Math.max(0, Math.min(lines.length - 1, newIdx));
                                                                if (newIdx === idx) return;

                                                                const newLines = [...lines];
                                                                const [movedLine] = newLines.splice(idx, 1);
                                                                newLines.splice(newIdx, 0, movedLine);
                                                                handleSegmentationChange({
                                                                    ...segmentationsByPage[currentPage],
                                                                    lines: newLines
                                                                });
                                                            }}
                                                            title="Modifier la position"
                                                        />

                                                        {/* Reorder controls visible on hover/select */}
                                                        <div className={`flex flex-col gap-0 opacity-0 group-hover:opacity-100 ${isSelected ? 'opacity-100' : ''} transition-opacity`}>
                                                            <button
                                                                className="text-stone-400 hover:text-emerald-600 p-0.5 disabled:opacity-20 disabled:hover:text-stone-400"
                                                                onClick={(e) => { e.stopPropagation(); moveLineUp(idx); }}
                                                                disabled={idx === 0}
                                                                title="Monter"
                                                            >
                                                                <ArrowUp className="w-3 h-3" />
                                                            </button>
                                                            <button
                                                                className="text-stone-400 hover:text-emerald-600 p-0.5 disabled:opacity-20 disabled:hover:text-stone-400"
                                                                onClick={(e) => { e.stopPropagation(); moveLineDown(idx); }}
                                                                disabled={idx === currentLines.length - 1}
                                                                title="Descendre"
                                                            >
                                                                <ArrowDown className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="flex-1 flex flex-col justify-center">
                                                        <textarea
                                                            placeholder="Transcription..."
                                                            className={`w-full bg-transparent border-none resize-none focus:ring-0 p-1 text-stone-800 text-right font-scheherazade text-lg leading-snug outline-none min-h-[32px]`}
                                                            value={transcriptionsByPage[currentPage]?.[line.id] || ""}
                                                            dir="rtl"
                                                            rows={1}
                                                            onChange={(e) => {
                                                                handleTranscriptionChange(line.id, e.target.value);
                                                                e.target.style.height = 'auto';
                                                                e.target.style.height = e.target.scrollHeight + 'px';
                                                            }}
                                                            onFocus={() => setSelectedLine(line)}
                                                            ref={(el) => {
                                                                if (el) {
                                                                    el.style.height = 'auto';
                                                                    el.style.height = el.scrollHeight + 'px';
                                                                }
                                                            }}
                                                        />
                                                    </div>

                                                    {/* Delete Button */}
                                                    <div className="flex items-center justify-center pl-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 text-stone-300 hover:text-rose-500 hover:bg-rose-50 rounded"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const newLines = segmentationsByPage[currentPage].lines.filter(l => l.id !== line.id);
                                                                handleSegmentationChange({
                                                                    ...segmentationsByPage[currentPage],
                                                                    lines: newLines
                                                                });
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
        </Card>
    );
}
