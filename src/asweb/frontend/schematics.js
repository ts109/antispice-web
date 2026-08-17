const DEFAULT_STORAGE_KEY = "antispice-web.schematics.v1";

export function emptyCircuitSnapshot() {
    return {version: 1, elements: [], markers: [], nodes: [], wires: [], nets: []};
}

function timestampName(date) {
    const timestamp = date.toLocaleString("sv-SE", {hour12: false}).replace("T", " ");
    return `Schematic · ${timestamp}`;
}

function createRecord(snapshot, now = new Date()) {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return {id, name: timestampName(now), createdAt: now.toISOString(), updatedAt: now.toISOString(), circuit: snapshot};
}

export class SchematicStore {
    constructor(storage, key = DEFAULT_STORAGE_KEY) {
        this.storage = storage;
        this.key = key;
        this.document = this.#read();
    }

    #read() {
        try {
            const parsed = JSON.parse(this.storage.getItem(this.key));
            if (parsed?.version === 1 && Array.isArray(parsed.schematics)) {
                const activeId = parsed.schematics.some(record => record.id === parsed.activeId) ? parsed.activeId : parsed.schematics[0]?.id;
                if (activeId) return {...parsed, activeId};
            }
        } catch {
            // A corrupt or unavailable store falls back to a fresh document.
        }
        const record = createRecord(emptyCircuitSnapshot());
        return {version: 1, activeId: record.id, schematics: [record]};
    }

    active() {
        return this.document.schematics.find(record => record.id === this.document.activeId);
    }

    list() {
        return [...this.document.schematics].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    create(snapshot = emptyCircuitSnapshot()) {
        const record = createRecord(snapshot);
        this.document.schematics.push(record);
        this.document.activeId = record.id;
        return record;
    }

    select(id) {
        const record = this.document.schematics.find(candidate => candidate.id === id);
        if (!record) return null;
        this.document.activeId = record.id;
        record.updatedAt = new Date().toISOString();
        return record;
    }

    save(snapshot) {
        const record = this.active();
        if (!record) return null;
        record.circuit = snapshot;
        record.updatedAt = new Date().toISOString();
        return record;
    }

    rename(name) {
        const record = this.active();
        if (!record) return null;
        record.name = name;
        record.updatedAt = new Date().toISOString();
        return record;
    }

    persist() {
        this.storage.setItem(this.key, JSON.stringify(this.document));
    }
}
