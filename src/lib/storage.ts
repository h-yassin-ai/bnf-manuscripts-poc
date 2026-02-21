import { KrakenSegmentation } from "./krakenTypes";

export interface ManuscriptState {
    id: string; // e.g. file name or hash
    lastUpdated: number;
    pages: string[]; // Data URLs or references
    segmentations: Record<number, KrakenSegmentation>;
    transcriptions: Record<number, Record<string, string>>; // pageIndex -> lineId -> text
    currentPage?: number;
}

const DB_NAME = "ManuscriptDB";
const STORE_NAME = "manuscripts";
const DB_VERSION = 1;
const STORAGE_KEY_PREFIX = "manuscript_session_";

// Helper to open IndexedDB
const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const storage = {
    saveManuscript: async (state: ManuscriptState): Promise<void> => {
        if (typeof window === "undefined") return;
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);

            await new Promise<void>((resolve, reject) => {
                const request = store.put(state);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            localStorage.setItem(`${STORAGE_KEY_PREFIX}last_id`, state.id);
        } catch (error) {
            console.error("Failed to save manuscript state to IndexedDB", error);
            throw error;
        }
    },

    loadManuscript: async (id: string): Promise<ManuscriptState | null> => {
        if (typeof window === "undefined") return null;
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);

            return await new Promise<ManuscriptState | null>((resolve, reject) => {
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error("Failed to load manuscript state from IndexedDB", error);
            return null;
        }
    },

    deleteManuscript: async (id: string): Promise<void> => {
        if (typeof window === "undefined") return;
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);

            await new Promise<void>((resolve, reject) => {
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            if (localStorage.getItem(`${STORAGE_KEY_PREFIX}last_id`) === id) {
                localStorage.removeItem(`${STORAGE_KEY_PREFIX}last_id`);
            }
        } catch (error) {
            console.error("Failed to delete manuscript state from IndexedDB", error);
        }
    },

    getLastManuscriptId: (): string | null => {
        if (typeof window === "undefined") return null;
        return localStorage.getItem(`${STORAGE_KEY_PREFIX}last_id`);
    },

    listManuscripts: async (): Promise<string[]> => {
        if (typeof window === "undefined") return [];
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);

            return await new Promise<string[]>((resolve, reject) => {
                const request = store.getAllKeys();
                request.onsuccess = () => resolve(request.result as string[]);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error("Failed to list manuscripts from IndexedDB", error);
            return [];
        }
    },

    getAllManuscripts: async (): Promise<Array<{ id: string, lastUpdated: number, pageCount: number }>> => {
        if (typeof window === "undefined") return [];
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);

            return await new Promise((resolve, reject) => {
                const request = store.getAll();
                request.onsuccess = () => {
                    const results = request.result as ManuscriptState[];
                    const summary = results.map(r => ({
                        id: r.id,
                        lastUpdated: r.lastUpdated,
                        pageCount: r.pages ? r.pages.length : 0
                    }));
                    // Sort by lastUpdated descending
                    summary.sort((a, b) => b.lastUpdated - a.lastUpdated);
                    resolve(summary);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error("Failed to get all manuscripts from IndexedDB", error);
            return [];
        }
    }
};
