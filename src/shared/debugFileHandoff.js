const DB_NAME = 'gwr-debug-file-handoff';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const LATEST_KEY = 'latest';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

function getFileExtension(file) {
    const name = typeof file?.name === 'string' ? file.name.toLowerCase() : '';
    const dotIndex = name.lastIndexOf('.');
    return dotIndex >= 0 ? name.slice(dotIndex) : '';
}

export function getDebugFileKind(file) {
    if (!file) return null;

    const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
    const extension = getFileExtension(file);

    if (type.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) {
        return 'video';
    }
    if (IMAGE_TYPES.has(type) || IMAGE_EXTENSIONS.has(extension)) {
        return 'image';
    }
    return null;
}

export function pickDebugUploadFile(files) {
    const list = Array.from(files || []).filter(Boolean);
    return (
        list.find((file) => getDebugFileKind(file) === 'video')
        || list.find((file) => getDebugFileKind(file) === 'image')
        || null
    );
}

function openHandoffDb() {
    return new Promise((resolve, reject) => {
        const indexedDb = globalThis.indexedDB;
        if (!indexedDb) {
            reject(new Error('This browser does not support local file staging. Open the target preview page and select the file again.'));
            return;
        }

        const request = indexedDb.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onerror = () => reject(request.error || new Error('Could not open local file staging.'));
        request.onsuccess = () => resolve(request.result);
    });
}

export async function saveDebugFileHandoff(file, targetKind = getDebugFileKind(file)) {
    if (!file || !targetKind) {
        throw new Error('Unsupported file type.');
    }

    const record = {
        id: LATEST_KEY,
        kind: targetKind,
        file,
        name: file.name || '',
        type: file.type || '',
        size: Number.isFinite(file.size) ? file.size : 0,
        updatedAt: Date.now()
    };

    const db = await openHandoffDb();
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Local file staging failed.'));
        transaction.onabort = () => reject(transaction.error || new Error('Local file staging was canceled.'));
    }).finally(() => db.close());
    return record;
}

export async function consumeDebugFileHandoff(expectedKind = null) {
    const db = await openHandoffDb();
    let matchedRecord = null;

    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(LATEST_KEY);

        request.onsuccess = () => {
            const record = request.result || null;
            if (record && (!expectedKind || record.kind === expectedKind)) {
                matchedRecord = record;
                store.delete(LATEST_KEY);
            }
        };
        request.onerror = () => reject(request.error || new Error('Could not read staged local file.'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Could not read staged local file.'));
        transaction.onabort = () => reject(transaction.error || new Error('Reading the staged local file was canceled.'));
    }).finally(() => db.close());

    return matchedRecord;
}
