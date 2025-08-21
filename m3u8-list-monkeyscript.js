// ==UserScript==
// @name         M3U8 + some subtitles
// @namespace    http://tampermonkey.net/
// @version      0.8
// @description  Intercept and process M3U8, VTT, WEBVTT, and video URLs with pagination, filtering, processing, and UI display
// @author       ChatGPT-allFull-n-me
// @match        *://*/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/m3u8-parser@4.7.1/dist/m3u8-parser.min.js
// ==/UserScript==

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY 
// OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT // LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
// OR OTHER LIABILITY, WHETHER IN AN ACTION OF
// CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
// OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
// OTHER DEALINGS IN THE SOFTWARE.

(async function() {
    'use strict';
    let uiRoot
    let shown = false
    let ignoreCase = false
    let x = 40;
    let y = 20;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    let pauseToggle;
    let filterInput;
    const updateQueue = [];
    let isUpdating = false;
    let isMonitoring = false;
    let dropdownFilterTimeout;
    let clickedInsideDropdown = false;
    let filterIndicatorEnabled = false;
    let countTotal = 0
    let filteredUrls = new Set();
    let currentUrls;
    function normalizeUrl(url) {
        try {
            return new URL(url, location.href).href;
        } catch {
            return url;
        }
    }

    const URLManager = {
        urls: new Map(),
        processingSet: new Set(),
        autofilterOptions: { durations: [], types: [], urlHas: '', urlRawHas: '', stringExpand:true, expand: false, subtitles: false, multi:false, selected:false },

        add(url, content = '') {
            const normUrl = normalizeUrl(url);
            if (!normUrl || this.urls.has(normUrl)) return false;

            const data = {
                processed: false,
                duration: '--',
                type: 'N/A',
                url: normUrl,
                copy:normUrl,
                selected:false,
                content_original: content,
            };
            this.urls.set(normUrl, data);
            updateQueue.push(normUrl);
            this.processNextInQueue();
            showRoot()
            return true;
        },

        removePage(url) {
            const normUrl = normalizeUrl(url);
            if (!normUrl || !this.urls.has(normUrl)) return false;
            removeElementsByUrl(normUrl);
            this.remove(normUrl);
        },
        remove(url) {
            const normUrl = normalizeUrl(url);
            if (!normUrl || !this.urls.has(normUrl)) return false;

            if (this.processingSet.has(normUrl)) {
                console.warn(`Cannot remove URL ${normUrl} because it is currently processing.`);
                return false;
            }
            let filterDelete;
            if (this.urls.has(normUrl)) {
                filterDelete = this.urls.get(normUrl)
            }
            if (filterDelete && filteredUrls.has(filterDelete)) filteredUrls.delete(filterDelete);
            this.urls.delete(normUrl);
            const idx = updateQueue.indexOf(normUrl);
            if (idx !== -1) updateQueue.splice(idx, 1);
            triggerUIUpdate();
            return true;
        },

        async processNextInQueue() {
            if (isUpdating) return;
            isUpdating = true;

            try {
                while (updateQueue.length > 0) {
                    const url = updateQueue.shift();
                    if (!this.urls.has(url)) continue;

                    this.processingSet.add(url);
                    const data = this.urls.get(url);
                    if (data && !data.processed) {
                        try {
                            await processUrl(url, data, data.content_original);
                            // console.log(`✅ Processed: ${url} | Duration: ${data.duration} | Type: ${data.type}`);

                            if (
                                this.autofilterOptions.durations.length !== 0 ||
                                this.autofilterOptions.types.length !== 0 ||
                                this.autofilterOptions.urlHas !== '' ||
                                this.autofilterOptions.urlRawHas !== '' ||
                                this.autofilterOptions.expand !== false ||
                                this.autofilterOptions.stringExpand !== false ||
                                this.autofilterOptions.multi !== false ||
                                this.autofilterOptions.subtitles !== false ||
                                this.autofilterOptions.selected !== false
                            ) {
                                debounceFiltering();
                            } else { triggerUIUpdate(); }
                        } catch (e) {
                            console.error(`❌ Failed to process ${url}:`, e);
                        }
                    }
                    this.processingSet.delete(url);
                }
            } finally {
                isUpdating = false;
            }

        },

        getPaginated(page = 1, pageSize = 5) {
            const entries = Array.from(this.urls.values());
            const totalPages = Math.ceil(entries.length / pageSize);
            const start = (page - 1) * pageSize;
            return {
                page,
                pageSize,
                totalPages,
                data: entries.slice(start, start + pageSize),
            };
        },

        count() {
            return this.urls.size;
        },

        filter({
            durations,
            types,
            urlHas,
            urlRawHas,
            stringExpand,
            expand,
            subtitles,
            multi,
            selected
        } = this.autofilterOptions) {
            const uniqueResults = new Set();

            types = Array.isArray(types) ? types : [types || this.autofilterOptions.types];
            durations = durations || this.autofilterOptions.durations;
            urlHas = urlHas || this.autofilterOptions.urlHas;
            urlRawHas = urlRawHas || this.autofilterOptions.urlRawHas;
            expand = expand !== undefined ? expand : this.autofilterOptions.expand;
            stringExpand = stringExpand !== undefined ? stringExpand : this.autofilterOptions.stringExpand;
            subtitles = subtitles !== undefined ? subtitles : this.autofilterOptions.subtitles;
            multi = multi !== undefined ? multi : this.autofilterOptions.multi;
            selected = selected !== undefined ? selected : this.autofilterOptions.selected;

            if (subtitles && !types.includes('vtt')) {
                types.push('vtt');
            }
            if (subtitles && !types.includes('webvtt')) {
                types.push('webvtt');
            }
            if (multi && !durations.includes('multi')) {
                durations.push('multi');
            }

            const intermediate = new Set();

            if (stringExpand) {
                const hasTypeOrDuration = (types && types.length > 0) || (durations && durations.length > 0);

                for (const data of this.urls.values()) {
                    let match = false;
                    if (selected) {
                        if (data.selected) match = true;
                    }
                    else if (hasTypeOrDuration) {
                        const durationMatch = durations.some(d =>
                            typeof data.duration === 'string' &&
                            data.duration.toLowerCase().startsWith(d.toLowerCase())
                        );
                        const typeMatch = types.includes(data.type.toLowerCase());

                        if (subtitles) {
                            const u = new URL(data.url);
                            const lastSegment = u.pathname.split('/').filter(Boolean).pop() || '';
                            if (lastSegment === 'thumbs.vtt') continue;
                        }

                        match = durationMatch || typeMatch;
                    } else {
                        match = true;
                    }

                    if (match) {
                        intermediate.add(data);
                    }
                }

                for (const data of intermediate) {
                    const u = new URL(data.url);
                    const lastSegment = u.pathname.split('/').filter(Boolean).pop() || '';

                    const matchRaw = urlRawHas
                        ? (ignoreCase ? data.url.toLowerCase().includes(urlRawHas.toLowerCase()) : data.url.includes(urlRawHas))
                        : true;

                    const matchLast = urlHas
                        ? (ignoreCase ? lastSegment.toLowerCase().includes(urlHas.toLowerCase()) : lastSegment.includes(urlHas))
                        : true;

                    if (matchRaw && matchLast) {
                        uniqueResults.add(data);
                    }
                }

                return uniqueResults;
            }

            for (const data of this.urls.values()) {
                let matches = expand ? false : true;

                if (selected) {
                    matches = expand ? (matches || data.selected) : (matches && data.selected);
                }
                if (durations) {
                    const checkDurationMatch = (d) =>
                        typeof data.duration === 'string' &&
                        data.duration.toLowerCase().startsWith(d.toLowerCase());

                    const durationMatch = Array.isArray(durations)
                        ? durations.some(checkDurationMatch)
                        : checkDurationMatch(durations);

                    matches = expand ? (matches || durationMatch) : (matches && durationMatch);
                }

                if (types.length > 0) {
                    if (subtitles) {
                        const u = new URL(data.url);
                        const lastSegment = u.pathname.split("/").filter(Boolean).pop();
                        if (lastSegment === "thumbs.vtt") continue;
                    }

                    const typeMatch = types.includes(data.type.toLowerCase());
                    matches = expand ? (matches || typeMatch) : (matches && typeMatch);
                }

                if (urlRawHas) {
                    const rawMatch = ignoreCase ? data.url.toLowerCase().includes(urlRawHas.toLowerCase()) : data.url.includes(urlRawHas);
                    matches = expand ? (matches || rawMatch) : (matches && rawMatch);
                }

                if (urlHas) {
                    const u = new URL(data.url);
                    const lastSegment = u.pathname.split('/').filter(Boolean).pop() || '';
                    const segmentMatch = ignoreCase ? lastSegment.toLowerCase().includes(urlHas.toLowerCase()) : lastSegment.includes(urlHas);
                    matches = expand ? (matches || segmentMatch) : (matches && segmentMatch);
                }
                if (matches) {
                    uniqueResults.add(data);
                }
            }

            return uniqueResults;
        }
    }

    const mgmapi = {
        async getValue(name, defaultVal) {
            return await ((typeof GM_getValue === "function") ? GM_getValue : GM.getValue)(name, defaultVal);
        },
        async setValue(name, value) {
            return await ((typeof GM_setValue === "function") ? GM_setValue : GM.setValue)(name, value);
        },
        async deleteValue(name) {
            return await ((typeof GM_deleteValue === "function") ? GM_deleteValue : GM.deleteValue)(name);
        },
        saveText(text,defaultName) {
            let filename
            let input = prompt("Enter a filename:", defaultName);
            if (input) {
                filename = sanitizeFilename(input);
            }
            if (!filename) { this.message("File not saved", 4000, true); return;  }
            dowloadAsTxt(text,filename);
            function sanitizeFilename(input) {
                if (typeof input !== 'string') return '';
                const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
                let f = input.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
                f = f.replace(/[. ]+$/, '');
                if (reserved.test(f)) { f = '_' + f; }
                if (f.length > 255) { f = f.substring(0, 255); }
                if (f.length === 0) { f = 'untitled'; }
                return f.trim();
            }
            function dowloadAsTxt(text,filename) {
                const _blob = new Blob([text], { type: 'text/plain' });
                const _url = URL.createObjectURL(_blob);
                const _a = document.createElement('a');
                _a.href = _url;
                _a.download = filename;
                document.body.appendChild(_a);
                _a.click();
                document.body.removeChild(_a);
                URL.revokeObjectURL(_url);
            }
        },
        copyText(text) {
            copyTextToClipboard(text);
            function copyTextToClipboard(text) {
                var copyFrom = document.createElement("textarea");
                copyFrom.textContent = text;
                document.body.appendChild(copyFrom);
                copyFrom.select();
                document.execCommand('copy');
                copyFrom.blur();
                document.body.removeChild(copyFrom);
            }
        },

        message: (() => {
            let messageTimeout;
            const panelId = "m3u8List-message-panel";
            const messageId = "m3u8List-message-content";

            const injectStyles = () => {
                if (document.getElementById("m3u8List-message-style")) return;

                const style = document.createElement("style");
                style.id = "m3u8List-message-style";
                style.textContent = `
                    #${panelId} {
                        position: fixed;
                        top: 10px;
                        right: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: end;
                        z-index: 999999999999999;
                    }

                    #${messageId} {
                        padding: 5px 8px;
                        border-radius: 5px;
                        margin-top: 10px;
                        font-size: small;
                        color: #fff;
                        text-align: right;
                        opacity: 1;
                    }

                    #${messageId}.fade-in {
                        opacity: 0;
                        animation: fadeIn 0.3s ease forwards;
                    }

                    @keyframes fadeIn {
                        to { opacity: 1; }
                    }

                    #${messageId}.success {
                        background: green;
                    }

                    #${messageId}.error {
                        background: red;
                    }

                    #${messageId}.info {
                        background: #007bff;
                    }
                `;
                document.head.appendChild(style);
            };
            return function showMessage(text, disappearTime = 5000, type = "success") {
                injectStyles();
                let panel = document.getElementById(panelId);
                let isNewPanel = false;
                if (!panel) {
                    panel = document.createElement("div");
                    panel.id = panelId;
                    document.body.appendChild(panel);
                    isNewPanel = true;
                }
                let msg = document.getElementById(messageId);
                if (!msg) {
                    msg = document.createElement("div");
                    msg.id = messageId;
                    panel.appendChild(msg);
                }
                msg.className = "";
                msg.classList.add(type);
                if (isNewPanel) msg.classList.add("fade-in");
                msg.innerText = text;
                clearTimeout(messageTimeout);
                messageTimeout = setTimeout(() => {
                    panel.remove();
                    messageTimeout = null;
                }, disappearTime);
            };
        })(),

        checkQuery(url) {
            let q
            let regex
            q = filterInput.value.trim();
            if (!q) return;
            if (!q.startsWith("/")) {
                const _url = new URL(url);
                const urlSegments = _url.pathname.split("/").filter(Boolean);
                const lastSegment = urlSegments[urlSegments.length - 1];
                return lastSegment.includes(q)
            } else {
                const command_split = q.split(" ").filter(Boolean)
                const command = command_split[0]
                if (command.startsWith("/t")) {
                    regex = new RegExp('^/(t|ty|typ|type)$');
                    if ( regex.test(command) ) {
                        command_split.slice(1).join(" ").replace(" ","")
                    }
                } else if (command.startsWith("/m")) {
                    regex = new RegExp('^/(m|mu|mul|multi)$');
                    if ( regex.test(command) ) {
                        command_split.slice(1).join(" ").replace(" ","")

                    }
                } else if (command.startsWith("/v")) {
                    regex = new RegExp('^/(v|vi|vid|video)$');
                    if ( regex.test(command) ) {
                        command_split.slice(1).join(" ").replace(" ","")

                    }
                } else if (command.startsWith("/s")) {
                    regex = new RegExp('^/(s|su|sub|subs|subtitles)$');
                    if ( regex.test(command) ) {
                        command_split.slice(1).join(" ").replace(" ","")

                    }
                }
            }
        }
    }
    function debounce(fn, delay) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }
    window.__m3u8ListMiddleman = {
        manager: URLManager,
        pageSize: 5,
        currentPage: 1,

        resetAutofilterOptions() {
            URLManager.autofilterOptions = { durations: [], types: [], urlHas: '', urlRawHas: '', stringExpand:false, expand: false, subtitles:false, multi:false };
        },
        setAutofilterOptions(newOptions) {
            URLManager.autofilterOptions = { ...URLManager.autofilterOptions, ...newOptions };
        },

        get urls() {
            return currentUrls === URLManager.urls ? Array.from(URLManager.urls.values()) : filteredUrls;
        },

        get processing() {
            return Array.from(URLManager.processingSet);
        },

        get paginated() {
            return URLManager.getPaginated(this.currentPage, this.pageSize);
        },

        get totalPages() {
            return Math.ceil(this.urls.length / this.pageSize);
        },

        table() {
            console.table(this.urls);
        },
        logAll() {
            console.log(this.urls);
        },

        logProcessing() {
            console.table(this.processing);
        },

        logPage(page = this.currentPage) {
            const data = URLManager.getPaginated(page, this.pageSize);
            console.table(data.data);
        },

        setPageSize(size) {
            this.pageSize = size;
            console.log(`Page size set to ${size}`);
        },

        setPage(page) {
            this.currentPage = page;
        },

        clearAll() {
            if (isUpdating) return;
            URLManager.urls.clear();
            filteredUrls.clear();
            updateQueue.length = 0;
            URLManager.processingSet?.clear?.();
            console.log('Cleared all entries.');
            triggerUIUpdate();
        },
        clearSelected() {
            let sourceCollection = (filteredUrls && filteredUrls.size > 0) ? filteredUrls : new Set(URLManager.urls.values());
            const data = Array.from(sourceCollection.values ? sourceCollection.values() : sourceCollection);
            if (data.length === 0) return;
            data.forEach(item => {
                if (item.selected) {
                    const url = (typeof item === 'string') ? item : item.url;

                    filteredUrls.forEach(fItem => {
                        if ((typeof fItem === 'string' && fItem === url) || (fItem.url === url)) {
                            filteredUrls.delete(fItem);
                        }
                    });

                    if (URLManager.urls.has(url)) {
                        URLManager.urls.delete(url);
                    }

                    const idx = updateQueue.indexOf(url);
                    if (idx !== -1) updateQueue.splice(idx, 1);
                }

            });

            fixCurrentPage();
            triggerUIUpdate();
        },
        clearFiltered() {
            if (!filteredUrls || filteredUrls.size === 0) return;
            let hasProcessingUrl = true
            if (URLManager.processingSet.size > 0) {
                filteredUrls.forEach(item => {
                    const url = (typeof item === 'string') ? item : item.url;
                    if (URLManager.processingSet.has(url)) {
                        hasProcessingUrl = true;
                        return;
                    }
                });
                if (hasProcessingUrl) return;
            };
            filteredUrls.forEach(item => {
                const url = (typeof item === 'string') ? item : item.url;

                if (URLManager.urls.has(url)) {
                    URLManager.urls.delete(url);
                }
                const idx = updateQueue.indexOf(url);
                if (idx !== -1) updateQueue.splice(idx, 1);

            });
            filteredUrls.clear();
            if (currentUrls === filteredUrls) {
                filterInput.setAttribute("placeholder","Filter...");
                currentUrls = URLManager.urls;
                uncheckFilterCheckboxes();
                hideFilteredMenuOptions();
            }
            fixCurrentPage();
            triggerUIUpdate();
        },

        clearVisible() {
            let sourceCollection = (filteredUrls && filteredUrls.size > 0) ? filteredUrls : new Set(URLManager.urls.values());

            const data = Array.from(sourceCollection.values ? sourceCollection.values() : sourceCollection);

            if (data.length === 0) return;
            const pageSize = middleman.pageSize
            const totalPages = Math.ceil(data.length / pageSize);
            const start = (middleman.currentPage - 1) * pageSize;
            const end = start + pageSize;

            const pageData = data.slice(start, end);

            if (URLManager.processingSet.size > 0) {
                pageData.forEach(item => {
                    const url = (typeof item === 'string') ? item : item.url;
                    if (URLManager.processingSet.has(url)) {
                        hasProcessingUrl = true
                        return
                    }
                });
                if (hasProcessingUrl) return;
            }

            pageData.forEach(item => {
                const url = (typeof item === 'string') ? item : item.url;

                filteredUrls.forEach(fItem => {
                    if ((typeof fItem === 'string' && fItem === url) || (fItem.url === url)) {
                        filteredUrls.delete(fItem);
                    }
                });

                if (URLManager.urls.has(url)) {
                    URLManager.urls.delete(url);
                }

                const idx = updateQueue.indexOf(url);
                if (idx !== -1) updateQueue.splice(idx, 1);

            });
            fixCurrentPage();

            triggerUIUpdate();
        },

        filter(filters) {
            const results = URLManager.filter(filters);
            return results;
        },
        remove(url) {
            URLManager.remove(url)
        },
    };
    function fixCurrentPage() {
        let currentPage = middleman.currentPage
        let newTotalItems =  currentUrls === filteredUrls ? ((filteredUrls && filteredUrls.size > 0) ? filteredUrls.size : URLManager.urls.size) : URLManager.urls.size;
        if (!newTotalItems) newTotalItems = 1;
        const newTotalPages = Math.ceil(newTotalItems / middleman.pageSize) || 1;

        if (currentPage > newTotalPages) {
            currentPage = Math.max(1, newTotalPages);
            middleman.setPage(currentPage);
        }
    }
    function removeElementsByUrl(url) {
        const selectors = [
            `video[src="${url}"]`,
            `source[src="${url}"]`,
            `track[src="${url}"]`,
        ];
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                if (el.parentNode) {
                    el.parentNode.removeChild(el);
                    console.log(`Removed element with src: ${url}`);
                }
            });
        });
    }

    async function processUrl(url, urlData, content_original) {
        if (urlData.processed) return;

        const _url = new URL(url);
        const lastSegment = _url.pathname.split("/").filter(Boolean).pop();

        function getVTTDuration(vttText) {
            try {
                const cuePattern = /(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s-->\s(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})/g;
                let match;
                let maxEnd = 0;
                let minStart = Infinity;

                while ((match = cuePattern.exec(vttText)) !== null) {
                    const startHours = match[1] ? parseInt(match[1].replace(':', '')) : 0;
                    const startMinutes = parseInt(match[2]);
                    const startSeconds = parseInt(match[3]);
                    const startMilliseconds = parseInt(match[4]);

                    const endHours = match[5] ? parseInt(match[5].replace(':', '')) : 0;
                    const endMinutes = parseInt(match[6]);
                    const endSeconds = parseInt(match[7]);
                    const endMilliseconds = parseInt(match[8]);

                    const start =
                        startHours * 3600 +
                        startMinutes * 60 +
                        startSeconds +
                        startMilliseconds / 1000;

                    const end =
                        endHours * 3600 +
                        endMinutes * 60 +
                        endSeconds +
                        endMilliseconds / 1000;

                    if (start < minStart) minStart = start;
                    if (end > maxEnd) maxEnd = end;
                }

                if (maxEnd === 0 || minStart === Infinity) {
                    mgmapi.message('Invalid or empty VTT', 5000, "error");
                    return 'Invalid or empty VTT';
                }

                const totalDuration = maxEnd - minStart;
                const minutes = Math.floor(totalDuration / 60);
                const seconds = Math.floor(totalDuration % 60);

                return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
            } catch (error) {
                console.error('Error reading VTT file:', error);
                return 'Error';
            }
        }

        if (url.endsWith('.mp4') || url.endsWith(".webm") || url.endsWith(".mkv") ||
            lastSegment.endsWith(".mp4") || lastSegment.endsWith('.webm') || lastSegment.endsWith('.mkv')
        ) {
            await handleVideoDuration(url, urlData);
            urlData.type = "video";
        } else if (url.endsWith('.m3u8') || lastSegment.includes(".m3u8")) {
            urlData.type = "m3u8";
            try {
                if (!content_original) {
                    const content = await fetch(url).then(response => response.text());
                    await handleM3U8Manifest(url, content, urlData);
                } else {
                    await handleM3U8Manifest(url, content_original, urlData);
                }
            } catch (e) {
                urlData.duration = 'Error';
            }
        } else if (url.endsWith('.vtt')) {
            urlData.duration = content_original ? getVTTDuration(content_original) : '--';
            urlData.type = "vtt";
        }

        delete urlData.content_original;
        urlData.processed = true;
    }


    async function handleM3U8Manifest(url, content, urlData) {
        const parser = new m3u8Parser.Parser();
        parser.push(content);
        parser.end();
        const manifest = parser.manifest;

        let baseUrl;
        const hasWebVTT = manifest.segments.some(segment => segment.uri && segment.uri.endsWith('.webvtt'));

        if (manifest.playlists && manifest.playlists.length > 1) {
            urlData.duration = `Multi ${manifest.playlists.length}`;
        } else {
            const totalDuration = manifest.segments.reduce((acc, segment) => acc + segment.duration, 0);
            const minutes = Math.floor(totalDuration / 60);
            const seconds = Math.floor(totalDuration % 60);
            urlData.duration = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
        }

        if (hasWebVTT) {
            const firstSegment = manifest.segments.find(segment => segment.uri);
            if (firstSegment && !baseUrl) {
                const fullUrl = new URL(firstSegment.uri, url);
                baseUrl = fullUrl.href.substring(0, fullUrl.href.lastIndexOf('/') + 1);
            }

            const updatedContent = content
                .split('\n')
                .map(line => line.endsWith(".webvtt") ? baseUrl + line.trim() : line)
                .join('\n')
                .trim();

            urlData.copy = updatedContent;
            urlData.type = "webvtt";
        }
    }

    async function handleVideoDuration(url, urlData) {
        return new Promise((resolve, reject) => {
            const videoElement = document.createElement('video');
            videoElement.src = url;

            const cleanup = () => {
                videoElement.onloadedmetadata = null;
                videoElement.onerror = null;
                videoElement.src = '';
            };

            videoElement.onloadedmetadata = () => {
                const minutes = Math.floor(videoElement.duration / 60);
                const seconds = Math.floor(videoElement.duration % 60);
                urlData.duration = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
                cleanup();
                resolve();
            };

            videoElement.onerror = () => {
                urlData.duration = 'Error';
                cleanup();
                reject(new Error('Error loading video metadata'));
            };
        });
    }
    function checkMPD(content) {
        return content.trim().startsWith('<?xml') && content.includes('<MPD');
    }
    function checkM3U8(content) {
        return content.trim().startsWith('#EXTM3U') || content.includes("#EXT-X-MEDIA:TYPE=SUBTITLES");
    }

    function checkWebVTT(content) {
        return content.trim().startsWith('WEBVTT') || content.includes('X-TIMESTAMP-MAP');
    }

    function checkVideoFile(url) {
        return /\.(mp4|webm|avi|mov|mkv|flv|wmv|mpg)([?#]|$)/i.test(url);
    }

    function observeDOMChanges() {
        observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        node.querySelectorAll('video, source, track[type="text/vtt"]').forEach(el => {
                            if (el.src && checkVideoFile(el.src)) {
                                URLManager.add(el.src);
                            }
                            if (el.tagName.toLowerCase() === 'track' && el.src) {
                                URLManager.add(el.src);
                            }
                        });
                    }
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    function interceptXHR(...args) {
        const xhr = this;
        this.addEventListener('load', () => {
            const url = args[1];
            try {
                const isTextResponse = xhr.responseType === '' || xhr.responseType === 'text';
                // if (xhr.status >= 200 && xhr.status < 300 && isTextResponse) {
                if (isTextResponse) {
                    const content = xhr.responseText?.trim();
                    if (!content) return;

                    if (checkM3U8(content)) {
                        URLManager.add(url, content);
                    } else if (checkWebVTT(content)) {
                        URLManager.add(url, content);
                    } else if (checkVideoFile(url)) {
                        URLManager.add(url, content);
                    }
                }
            } catch (e) {
                console.warn('XHR interceptor error:', e);
            }
        });
        return _open.apply(this, args);
    }
    // function interceptXHR(...args) {
    //     this.addEventListener('load', () => {
    //         const url = args[1];
    //         if (this.responseType === '' || this.responseType === 'text') {
    //             const content = this.responseText;
    //             if (checkM3U8(content)) {
    //                 URLManager.add(url, content);
    //             } else if (checkWebVTT(content)) {
    //                 URLManager.add(url, content);
    //             } else if (checkVideoFile(url)) {
    //                 URLManager.add(url, content);
    //             }
    //         }
    //     });
    //     return _open.apply(this, args);
    // }

    function interceptFetch(...args) {
        return _fetch(...args).then(response => {
            const url = args[0];
            if (response.ok) {
                response.clone().text().then(content => {
                    if (checkM3U8(content)) {
                        URLManager.add(url, content);
                    } else if (checkWebVTT(content)) {
                        URLManager.add(url, content);
                    } else if (checkVideoFile(url)) {
                        URLManager.add(url, content);
                    }
                });
            }
            return response;
        });
    }

    let observer;
    function pauseMutationObserver() {
        if (observer) observer.disconnect();
    }
    function resumeMutationObserver() {
        if (!observer) observeDOMChanges();
    }

    const _open = XMLHttpRequest.prototype.open;
    const _fetch = window.fetch;

    function disableXHRandFetch() {
        XMLHttpRequest.prototype.open = _open;
        window.fetch = _fetch;
    }

    function enableXHRandFetch() {
        XMLHttpRequest.prototype.open = interceptXHR;
        window.fetch = interceptFetch;
    }

    function pauseMonitoring() {
        isMonitoring = false;
        updatedPauseToggle();
        pauseMutationObserver();
        disableXHRandFetch();
    }

    function startMonitoring() {
        isMonitoring = true;
        updatedPauseToggle();
        resumeMutationObserver();
        enableXHRandFetch();
    }

    function showRoot() {
        if (!shown && uiRoot && window.getComputedStyle(uiRoot).display === "none") {
            uiRoot.style.display = "block";
            shown = true
        }
    }
    startMonitoring();

    uiRoot = document.createElement('div');
    const shadow = uiRoot.attachShadow({ mode: 'open' });
    document.body.appendChild(uiRoot);
    Object.assign(uiRoot.style, {
        position: 'fixed',
        top: '10px',
        right: '10px',
        zIndex: 99999,
        display:'none',
        fontFamily: 'Arial, sans-serif',
        // width: '400px',
        background: '#5a000000',
        border: '1px solid rgba(158, 63, 246, 0.8)',
        borderRadius: '5px',
        boxShadow: '0 0 10px rgba(0,0,0,0.2)',

    });

    shadow.innerHTML = `
    <style>
        :host {
            --blueviolet-08: rgba(138, 43, 226, 0.8);
            --green-05: rgba(0, 200, 0, 0.5);
            --green-08: rgba(0, 140, 0, 0.8);
            --button-false-opacity:0.3;
            --main-font-size:16px;
        }
        * {
            font-size: var(--main-font-size);
        }
        .ui-container {
            padding: 8px;
            touch-action:none;
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
            user-select: none;
        }

        .ui-container[small="false"] {
            min-width: 400px;
            max-width: 400px;
            backdrop-filter: blur(5px);
            background-color: rgba(0,0,0,0.4);
        }

        .ui-container[small="true"] {
            width: auto;
            background-color: transparent;
            backdrop-filter: unset;
            min-width: unset;
            max-width: unset;
            display: inline-flex;
        }
        .ui-container[small="true"] > :not(.bar-menu):not(.menu-wrapper-right) {
            display: none !important;
        }
        .ui-container[small="true"] .menu-wrapper-left {
            display: none !important;
        }
        .table-wrapper {
            overflow: auto;
            border: 0px solid transparent;
            max-height:60dvh;
            background-color: transparent;
            touch-action: auto;
            overflow: auto;
            overscroll-behavior: contain;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background-color: transparent;
        }
        th {
            text-align: left;
            background-color: transparent;
            position: sticky;
            top: 0;
        }

        .bar-menu {
            display: flex;
            padding: 0px;
            margin:0;
            justify-content:space-between;
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
            user-select: none;
        }
        .menu-wrapper-right,
        .menu-wrapper-left {
            display:flex;
            margin: 0;
        }
        .menu-wrapper-right {
            cursor: pointer;
        }
        .menu-wrapper-right {
            padding: 0px 4px;
        }
        .menu-wrapper-left {
            position: relative;
        }
        .count-filter::after {
            content:attr(data-count);
        }
        .count-total::after {
            content:attr(data-count);
        }
        .button-pause[data-paused="false"]::after {
            content:"⏸️";
        }
        .button-pause[data-paused="true"]::after {
            content:"▶️";
        }
        .button-prev,
        .button-next,
        .button-pause,
        .settings-toggle,
        .copy-toggle,
        .save-toggle,
        .clear-toggle,
        .filter-toggle {
            padding: 0px 8px;
            cursor: pointer;
        }

        .copy-toggle[disabled="true"],
        .save-toggle[disabled="true"],
        .clear-toggle[disabled="true"],
        .filter-toggle[disabled="true"],
        .copy-toggle[disabled="true"] {
            opacity:0.6;
        }

        .copy-toggle,
        .save-toggle,
        .filter-toggle {
            margin-left:2px;
        }
        .clear-toggle {
            margin-left:5px;
            margin-right:5px;
        }
        .button-pause{
            margin-left:10px;
        }
        settings-toggle{
            color:cyan;
        }

        .clear-all,
        .clear-visible,
        .clear-selected,
        .clear-filtered,
        .save-all,
        .save-visible,
        .save-selected,
        .save-filtered,
        .copy-all,
        .copy-visible,
        .copy-selected,
        .copy-filtered {
            box-sizing:border-box;
            padding:10px;
        }
        .clear-all:hover,
        .clear-visible:hover,
        .clear-filtered:hover,
        .clear-selected:hover,
        .save-all:hover,
        .save-visible:hover,
        .save-selected:hover,
        .save-filtered:hover,
        .copy-all:hover,
        .copy-visible:hover,
        .copy-selected:hover,
        .copy-filtered:hover {
            background-color:var(--blueviolet-08);
        }
        .clear-all:active,
        .clear-visible:active,
        .clear-filtered:active,
        .clear-selected:active,
        .save-all:active,
        .save-visible:active,
        .save-selected:active,
        .save-filtered:active,
        .copy-all:active,
        .copy-visible:active,
        .copy-selected:active,
        .copy-filtered:active {
            background-color:var(--green-08);
        }
        .clear-all,
        .clear-visible,
        .clear-filtered,
        .clear-selected,
        .save-all,
        .save-visible,
        .save-filtered,
        .save-selected,
        .copy-all,
        .copy-visible,
        .copy-filtered,
        .copy-selected,
        .button-prev,
        .button-next  {
            background:transparent;
            border:none;
            outline:none;
        }
        .filter-wrapper {
            display:flex;
            flex-grow:1;
            margin:0px;
            margin-top:3px;
        }
        .filter-field::after {
            content:attr(data-placeholder);
        }
        .filter-field {
            display:flex;
            flex-grow:1;
            border: 0.5px solid transparent;
            outline: 0.5px solid var(--blueviolet-08);
            background-color:transparent;
            color:white;
        }
        .filter-field:focus {
            outline: none !important;
            border:0.5px solid var(--green-05);
        }
        .filter-toggle[data-count="0"]:after {
            content: "🔘";
        }
        .filter-toggle[data-count]:not([data-count="0"]):after {
            content:"☑️";
        }
        .settings-dropdown,
        .save-dropdown,
        .copy-dropdown,
        .clear-dropdown,
        .filter-dropdown {
            display: none;
            flex-direction: column;
            position: absolute;
            top:100%;
            backdrop-filter: blur(5px);
            background-color: rgba(0,0,0,0.4);
            border: .8px solid var(--blueviolet-08);
            border-radius: 10px;
            padding: 10px;
            z-index: 999999999999999;
            max-height: 300px;
            overflow-y: auto;
            width: max-content;
            touch-action:none;
            overscroll-behavior: contain;
        }

        .save-dropdown,
        .copy-dropdown,
        .clear-dropdown {
            padding:0;
        }

        .settings-dropdown > *:not(:first-child),
        .save-dropdown > *:not(:first-child),
        .copy-dropdown > *:not(:first-child),
        .filter-dropdown > *:not(:first-child) {
            margin-top: 3px;
        }
        .filter-dropdown {
            display:none;
        }
        .input-max-row {
            touch-action:none;
            overscroll-behavior: contain;
        }
        .pager {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .pager button {
            padding: 2px 6px;
            color:white;
            cursor: pointer;
        }
        .cell-duration,
        .cell-type,
        .cell-url {
            border: 1px solid var(--blueviolet-08);
            padding: 2px;
            text-align: left;
            white-space: nowrap;
            font-family: monospace;
            cursor:pointer;
        }

        .cell-select {
            padding-left: 10px;
            white-space: nowrap;
            cursor:pointer;
        }
        .custom-checkbox input[type="checkbox"] {
            display: none;
        }

        .custom-checkbox .checkmark {
            display: inline-block;
            width: 8px;
            height: 8px;
            background-color: transparent;
            border: 1px solid cyan;
            border-radius: 3px;
            vertical-align: middle;
            margin-right: 8px;
            position: relative;
            transition: background-color 0.2s;
        }

        .custom-checkbox input[type="checkbox"]:checked + .checkmark::after {
            content: '';
            position: absolute;
            left: 5px;
            top: 1px;
            width: 6px;
            height: 6px;
            border: solid transparent;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
            background: none;
        }

        .custom-checkbox:hover input[type="checkbox"] + .checkmark {
            background-color: blueviolet;
            border-color: blueviolet;
        }

        .custom-checkbox:hover input[type="checkbox"]:checked + .checkmark {
            background-color: #a7ffa4;
            border-color: #a7ffa4;
        }

        .custom-checkbox input[type="checkbox"]:checked + .checkmark {
            background-color: #4caf50;
            border-color: #4caf50;
        }

    </style>
    <div class="ui-container" small="false">
        <div class="bar-menu">
            <div class="menu-wrapper-left">
                <span class="settings-toggle" title="Settings">☰</span>
                <span class="clear-toggle" title="Clear…">🧹</span>
                <span class="save-toggle" title="Save…">💾</span>
                <span class="copy-toggle" title="Copy to clipboard…">📋</span>
                <span class="filter-toggle" title="No filter selected" data-count="0"></span>
                <span class="button-pause" title="Pause monitoring" data-paused=""></span>

                <div class="clear-dropdown">
                    <button class="clear-all">Clear: All</button>
                    <button class="clear-visible">Clear: Visible</button>
                    <button class="clear-filtered">Clear: Filtered</button>
                    <button class="clear-selected">Clear: Selected</button>
                </div>
                <div class="save-dropdown">
                    <button class="save-all">Save: All</button>
                    <button class="save-visible">Save: Visible</button>
                    <button class="save-filtered">Save: Filtered</button>
                    <button class="save-selected">Save: Selected</button>
                </div>
                <div class="copy-dropdown">
                    <button class="copy-all">Copy: All</button>
                    <button class="copy-visible">Copy: Visible</button>
                    <button class="copy-filtered">Copy: Filtered</button>
                    <button class="copy-selected">Copy: Selected</button>
                </div>
                <div class="settings-dropdown">
                    <label class="custom-checkbox">
                        <input type="checkbox" class="circularpage" value="circularpage" checked/>
                        <span class="checkmark"></span>
                        Page switcher carousel
                    </label>

                    <label class="custom-checkbox">
                        <input type="checkbox" class="ignorecase" value="ignorecase"/>
                        <span class="checkmark"></span>
                        Ignore upper-/lowercase in field
                    </label>

                    <label class="settingslabel">Rows per page</label>
                    <input class="input-max-row" type="number" min="1" step="1"/>
                </div>
                <div class="filter-dropdown">
                    <label class="custom-checkbox">
                        <input type="checkbox" class="checkbutton" value="m3u8"/>
                        <span class="checkmark"></span>
                        M3u8
                    </label>
                    <label class="custom-checkbox">
                        <input type="checkbox" class="checkbutton" value="multi"/>
                        <span class="checkmark"></span>
                        Multi
                    </label>
                    <label class="custom-checkbox selected-check">
                        <input type="checkbox" class="checkbutton" value="selected"/>
                        <span class="checkmark"></span>
                        Selected
                    </label>
                    <label class="custom-checkbox">
                        <input type="checkbox" class="checkbutton" value="subtitles"/>
                        <span class="checkmark"></span>
                        Subtitles
                    </label>
                    <label class="custom-checkbox">
                        <input type="checkbox" class="checkbutton" value="video"/>
                        <span class="checkmark"></span>
                        Video
                    </label>
                </div>

            </div>
            <div class="menu-wrapper-right">
                <span class="count-filter" data-count=""></span>
                <span class="count-total" data-count="0"></span>
            </div>
        </div>

        <div class="filter-wrapper">
            <input type="text" class="filter-field"></input>
        </div>

        <div class="pager">
            <button class="button-prev">◀</button>
            <span class="page-indicator">Page 1 / 1</span>
            <button class="button-next">▶</button>
        </div>

        <div class="table-wrapper">
            <table class="table-urls">
                <thead>
                    <tr><th></th><th>Type</th><th>Duration</th><th>URL</th></tr>
                </thead>
                <tbody class="table-body"></tbody>
            </table>
        </div>
    </div>
    `;

    uiRoot.style.top = `${y}px`;
    uiRoot.style.right = `${x}px`;

    const middleman = window.__m3u8ListMiddleman;

    const uiContainer = shadow.querySelector('.ui-container');

    const copyToggle = shadow.querySelector('.copy-toggle');
    const copyDropdown = shadow.querySelector('.copy-dropdown');
    const copyAll = shadow.querySelector('.copy-all');
    const copyVisible = shadow.querySelector('.copy-visible');
    const copyFiltered = shadow.querySelector('.copy-filtered');
    const copySelected = shadow.querySelector('.copy-selected');

    const saveToggle = shadow.querySelector('.save-toggle');
    const saveDropdown = shadow.querySelector('.save-dropdown');
    const saveAll = shadow.querySelector('.save-all');
    const saveVisible = shadow.querySelector('.save-visible');
    const saveFiltered = shadow.querySelector('.save-filtered');
    const saveSelected = shadow.querySelector('.save-selected');

    const clearToggle = shadow.querySelector('.clear-toggle');
    const clearDropdown = shadow.querySelector('.clear-dropdown');
    const clearAll = shadow.querySelector('.clear-all');
    const clearVisible = shadow.querySelector('.clear-visible');
    const clearFiltered = shadow.querySelector('.clear-filtered');
    const clearSelected = shadow.querySelector('.clear-selected');

    const settingsToggle = shadow.querySelector('.settings-toggle');
    const settingsDropdown = shadow.querySelector('.settings-dropdown');
    const circularPageToggle = shadow.querySelector('.circularpage');
    const ignoreCaseToggle = shadow.querySelector('.ignorecase');
    const inputMaxRow = shadow.querySelector('.input-max-row');

    const filterToggle = shadow.querySelector('.filter-toggle');
    const filterDropdown = shadow.querySelector('.filter-dropdown');
    const filterCheckboxes = filterDropdown.querySelectorAll('.checkbutton');
    const filterCheckSelected = filterDropdown.querySelector('.selected-check');
    pauseToggle = shadow.querySelector('.button-pause');

    const menuWrapperRight = shadow.querySelector('.menu-wrapper-right');
    const filterTotalIndicator = shadow.querySelector('.count-filter');
    const grandTotalIndicator = shadow.querySelector('.count-total');

    filterInput = shadow.querySelector('.filter-field');
    const prevBtn = shadow.querySelector('.button-prev');
    const pageIndicator = shadow.querySelector('.page-indicator');
    const nextBtn = shadow.querySelector('.button-next');

    const tableBody = shadow.querySelector('.table-body');

    const debounceFiltering = debounce(doFiltering,90)
    function doFiltering() {

        const selected = Array.from(filterCheckboxes)
            .filter(c => c.checked)
            .map(c => c.value);
        const pre = selected.length === 0 ? "No filter selected" : (selected.length === 1 ? `${selected.length} filter selected` : `${selected.length} filters selected`);
        const post = `\n${selected.join("\n").trim()}`;
        const title = `${pre}:${post}`;
        let filterString = ""
        if (filterInput) {
            filterString = filterInput.value.trim()
        }
        let filter = {
            types: [],
            multi:false,
            stringExpand: true,
            subtitles: false,
            selected: false,
            urlHas:filterString
        };
        selected.forEach(p => {
            switch (p) {
                case "selected":
                    filter.selected = true;
                    break;
                case "multi":
                    filter.multi = true;
                    break;
                case "subtitles":
                    filter.subtitles = true;
                    break;
                default:
                    filter.types.push(p.toLowerCase());
            }
        });

        filterToggle.setAttribute("data-count", `${selected.length}`);
        filterToggle.setAttribute("title", title);

        middleman.resetAutofilterOptions();
        if ((selected.length > 0) || filterString) {
            const flist = selected.join(" | ").trim()
            filterInput.setAttribute("placeholder",`Filter: ${flist}`)
            middleman.setAutofilterOptions(filter);
            filteredUrls.clear();
            filteredUrls = null;
            filteredUrls = middleman.filter();
            currentUrls = filteredUrls;
            showFilteredMenuOptions()

        } else {

            filterInput.setAttribute("placeholder","Filter...")
            filteredUrls.clear();
            currentUrls = URLManager.urls;
            hideFilteredMenuOptions()
        }

        if (middleman.currentPage > totalFilteredPages()) {
            middleman.setPage(totalFilteredPages());
        }

        triggerUIUpdate();
    }
    const debounceUpdateMenuBar = debounce(updateMenuBar,70)
    function updateMenuBar() {
        if (URLManager.urls.size > 0) {
            enableItemControls();
        } else {
            disableItemControls();
        }
        const hasSelected = URLManager.urls.size > 0 ? Array.from(URLManager.urls.values()).some(url => url.selected === true) : false;
        if (!hasSelected) {
            [filterCheckSelected,clearSelected,saveSelected,copySelected].forEach(f => {f.style.display = "none"})
        }
        else {
            [filterCheckSelected,clearSelected,saveSelected,copySelected].forEach(f => {f.style.display = ""})
        }
    };
    updatedPauseToggle();
    hideFilteredMenuOptions()
    function uncheckFilterCheckboxes() {
        filterCheckboxes.forEach(cb => {
            if (cb.checked) cb.checked = false;
        });
        filterToggle.setAttribute("title", "No filter selected");
    };
    function updatedPauseToggle() {
        if (!pauseToggle) return;
        pauseToggle.setAttribute("data-paused",!isMonitoring);
        if (isMonitoring === false) {
            pauseToggle.setAttribute("title","Start monitoring");
        } else {
            pauseToggle.setAttribute("title","Pause monitoring");
        }
    };
    function setTotal() {
        grandTotalIndicator.setAttribute("data-count",URLManager.urls.size)
        if (filteredUrls.size > 0) {
            filterTotalIndicator.setAttribute("data-count",filteredUrls.size + "/");
        } else {
            filterTotalIndicator.setAttribute("data-count","");
        }
    };
    function getLastSegment(url) {
        try {
            const u = new URL(url);
            const urlSegments = u.pathname.split("/").filter(Boolean);
            return urlSegments[urlSegments.length - 1]?.trim() || url;
        } catch {
            return url;
        }
    };
    function getOutText(list) {
        let copyOut = ""
        if (list.length > 0) {
            const MULTI = [];
            const M3U8 = [];
            const VTT = [];
            const VIDEO = [];
            const WEBVTT = [];
            const NA = [];
            list.forEach(urlData => {
                const type = urlData.type;
                const duration = urlData.duration;
                const copy = urlData.copy;
                if (type === "m3u8" && !duration.toLowerCase().startsWith("multi")) M3U8.push(copy);
                else if (type === "m3u8" && duration.toLowerCase().startsWith("multi")) MULTI.push(copy);
                else if (type === "vtt") VTT.push(copy);
                else if (type === "video") VIDEO.push(copy);
                else if (type === "webvtt") WEBVTT.push(copy);
                else if (type === "N/A") NA.push(copy);
            })
            const MULTISTRING = MULTI.length > 0 ? `${MULTI.join("\n").trim()}` : "";
            const M3U8STRING = M3U8.length > 0 ? `${M3U8.join("\n").trim()}` : "";
            const VTTSTRING = VTT.length > 0 ? `${VTT.join("\n").trim()}` : "";
            const WEBVTTSTRING = WEBVTT.length > 0 ? `${WEBVTT.join("\n\n").trim()}` : "";
            const NASTRING = NA.length > 0 ? `${NA.join("\n").trim()}` : "";
            copyOut = `${MULTISTRING ? `${MULTISTRING}\n\n` : ""}`;
            copyOut = `${copyOut}${M3U8STRING ? `${M3U8STRING}\n\n` : ""}`;
            copyOut = `${copyOut}${VTTSTRING ? `${VTTSTRING}\n\n` : ""}`;
            copyOut = `${copyOut}${WEBVTTSTRING ? `${WEBVTTSTRING}\n\n` : ""}`;
            copyOut = `${copyOut}${NASTRING ? `${NASTRING}\n\n` : ""}`;
            copyOut = copyOut.trim();
            return copyOut
        }
    }
    function getPageData() {
        const data = Array.from(currentUrls.values());
        let out = []
        if (data.length === 0) return out;
        const totalPages = Math.ceil(data.length / middleman.pageSize);
        const start = (middleman.currentPage - 1) * middleman.pageSize;
        const end = start + middleman.pageSize;
        const pageData = data.slice(start, end);
        if (pageData && pageData.length > 0) {
            out = pageData;
        }
        return out
    }
    function renderTable() {

        const data = Array.from(currentUrls.values());

        if (data.length === 0) {
            tableBody.innerHTML = '';
            return;
        }
        const totalPages = Math.ceil(data.length / middleman.pageSize);
        const start = (middleman.currentPage - 1) * middleman.pageSize;
        const end = start + middleman.pageSize;
        const pageData = data.slice(start, end);
        tableBody.innerHTML = '';

        pageData.forEach(row => {
            const tr = document.createElement('tr');
            const lastSegment = getLastSegment(row.url);
            const checked = row.selected ? "checked" : ""
            const url = row.url
            const type = row.type
            const copy = row.copy
            const duration = row.duration
            tr.innerHTML = `
            <td class="cell-select">
                <label class="custom-checkbox">
                    <input type="checkbox" class="checkbutton" value="selected" ${checked}/>
                    <span class="checkmark"></span>
                </label>
            </td>
            <td class="cell-type">
                <a  href="${url}"
                    title="${url}"
                    target="_blank"
                    rel="noopener noreferrer"
                    style="
                        display:inline-flex;
                        text-decoration:none;
                        white-space:nowrap;
                    "
                >${type}</a>
            </td>
            <td class="cell-duration">${duration}</td>
            <td class="cell-url" title="${type !== "webvtt" ? url : copy}">${lastSegment}</td>
            `;
            tr.querySelector(".checkbutton").addEventListener("change",(e) => {
                const cb = e.target
                const list_url = URLManager.urls.get(url)
                if (list_url) {
                    list_url.selected = cb.checked
                }
                debounceUpdateMenuBar()

            });
            tr.querySelector(".cell-url").addEventListener("click",(e) => {
                mgmapi.copyText(copy)
                mgmapi.message(`Copied ${type !== "webvtt" ? "link" : "content"} from:\n${lastSegment}`,2000)
            });
            // tr.querySelector(".button-rowdelete").addEventListener("click",(e) => {
            //     middleman.remove(url)
            // });
            // tr.querySelector(".button-rowdownload").addEventListener("click",(e) => {
            //     mgmapi.saveText(copy,"M3U8_link.txt")
            // });
            tableBody.appendChild(tr);
        });
        pageIndicator.textContent = `Page ${middleman.currentPage} / ${totalPages}`;
    }

    function disableItemControls() {
        [copyToggle,filterToggle,saveToggle,clearToggle].forEach(tg => {
            tg.setAttribute("disabled",true)
        });
    }
    function enableItemControls() {
        [copyToggle,filterToggle,saveToggle,clearToggle].forEach(tg => {
            tg.setAttribute("disabled",false)
        });
    }
    function totalFilteredPages() {
        return Math.ceil(currentUrls.size / middleman.pageSize);
    }
    const debounceUiUpdate = debounce(doUiUpdate,10)
    function doUiUpdate() {

        const currentPage = middleman.currentPage;
        const totalPages = totalFilteredPages();
        if (currentPage > totalPages) {
            middleman.setPage(totalPages);
        } else if (currentPage === 0) {
            middleman.setPage(1);
        }
        debounceUpdateMenuBar()
        renderTable();
        pageIndicator.textContent = `Page ${currentPage} / ${totalPages}`;
        setTotal();
    }
    function triggerUIUpdate() {
        debounceUiUpdate()
    }
    const startEvent = isTouchDevice ? "touchstart" : "mousedown";
    const moveEvent = isTouchDevice ? "touchmove" : "mousemove";
    const endEvent = isTouchDevice ? "touchend" : "mouseup";
    uiContainer.addEventListener(startEvent, e => {
        e.stopPropagation();
    });
    menuWrapperRight.addEventListener(startEvent, (e) => {
        e.stopPropagation();

        const point = isTouchDevice ? e.touches[0] : e;
        let startX = point.pageX;
        let startY = point.pageY;
        let moved = false;

        const handleMove = e => {
            const point = isTouchDevice ? e.touches[0] : e;
            let offsetX = point.pageX - startX;
            let offsetY = point.pageY - startY;

            if (moved || (Math.abs(offsetX) + Math.abs(offsetY)) > 5) {
                moved = true;
                uiRoot.style.top = `${y + offsetY}px`;
                uiRoot.style.right = `${x - offsetX}px`;
            }
            e.stopPropagation();
        };

        const handleEnd = e => {
            const point = isTouchDevice
                ? (e.changedTouches ? e.changedTouches[0] : e.touches[0])
                : e;
            let offsetX = point.pageX - startX;
            let offsetY = point.pageY - startY;

            if (moved) {
                x -= offsetX;
                y += offsetY;
            } else {
                let newsmall = uiContainer.getAttribute("small") === "true"
                newsmall = !newsmall
                uiContainer.setAttribute("small",newsmall)
            }

            document.removeEventListener(moveEvent, handleMove);
            document.removeEventListener(endEvent, handleEnd);
            e.stopPropagation();
        };

        document.addEventListener(moveEvent, handleMove);
        document.addEventListener(endEvent, handleEnd);
    });


    function hideFilteredMenuOptions() {
        [copyFiltered, saveFiltered, clearFiltered].forEach(b => {b.style.display = "none"});
    }
    function showFilteredMenuOptions() {
        [copyFiltered, saveFiltered, clearFiltered].forEach(b => {b.style.display = ""});
    }

    copyToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (copyToggle.getAttribute("disabled") === "true") return;
        showHideDropdown(copyDropdown);
    });
    copyDropdown.addEventListener("pointerdown", () => {
        clickedInsideDropdown = true;
    });
    copyAll.addEventListener("click", (e) => {
        const all = middleman.urls
        const copy = getOutText(all)
        if (copy) mgmapi.copyText(copy);
    });
    copyVisible.addEventListener("click", (e) => {
        const pageData = getPageData()
        const copy = getOutText(pageData)
        if (copy) mgmapi.copyText(copy);
    });
    copyFiltered.addEventListener("click", (e) => {
        const filtered = [...filteredUrls]
        const copy = getOutText(filtered)
        if (copy) mgmapi.copyText(copy);
    });
    copySelected.addEventListener("click", (e) => {
        const selectedItems = Array.from(URLManager.urls.values()).filter(item => item.selected === true);
        const copy = getOutText(selectedItems)
        if (copy) mgmapi.copyText(copy);
    });
    saveToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (saveToggle.getAttribute("disabled") === "true") return;
        showHideDropdown(saveDropdown);
    });
    saveDropdown.addEventListener("pointerdown", () => {
        clickedInsideDropdown = true;
    });
    saveAll.addEventListener("click", (e) => {
        const all = middleman.urls
        const save = getOutText(all)
        if (save) mgmapi.saveText(save,"M3U8_allResults.txt");
    });
    saveVisible.addEventListener("click", (e) => {
        const pageData = getPageData()
        const save = getOutText(pageData)
        if (save) mgmapi.saveText(save,"M3U8_visibleResults.txt");
    });
    saveFiltered.addEventListener("click", (e) => {
        const filtered = [...filteredUrls]
        const save = getOutText(filtered)
        if (save) mgmapi.saveText(save,"M3U8_filteredResults.txt");
    });
    saveSelected.addEventListener("click", (e) => {
        const selectedItems = Array.from(URLManager.urls.values()).filter(item => item.selected === true);
        const save = getOutText(selectedItems)
        if (save) mgmapi.saveText(save,"M3U8_selectedResults.txt");
    });
    settingsToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (settingsToggle.getAttribute("disabled") === "true") return;
        showHideDropdown(settingsDropdown);
    });
    settingsDropdown.addEventListener("pointerdown", () => {
        clickedInsideDropdown = true;
    });
    ignoreCaseToggle.addEventListener("change", (e) => {
        ignoreCase = ignoreCaseToggle.checked
    });
    filterToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (filterToggle.getAttribute("disabled") === "true") return;
        showHideDropdown(filterDropdown);
    });
    filterDropdown.addEventListener("pointerdown", () => {
        clickedInsideDropdown = true;
    });
    currentUrls = URLManager.urls;
    filterCheckboxes.forEach(cb => {
        cb.addEventListener("change", () => {
            clickedInsideDropdown = true;
            debounceFiltering()
        });
    });
    pauseToggle.addEventListener("click", (e) => {
        if (isMonitoring) {
            pauseMonitoring()
        } else {
            startMonitoring()
        }
        console.log("isMonitoring m3u8++",isMonitoring)
    });
    clearToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (clearToggle.getAttribute("disabled") === "true") return;
        showHideDropdown(clearDropdown);
    });
    clearDropdown.addEventListener("pointerdown", () => {
        clickedInsideDropdown = true;
    });
    clearAll.addEventListener("click", (e) => {
        middleman.clearAll();
    });
    clearVisible.addEventListener("click", (e) => {
        middleman.clearVisible();
    });
    clearFiltered.addEventListener("click", (e) => {
        middleman.clearFiltered();
    });
    clearSelected.addEventListener("click", (e) => {
        middleman.clearSelected();
    });
    document.addEventListener("click", (e) => {
        if (dropdownFilterTimeout) return;
        dropdownFilterTimeout = setTimeout(() => {
            if (!clickedInsideDropdown) {
                hideDropdownIfVisible();
            }
            clickedInsideDropdown = false;
            dropdownFilterTimeout = undefined;
        }, 30);
    });

    const debounceUpdatePageSize = debounce((newSize) => {
        middleman.setPageSize(newSize);
        triggerUIUpdate();
    }, 150);

    ["click", "keydown", "keyup", "keypress"].forEach(evt => {
        inputMaxRow.addEventListener(evt, (e) => {
            e.stopPropagation();
        });
    });

    if (inputMaxRow) inputMaxRow.value = middleman.pageSize;

    inputMaxRow.addEventListener("input", (e) => {
        e.stopPropagation();
        const original = middleman.pageSize;
        const value = inputMaxRow.value;
        const validValue = value.replace(/[^0-9]/g, '');
        if (validValue) {
            inputMaxRow.value = validValue;
            middleman.setPageSize(parseInt(validValue));
        } else {
            inputMaxRow.value = 1;
            middleman.setPageSize(1);
        }
        if (middleman.pageSize !== original) triggerUIUpdate();
    });
    if (!isTouchDevice) {

        inputMaxRow.addEventListener("wheel", (e) => {
            e.preventDefault();
            e.stopPropagation();

            let delta = Math.sign(e.deltaY);
            let current = parseInt(inputMaxRow.value) || 1;
            let newValue = Math.max(1, current - delta);

            inputMaxRow.value = newValue;
            debounceUpdatePageSize(newValue);
        }, { passive: false });
    } else {
        let touchStartY = null;
        inputMaxRow.addEventListener("touchstart", (e) => {
            if (e.touches.length === 1) {
                touchStartY = e.touches[0].clientY;
            }
        }, { passive: true });
        inputMaxRow.addEventListener("touchmove", (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (touchStartY === null) return;

            const touchEndY = e.touches[0].clientY;
            const deltaY = touchStartY - touchEndY;
            if (Math.abs(deltaY) > 20) {
                let current = parseInt(inputMaxRow.value) || 1;
                let newValue = deltaY > 0
                    ? current + 1
                    : Math.max(1, current - 1);

                inputMaxRow.value = newValue;
                debounceUpdatePageSize(newValue);

                touchStartY = touchEndY;
            }
        }, { passive: false });
    }


    ["click", "keydown", "keyup", "keypress"].forEach(evt => {
        filterInput.addEventListener(evt, (e) => {
            e.stopPropagation();
            hideDropdownIfVisible();
        });
    });
    filterInput.addEventListener("input", (e) => {
        e.stopPropagation();
        debounceFiltering();
        hideDropdownIfVisible();
    });
    function hideDropdownIfVisible(x) {
        if (x) {
            x.forEach((dropdown) => {
                if (window.getComputedStyle(dropdown).display !== "none") {
                    dropdown.style.display = "none";
                }
            });
        } else {
            [filterDropdown,settingsDropdown,copyDropdown,saveDropdown,clearDropdown].forEach((dropdown) => {
                if (window.getComputedStyle(dropdown).display !== "none") {
                    dropdown.style.display = "none";
                }
            });
        }
    }
    function showHideDropdown(dropdown) {

        if (!dropdown) return;
        const dropdowns = {
            filterDropdown,
            settingsDropdown,
            copyDropdown,
            saveDropdown,
            clearDropdown
        };

        const buttons = {
            filterDropdown: filterToggle,
            settingsDropdown: settingsToggle,
            copyDropdown: copyToggle,
            saveDropdown: saveToggle,
            clearDropdown: clearToggle
        };

        Object.values(dropdowns).forEach(dd => {
            if (dd !== dropdown) {
                dd.style.display = "none";
            }
        });

        const key = Object.entries(dropdowns).find(([_, dd]) => dd === dropdown)?.[0];
        if (!key) return;

        const button = buttons[key];
        if (button) {
            const buttonRect = button.getBoundingClientRect();
            const parentRect = button.offsetParent.getBoundingClientRect();

            const left = buttonRect.left - parentRect.left;

            dropdown.style.left = `${left}px`;
            dropdown.style.right = 'auto';
        }

        dropdown.style.display = window.getComputedStyle(dropdown).display === "none" ? "flex" : "none";
    }

    function changePage(state) {
        let curr = middleman.currentPage;
        function update(newpage) { middleman.setPage(newpage); renderTable(); }
        function currCheck(control,c) {
            if (control === "prev") {
                return c === 1 && totalFilteredPages() !== 1;
            } else {
                return c === totalFilteredPages() && c !== 1;
            }
        }
        if (state === "prev") {
            if (curr > 1) {
                curr--;
                update(curr);
            } else if (circularPageToggle && circularPageToggle.checked && currCheck("prev",curr)) {
                curr = totalFilteredPages();
                update(curr);
            }
        } else {
            const totalPages = totalFilteredPages();
            if (curr < totalPages) {
                curr++
                update(curr)
            } else if (circularPageToggle && circularPageToggle.checked && currCheck("next",curr)) {
                curr = 1
                update(curr)
            }
        }
    }
    prevBtn.addEventListener('click', () => {
        changePage("prev");
    });
    nextBtn.addEventListener('click', () => {
        changePage("next")
    });

    renderTable();

})();
