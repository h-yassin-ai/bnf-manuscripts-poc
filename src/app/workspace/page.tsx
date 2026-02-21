import { WorkspaceClient } from "@/components/workspace-client";

export default function WorkspacePage() {
    return (
        <div className="flex h-screen w-full flex-col overflow-hidden">
            <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:px-6">
                <div className="flex items-center gap-2 font-semibold">
                    <span>BNF Manuscripts Workspace</span>
                </div>
            </header>
            <main className="flex-1 overflow-hidden p-4">
                <WorkspaceClient />
            </main>
        </div>
    );
}
