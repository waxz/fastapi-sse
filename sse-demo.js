// ==UserScript==
// @name        SSE EventSource Fetch
// @namespace   Violentmonkey Scripts
// @match       https://example.org/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

let createNanoEvents = () => ({
    emit(event, ...args) {
        for (
            let callbacks = this.events[event] || [],
            i = 0,
            length = callbacks.length;
            i < length;
            i++
        ) {
            callbacks[i](...args)
        }
    },
    events: {},
    on(event, cb) {
        ; (this.events[event] ||= []).push(cb)
        return () => {
            this.events[event] = this.events[event]?.filter(i => cb !== i)
        }
    }
});


class Streamer {
    constructor() {
        this._buffer = "";
        this.metrics = { sseChunks: 0, sseBytes: 0 };
        this._streamGen = 0;
        this._activeRequest = null; // Store the GM_xmlhttpRequest object
        this._events = createNanoEvents();
    }

    async startStreaming(streamUrl) {
        const gen = ++this._streamGen;
        this._buffer = "";
        let lastLength = 0;

        return new Promise((resolve, reject) => {
            this._activeRequest = GM_xmlhttpRequest({
                method: "GET",
                url: streamUrl,
                headers: {
                    "Accept": "text/event-stream",
                    "Cache-Control": "no-cache"
                },
                // IMPORTANT: We do NOT use responseType: "blob"
                // We keep it as text to read it incrementally
                onreadystatechange: (res) => {

                    if (gen !== this._streamGen) return;

                    // readyState 3 = Partial Data Received
                    if (res.readyState >= 3 && res.responseText) {
                        const newChunk = res.responseText.slice(lastLength);
                        if (newChunk.length > 0) {
                            lastLength = res.responseText.length;
                            this.metrics.sseChunks++;
                            this.metrics.sseBytes += newChunk.length;
                            this._parseChunk(newChunk);
                        }
                    }
                },
                onload: (res) => {
                    if (gen === this._streamGen) {
                        this._emit('debug', 'Stream complete');
                        resolve();
                    }
                },
                onerror: (err) => {
                    this._emit('error', err);
                    reject(err);
                },
                onabort: () => {
                    this._emit('debug', 'Stream aborted');
                    resolve();
                }
            });
        });
    }

    abort() {
        if (this._activeRequest) {
            this._activeRequest.abort();
            this._activeRequest = null;
            this._streamGen++;
        }
    }

    _parseChunk(chunk) {
        this._buffer += chunk;
        const lines = this._buffer.split(/\r?\n/);
        this._buffer = lines.pop();

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            if (trimmedLine.startsWith("data: ")) {
                const data = trimmedLine.slice(6);
                if (data === "[DONE]") return;
                this._emit('data', data);
            } else if (trimmedLine.startsWith("event: ")) {
                const data = trimmedLine.slice(7);
                this._emit('event', data);
            }
        }
    }

    on(event, cb) { return this._events.on(event, cb); }
    _emit(event, ...args) {
        this._events.emit(event, ...args);
    }
}

(async function () {


    let counter = 0
    let events = createNanoEvents();

    events.on('increase', add => {
        counter += add;
        console.log("counter:", counter);
    });

    events.emit('increase', 1)
    events.emit("increase", 10);

    const url = "https://nxdev-org-fastapi-sse.hf.space/stream";

    let s = new Streamer();
    s.on("data", (data) => {

        console.log(`[streamer] data:`, data);
    })
    s.on("event", (data) => {

        console.log(`[streamer] event:`, data);
    });
    s.on("debug", (data) => {

        console.log(`[streamer] :`, data);
    });

    s.startStreaming(url);

})()


