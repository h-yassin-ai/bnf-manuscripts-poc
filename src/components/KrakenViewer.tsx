"use client";

import React, { useRef, useEffect, useState } from "react";
import { KrakenLine, KrakenSegmentation, OCRMapping, Point } from "../lib/krakenTypes";
import { pointInPolygon, distanceToPolyline } from "../lib/geometry";
import { getPolygonCrop } from "../lib/cropUtils";
import { TransformWrapper, TransformComponent, ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { ZoomIn, ZoomOut, Maximize, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "sonner";

interface KrakenViewerProps {
    imageSrc: string;
    segmentation: KrakenSegmentation | null;
    ocrMapping: OCRMapping | null;
    onLineSelect: (line: KrakenLine | null) => void;
    onCrop?: (dataUrl: string | null) => void;
    isEditing?: boolean;
    onSegmentationChange?: (seg: KrakenSegmentation) => void;
    selectedLineId?: string | null;
    addLineMode?: boolean;
    showPoints?: boolean;
}

const KrakenViewer: React.FC<KrakenViewerProps> = ({
    imageSrc,
    segmentation,
    ocrMapping,
    onLineSelect,
    onCrop,
    isEditing = false,
    onSegmentationChange,
    selectedLineId: externalSelectedLineId,
    addLineMode = false,
    showPoints = true
}) => {
    const transformRef = useRef<ReactZoomPanPinchContentRef>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);
    const [internalSelectedLineId, setInternalSelectedLineId] = useState<string | null>(null);

    // Use external ID if provided, otherwise internal
    const activeSelectedLineId = externalSelectedLineId !== undefined ? externalSelectedLineId : internalSelectedLineId;

    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

    // Editing State
    const [hoveredPoint, setHoveredPoint] = useState<{ lineId: string; pointIndex: number; isMidpoint?: boolean } | null>(null);
    const [draggingPoint, setDraggingPoint] = useState<{ lineId: string; pointIndex: number } | null>(null);
    const [newLinePoints, setNewLinePoints] = useState<Point[]>([]);

    // Helper to get image coordinates from mouse event
    const getImageCoords = (e: React.MouseEvent | MouseEvent) => {
        if (!canvasRef.current || !imageDimensions.width) return null;
        const rect = canvasRef.current.getBoundingClientRect();
        const scaleX = imageDimensions.width / rect.width;
        const scaleY = imageDimensions.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const generateCrop = (lineId: string | null) => {
        if (!lineId || !segmentation || !imageRef.current) {
            onCrop?.(null);
            return;
        }
        const line = segmentation.lines.find(l => l.id === lineId);
        if (!line || !line.boundary || line.boundary.length < 3) return;

        const cropData = getPolygonCrop(imageRef.current, line.boundary);
        onCrop?.(cropData);
    };

    // Handle image loading and initial fit
    useEffect(() => {
        const img = new Image();
        img.src = imageSrc;
        img.onload = () => {
            imageRef.current = img;
            setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });

            // Initial Fit Logic
            // We use a timeout to let the layout settle before calculating fit
            setTimeout(() => {
                if (transformRef.current) {
                    const { wrapperComponent } = transformRef.current.instance;
                    if (wrapperComponent) {
                        const wrapperWidth = wrapperComponent.clientWidth;
                        // Calculate scale to fit width with some padding
                        const scaleToFitWidth = (wrapperWidth / img.naturalWidth) * 0.9;
                        // Ensure we don't zoom in crazy close if the image is tiny, but generally fit-width is good for reading.
                        // Also respect min/max scale if possible, but centerView usually handles it or we clamp.
                        const targetScale = Math.min(Math.max(scaleToFitWidth, 0.05), 8); // clamp to min/max roughly

                        transformRef.current.centerView(targetScale, 0);
                    }
                }
            }, 100);
        };
    }, [imageSrc]);

    // Draw overlay
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !imageDimensions.width || !segmentation) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = imageDimensions.width;
        canvas.height = imageDimensions.height;

        segmentation.lines.forEach((line, lineIdx) => {
            const isHovered = line.id === hoveredLineId;
            const isSelected = line.id === activeSelectedLineId;
            const isLineHoveredForEdit = hoveredPoint?.lineId === line.id;

            // Boundary
            if (line.boundary && line.boundary.length > 0) {
                // Find centroid for label
                let cx = 0, cy = 0;
                line.boundary.forEach(([x, y]) => { cx += x; cy += y; });
                cx /= line.boundary.length;
                cy /= line.boundary.length;

                ctx.beginPath();
                line.boundary.forEach(([x, y], idx) => {
                    if (idx === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.closePath();

                ctx.fillStyle = isSelected
                    ? "rgba(16, 185, 129, 0.2)" // Emerald
                    : (isHovered || isLineHoveredForEdit)
                        ? "rgba(16, 185, 129, 0.1)"
                        : "rgba(16, 185, 129, 0.05)";
                ctx.fill();

                ctx.strokeStyle = isSelected ? "#059669" : (isHovered || isLineHoveredForEdit) ? "#10b981" : "rgba(16, 185, 129, 0.3)";
                ctx.lineWidth = (isSelected || isHovered) ? 3 : 1.5;
                ctx.stroke();

                // Draw Line Number Label
                if (isSelected || isHovered) {
                    ctx.font = "bold 24px Inter, sans-serif";
                    ctx.fillStyle = "#059669";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(`${lineIdx + 1}`, cx, cy);
                }

                // Draw vertices handles if editing and (hovered or selected) and showPoints is true
                if (isEditing && showPoints && (isSelected || isHovered || isLineHoveredForEdit)) {
                    // Regular Vertices
                    line.boundary.forEach(([x, y], idx) => {
                        ctx.beginPath();
                        ctx.arc(x, y, 6, 0, 2 * Math.PI);
                        const isPointHovered = hoveredPoint?.lineId === line.id && hoveredPoint?.pointIndex === idx && !hoveredPoint.isMidpoint;
                        ctx.fillStyle = isPointHovered ? "#ec4899" : "white"; // Pink
                        ctx.strokeStyle = "#059669";
                        ctx.lineWidth = 2;
                        ctx.fill();
                        ctx.stroke();
                    });

                    // Mid-point handles for adding vertices
                    for (let j = 0; j < line.boundary.length; j++) {
                        const p1 = line.boundary[j];
                        const p2 = line.boundary[(j + 1) % line.boundary.length];
                        const mx = (p1[0] + p2[0]) / 2;
                        const my = (p1[1] + p2[1]) / 2;

                        ctx.beginPath();
                        ctx.arc(mx, my, 4, 0, 2 * Math.PI);
                        const isMidHovered = hoveredPoint?.lineId === line.id && hoveredPoint?.pointIndex === j && hoveredPoint.isMidpoint;
                        ctx.fillStyle = isMidHovered ? "#10b981" : "rgba(255, 255, 255, 0.8)";
                        ctx.strokeStyle = "#059669";
                        ctx.setLineDash([2, 2]);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        if (isMidHovered) ctx.fill();
                    }
                }
            }
        });

        // Drawing New Line (Preview)
        if (addLineMode && newLinePoints.length > 0) {
            ctx.beginPath();
            newLinePoints.forEach(([x, y], idx) => {
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = "#ff00d4";
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw points
            newLinePoints.forEach(([x, y]) => {
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, 2 * Math.PI);
                ctx.fillStyle = "#ff00d4";
                ctx.fill();
            });
        }
    }, [segmentation, imageDimensions, hoveredLineId, activeSelectedLineId, isEditing, hoveredPoint, addLineMode, newLinePoints, showPoints]);

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const coords = getImageCoords(e);
        if (!coords || !segmentation) return;

        // 1. Dragging Logic
        if (isEditing && draggingPoint && onSegmentationChange) {
            const newLines = [...segmentation.lines];
            const lineIndex = newLines.findIndex(l => l.id === draggingPoint.lineId);
            if (lineIndex !== -1) {
                const line = { ...newLines[lineIndex] };
                if (line.boundary) {
                    const newBoundary = [...line.boundary];
                    newBoundary[draggingPoint.pointIndex] = [coords.x, coords.y];
                    line.boundary = newBoundary;
                    newLines[lineIndex] = line;

                    onSegmentationChange({ ...segmentation, lines: newLines });
                }
            }
            return;
        }

        // 2. Hover logic for Vertices (Edit Mode)
        if (isEditing) {
            let foundPoint: { lineId: string; pointIndex: number; isMidpoint?: boolean } | null = null;

            // Prioritize the currently selected line to avoid overlapping issues
            const linesToCheck = [];
            if (activeSelectedLineId) {
                const selectedLine = segmentation.lines.find(l => l.id === activeSelectedLineId);
                if (selectedLine) linesToCheck.push(selectedLine);
            }

            for (let i = segmentation.lines.length - 1; i >= 0; i--) {
                const line = segmentation.lines[i];
                if (line.id !== activeSelectedLineId) {
                    linesToCheck.push(line);
                }
            }

            for (const line of linesToCheck) {
                if (!line.boundary || line.boundary.length === 0) continue;

                // Check Regular Vertices first (priority)
                for (let j = 0; j < line.boundary.length; j++) {
                    const [px, py] = line.boundary[j];
                    const dist = Math.sqrt(Math.pow(px - coords.x, 2) + Math.pow(py - coords.y, 2));
                    if (dist < 15) { // Hit radius 
                        foundPoint = { lineId: line.id, pointIndex: j, isMidpoint: false };
                        break;
                    }
                }
                if (foundPoint) break;

                // Check Mid-points
                for (let j = 0; j < line.boundary.length; j++) {
                    const p1 = line.boundary[j];
                    const p2 = line.boundary[(j + 1) % line.boundary.length];
                    const mx = (p1[0] + p2[0]) / 2;
                    const my = (p1[1] + p2[1]) / 2;
                    const dist = Math.sqrt(Math.pow(mx - coords.x, 2) + Math.pow(my - coords.y, 2));
                    if (dist < 15) {
                        foundPoint = { lineId: line.id, pointIndex: j, isMidpoint: true };
                        break;
                    }
                }
                if (foundPoint) break;
            }

            setHoveredPoint(foundPoint);
            if (foundPoint) {
                setHoveredLineId(foundPoint.lineId);
                return;
            }
        }

        // 3. Normal Hover Logic (Lines)
        const point: Point = [coords.x, coords.y];
        let foundLineId: string | null = null;

        for (let i = segmentation.lines.length - 1; i >= 0; i--) {
            const line = segmentation.lines[i];
            if (line.boundary && pointInPolygon(point, line.boundary)) {
                foundLineId = line.id;
                break;
            }
        }
        setHoveredLineId(foundLineId);
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const coords = getImageCoords(e);
        if (!coords) return;

        if (addLineMode) {
            setNewLinePoints([...newLinePoints, [coords.x, coords.y]]);
            return;
        }

        if (isEditing && hoveredPoint && segmentation && onSegmentationChange) {
            // Shift + Click to Delete Point
            if (e.shiftKey && !hoveredPoint.isMidpoint) {
                deleteHoveredPoint();
                return;
            }

            // Click on Mid-point to Add Vertex
            if (hoveredPoint.isMidpoint) {
                const newLines = [...segmentation.lines];
                const lineIndex = newLines.findIndex(l => l.id === hoveredPoint.lineId);
                if (lineIndex !== -1) {
                    const line = { ...newLines[lineIndex] };
                    if (line.boundary) {
                        const newBoundary = [...line.boundary];
                        const p1 = line.boundary[hoveredPoint.pointIndex];
                        const p2 = line.boundary[(hoveredPoint.pointIndex + 1) % line.boundary.length];
                        const mx = (p1[0] + p2[0]) / 2;
                        const my = (p1[1] + p2[1]) / 2;

                        newBoundary.splice(hoveredPoint.pointIndex + 1, 0, [mx, my]);
                        line.boundary = newBoundary;
                        newLines[lineIndex] = line;
                        onSegmentationChange({ ...segmentation, lines: newLines });

                        // Immediately start dragging the new point
                        setDraggingPoint({ lineId: line.id, pointIndex: hoveredPoint.pointIndex + 1 });
                        setHoveredPoint({ lineId: line.id, pointIndex: hoveredPoint.pointIndex + 1, isMidpoint: false });
                    }
                }
                return;
            }

            // Regular Dragging
            setDraggingPoint(hoveredPoint);
            e.stopPropagation();
            return;
        }

        // Normal Selection
        setInternalSelectedLineId(hoveredLineId);
        const line = segmentation?.lines.find(l => l.id === hoveredLineId) || null;
        onLineSelect(line);
        generateCrop(hoveredLineId);
    };

    const deleteHoveredPoint = () => {
        if (!hoveredPoint || hoveredPoint.isMidpoint || !segmentation || !onSegmentationChange) return;
        const newLines = [...segmentation.lines];
        const lineIndex = newLines.findIndex(l => l.id === hoveredPoint.lineId);
        if (lineIndex !== -1) {
            const line = { ...newLines[lineIndex] };
            if (line.boundary && line.boundary.length > 3) {
                const newBoundary = [...line.boundary];
                newBoundary.splice(hoveredPoint.pointIndex, 1);
                line.boundary = newBoundary;
                newLines[lineIndex] = line;
                onSegmentationChange({ ...segmentation, lines: newLines });
                setHoveredPoint(null);
            } else if (line.boundary && line.boundary.length <= 3) {
                toast.error("Un polygone doit avoir au moins 3 points");
            }
        }
    };

    const finishNewLine = () => {
        if (newLinePoints.length < 3 || !segmentation || !onSegmentationChange) {
            setNewLinePoints([]);
            return;
        }

        const newLine: KrakenLine = {
            id: `line_${Date.now()}`,
            boundary: newLinePoints,
            baseline: [], // Optional for now
            text: ""
        };

        onSegmentationChange({
            ...segmentation,
            lines: [...segmentation.lines, newLine]
        });
        setNewLinePoints([]);
    };

    const deleteSelectedLine = () => {
        if (!activeSelectedLineId || !segmentation || !onSegmentationChange) return;

        onSegmentationChange({
            ...segmentation,
            lines: segmentation.lines.filter(l => l.id !== activeSelectedLineId)
        });
        onLineSelect(null);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tagName = document.activeElement?.tagName.toLowerCase();
            const isTyping = tagName === "textarea" || tagName === "input";

            if (e.key === "Enter" && addLineMode) {
                finishNewLine();
            }
            if ((e.key === "Delete" || e.key === "Backspace") && !isTyping) {
                if (hoveredPoint && !hoveredPoint.isMidpoint) {
                    deleteHoveredPoint();
                } else if (activeSelectedLineId && !addLineMode) {
                    deleteSelectedLine();
                }
            }
            if (e.key === "Escape") {
                setNewLinePoints([]);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [addLineMode, newLinePoints, activeSelectedLineId, segmentation, hoveredPoint]);

    const handleMouseUp = () => {
        setDraggingPoint(null);
    };

    return (
        <div className="relative w-full h-full bg-[#e5e5e5] overflow-hidden group">
            <TransformWrapper
                ref={transformRef}
                initialScale={0.1}
                minScale={0.05}
                maxScale={20}
                limitToBounds={false}
                centerOnInit={false}
                alignmentAnimation={{ sizeX: 0, sizeY: 0, velocityAlignmentTime: 0 }} // Disabled snap back
                wheel={{ step: 0.1, smoothStep: 0.002 }}
                panning={{
                    disabled: !!draggingPoint, // Verify specific Vertex dragging state
                    velocityDisabled: true
                }}
            >
                {({ zoomIn, zoomOut, resetTransform }) => (
                    <>
                        <div className="absolute top-4 right-4 z-50 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            <Button variant="secondary" size="icon" onClick={() => zoomIn()} className="shadow-md bg-white hover:bg-stone-50 text-stone-700 h-8 w-8 rounded-full">
                                <ZoomIn className="w-4 h-4" />
                            </Button>
                            <Button variant="secondary" size="icon" onClick={() => zoomOut()} className="shadow-md bg-white hover:bg-stone-50 text-stone-700 h-8 w-8 rounded-full">
                                <ZoomOut className="w-4 h-4" />
                            </Button>
                            <Button variant="secondary" size="icon" onClick={() => resetTransform()} className="shadow-md bg-white hover:bg-stone-50 text-stone-700 h-8 w-8 rounded-full">
                                <RefreshCw className="w-4 h-4" />
                            </Button>
                        </div>

                        <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
                            <div className="relative shadow-2xl" style={{ width: 'fit-content', height: 'fit-content' }}>
                                <img
                                    src={imageSrc}
                                    alt="Manuscrit"
                                    className="block max-w-none"
                                    style={{
                                        width: imageDimensions.width ? `${imageDimensions.width}px` : 'auto',
                                        height: 'auto'
                                    }}
                                />
                                <canvas
                                    ref={canvasRef}
                                    className="absolute top-0 left-0 outline-none"
                                    tabIndex={0}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        cursor: isEditing && hoveredPoint ? (hoveredPoint.isMidpoint ? 'copy' : 'move') : 'crosshair'
                                    }}
                                    onMouseMove={handleMouseMove}
                                    onMouseDown={handleMouseDown}
                                    onMouseUp={handleMouseUp}
                                    onDoubleClick={(e) => {
                                        if (isEditing && hoveredPoint && !hoveredPoint.isMidpoint) {
                                            deleteHoveredPoint();
                                        }
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        if (isEditing && hoveredPoint && !hoveredPoint.isMidpoint) {
                                            deleteHoveredPoint();
                                        }
                                    }}
                                    onMouseLeave={() => {
                                        setHoveredLineId(null);
                                        setDraggingPoint(null);
                                    }}
                                />
                            </div>
                        </TransformComponent>
                    </>
                )}
            </TransformWrapper>
        </div>
    );
};

export default KrakenViewer;
