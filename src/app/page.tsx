"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { storage } from "@/lib/storage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle, FileText, Calendar, Trash2, HardDriveDownload, Download, CheckCircle2, Package } from "lucide-react";
import { toast } from "sonner";
import { exportSegmentedImages, bulkExportProjects } from "@/lib/exportUtils";

interface Project {
  id: string;
  lastUpdated: number;
  pageCount: number;
  transcriptionCount: number;
  isLocal?: boolean;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const router = useRouter();

  useEffect(() => {
    const loadProjects = async () => {
      try {
        // Fetch from IndexedDB
        const localDbData = await storage.getAllManuscripts();

        // Fetch from Local API (Server-side files)
        let localDiskData: Project[] = [];
        try {
          const res = await fetch("/api/projects/local");
          if (res.ok) {
            localDiskData = await res.json();
          }
        } catch (e) {
          console.error("Failed to fetch local disk projects:", e);
        }

        // Merge, preferring local disk if duplicates exist by ID
        const merged = new Map<string, Project>();
        for (const p of localDbData) {
          merged.set(p.id, { ...p, isLocal: false });
        }
        for (const p of localDiskData) {
          merged.set(p.id, { ...p, isLocal: true });
        }

        const mergedArray = Array.from(merged.values());
        mergedArray.sort((a, b) => b.lastUpdated - a.lastUpdated);
        setProjects(mergedArray);
      } catch (error) {
        console.error("Failed to load projects", error);
      }
    };
    loadProjects();
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Voulez-vous vraiment supprimer ce projet ?")) {
      await storage.deleteManuscript(id);
      setProjects(projects.filter(p => p.id !== id));
    }
  };

  const handleCreateNew = () => {
    // Just clear the last_id to start fresh and redirect to manuscrit
    localStorage.removeItem("manuscript_session_last_id");
    router.push("/manuscrit");
  };

  const handleOpenProject = (id: string) => {
    localStorage.setItem("manuscript_session_last_id", id);
    router.push("/manuscrit");
  };

  const handleSaveToDisk = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      toast.loading(`Sauvegarde de ${id} en cours...`, { id: "save-disk" });
      const state = await storage.loadManuscript(id);
      if (!state) throw new Error("Projet introuvable dans IndexedDB");

      const res = await fetch("/api/save-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manuscriptId: id,
          data: state
        }),
      });

      if (!res.ok) throw new Error("Erreur de sauvegarde");

      toast.success(`Le projet ${id} a été sauvegardé sur le disque`);
      // Reload projects to update the list (isLocal status)
      window.location.reload();
    } catch (error) {
      console.error(error);
      toast.error("Échec de la sauvegarde sur disque");
    } finally {
      toast.dismiss("save-disk");
    }
  };

  const handleExport = async (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      toast.loading(`Préparation de l'export pour ${project.id}...`, { id: "export-zip" });

      let state = null;
      if (project.isLocal) {
        const res = await fetch(`/api/projects/local?id=${project.id}`);
        if (res.ok) state = await res.json();
      } else {
        state = await storage.loadManuscript(project.id);
      }

      if (!state) throw new Error("Données du projet introuvables");

      if (!state.pages || state.pages.length === 0) {
        toast.error("Impossible d'exporter : les images ne sont pas présentes dans le projet. Ouvrez l'atelier et liez le PDF d'abord.");
        return;
      }

      const zipBlob = await exportSegmentedImages(
        state.pages,
        state.segmentations || {},
        state.transcriptions || {}
      ) as Blob;

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.id}_export.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Export réussi !");
    } catch (error) {
      console.error(error);
      toast.error("Échec de l'export");
    } finally {
      toast.dismiss("export-zip");
    }
  };

  const handleBulkExport = async () => {
    if (projects.length === 0) {
      toast.error("Aucun projet à exporter");
      return;
    }

    try {
      toast.loading("Préparation de l'exportation globale (normalisation incluse)...", { id: "bulk-export" });

      const projectsData = [];

      for (const project of projects) {
        let state = null;
        if (project.isLocal) {
          const res = await fetch(`/api/projects/local?id=${project.id}`);
          if (res.ok) state = await res.json();
        } else {
          state = await storage.loadManuscript(project.id);
        }

        if (state && state.pages && state.pages.length > 0) {
          projectsData.push({
            id: project.id,
            images: state.pages,
            segmentations: state.segmentations || {},
            transcriptions: state.transcriptions || {}
          });
        }
      }

      if (projectsData.length === 0) {
        toast.error("Aucune donnée d'image trouvée dans les projets. Ouvrez-les d'abord pour lier les PDF.");
        return;
      }

      const zipBlob = await bulkExportProjects(projectsData);

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Export_Global_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Exportation de ${projectsData.length} projets terminée !`);
    } catch (error) {
      console.error(error);
      toast.error("Échec de l'exportation globale");
    } finally {
      toast.dismiss("bulk-export");
    }
  };

  const totalTranscribed = projects.reduce((acc, p) => acc + (p.transcriptionCount || 0), 0);

  return (
    <div className="flex flex-col h-screen bg-[#FDFCF8] text-stone-900 font-sans overflow-hidden">
      <PageHeader title="Gérer vos Projets" />

      <main className="flex-1 overflow-y-auto p-8 max-w-6xl mx-auto w-full">
        <div className="flex justify-between items-center mb-8">
          <div className="flex flex-col">
            <h2 className="text-3xl font-serif font-bold text-stone-800">Projets Récents</h2>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-stone-500">Gérez vos manuscrits et suivez vos transcriptions.</p>
              {projects.length > 0 && (
                <>
                  <span className="text-stone-300">|</span>
                  <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full border border-emerald-100 shadow-sm">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold uppercase tracking-wider">{totalTranscribed} lignes totales</span>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleBulkExport}
              className="border-blue-200 text-blue-700 hover:bg-blue-50 gap-2"
              title="Exporter tous les projets (Nettoyage arabe inclus)"
            >
              <Package className="w-4 h-4" />
              Exporter Tout
            </Button>
            <Button onClick={handleCreateNew} className="bg-emerald-700 hover:bg-emerald-800 text-white gap-2">
              <PlusCircle className="w-4 h-4" />
              Nouveau Projet
            </Button>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 bg-stone-50 rounded-xl border-2 border-dashed border-stone-200 text-center">
            <div className="p-4 bg-white rounded-full mb-4 shadow-sm border border-stone-100">
              <FileText className="w-8 h-8 text-stone-300" />
            </div>
            <h3 className="text-lg font-bold text-stone-700 mb-1">Aucun projet trouvé</h3>
            <p className="text-stone-500 max-w-sm">Commencez par créer un nouveau projet pour uploader et transcrire vos manuscrits.</p>
            <Button variant="outline" onClick={handleCreateNew} className="mt-6 border-stone-300 text-stone-600 gap-2">
              <PlusCircle className="w-4 h-4" />
              Créer mon premier projet
            </Button>
          </div>

        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map(project => (
              <Card
                key={project.id}
                className="cursor-pointer hover:shadow-md transition-shadow group border-stone-200"
                onClick={() => handleOpenProject(project.id)}
              >
                <CardHeader className="bg-stone-50/50 rounded-t-lg border-b border-stone-100/50 pb-4">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg font-bold text-stone-800 line-clamp-2 flex items-center gap-2" title={project.id}>
                      {project.id}
                      {project.isLocal && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          Disque
                        </span>
                      )}
                    </CardTitle>
                    <div className="flex gap-1 -mt-2 -mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        title="Exporter en ZIP (Images + Textes)"
                        onClick={(e) => handleExport(project, e)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      {!project.isLocal && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                          title="Sauvegarder sur le disque"
                          onClick={(e) => handleSaveToDisk(project.id, e)}
                        >
                          <HardDriveDownload className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-stone-400 hover:text-rose-500 hover:bg-rose-50"
                        onClick={(e) => handleDelete(project.id, e)}
                        title={project.isLocal ? "Non supporté (Supprimez le fichier manuellement)" : "Supprimer (IndexedDB)"}
                        disabled={project.isLocal} // Disabling delete for local files for safety/simplicity first
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription className="flex items-center gap-1.5 mt-2">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(project.lastUpdated).toLocaleDateString('fr-FR', {
                      day: 'numeric', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center gap-2 text-stone-600">
                    <FileText className="w-4 h-4 text-stone-400" />
                    <span className="font-medium">{project.pageCount}</span> page{project.pageCount > 1 ? 's' : ''} au total
                  </div>
                  <div className="flex items-center gap-2 text-stone-600">
                    <CheckCircle2 className={`w-4 h-4 ${project.transcriptionCount > 0 ? "text-emerald-500" : "text-stone-300"}`} />
                    <span className="font-medium">{project.transcriptionCount}</span> lignes transcrites
                  </div>
                </CardContent>
                <CardFooter className="pt-2 pb-4">
                  <Button variant="secondary" className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700">
                    Ouvrir l&apos;atelier
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
