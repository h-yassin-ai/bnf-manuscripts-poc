"use client";

import { useState, useCallback } from "react";
import { Upload, X, File as FileIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface UploadZoneProps {
    onFileSelect: (file: File) => void;
    isUploading?: boolean;
}

export function UploadZone({ onFileSelect, isUploading = false }: UploadZoneProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            validateAndSelect(file);
        }
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            validateAndSelect(e.target.files[0]);
        }
    };

    const validateAndSelect = (file: File) => {
        if (!file.type.startsWith("image/")) {
            toast.error("Please upload an image file");
            return;
        }
        // Limit size if needed, e.g. 5MB
        if (file.size > 5 * 1024 * 1024) {
            toast.error("File size too large (max 5MB)");
            return;
        }
        setSelectedFile(file);
        onFileSelect(file);
    };

    const clearFile = () => {
        setSelectedFile(null);
    };

    return (
        <Card className={cn(
            "border-2 border-dashed transition-colors",
            isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
        )}>
            <CardContent className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
                {selectedFile ? (
                    <div className="flex items-center gap-4 w-full max-w-sm p-4 border rounded-lg bg-background">
                        <div className="h-10 w-10 shrink-0 rounded-lg bg-muted flex items-center justify-center">
                            <FileIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                            <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={clearFile} disabled={isUploading}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="p-4 rounded-full bg-muted/50">
                            <Upload className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-semibold text-lg">Drop your manuscript here</h3>
                            <p className="text-sm text-muted-foreground">
                                or <label htmlFor="file-upload" className="text-primary hover:underline cursor-pointer">browse</label> to upload
                            </p>
                            <input
                                id="file-upload"
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={handleFileInput}
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Supports JPG, PNG (Max 5MB)
                        </p>
                    </>
                )}

                {isUploading && (
                    <div className="w-full max-w-sm space-y-2">
                        <Progress value={45} className="h-2" />
                        <p className="text-xs text-muted-foreground animate-pulse">Processing manuscript with AI...</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
