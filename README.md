## WORK IN PROGRESS, BY ME:</br>AN INCOMPETENT MORON

Tampermonkey script to expose m3u8 links

Slimmed down version of
</br>[M3U8 Video Detector and Downloader](https://greasyfork.org/en/scripts/449581-m3u8%E8%A7%86%E9%A2%91%E4%BE%A6%E6%B5%8B%E4%B8%8B%E8%BD%BD%E5%99%A8-%E8%87%AA%E5%8A%A8%E5%97%85%E6%8E%A2/code)
</br>by [allFull](https://greasyfork.org/en/users/168235-allfull)

![img](https://github.com/trasheap/m3u8-list-monkeyscript/blob/main/preview.png)

### Features added:
* Scrollable list
* Copy full list to clipboard
* Download list or link as .txt
* Clear all or remove link


### Features removed:
* Download (didn't work for me)
* Handling of magnet links

```js
// ==UserScript==
// @name         M3U8
// @name:en      M3U8
// @version      0.1
// @description  Automatically detect the m3u8 video of the page and download it completely. Once detected the m3u8 link, it will appear in the upper right corner of the page.
// @author       allFull-n-Me
// @namespace    http://tampermonkey.net/
// @match        *://*/*
// @require      https://cdn.jsdelivr.net/npm/m3u8-parser@4.7.1/dist/m3u8-parser.min.js
// @connect      *
// @grant        unsafeWindow
// @grant        GM_openInTab
// @grant        GM.openInTab
// @grant        GM_getValue
// @grant        GM.getValue
// @grant        GM_setValue
// @grant        GM.setValue
// @grant        GM_deleteValue
// @grant        GM.deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_download
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const mgmapi = {

        addStyle(s) {
            let style = document.createElement("style");
            style.innerHTML = s;
            document.documentElement.appendChild(style);
        },
        async getValue(name, defaultVal) {
            return await ((typeof GM_getValue === "function") ? GM_getValue : GM.getValue)(name, defaultVal);
        },
        async setValue(name, value) {
            return await ((typeof GM_setValue === "function") ? GM_setValue : GM.setValue)(name, value);
        },
        async deleteValue(name) {
            return await ((typeof GM_deleteValue === "function") ? GM_deleteValue : GM.deleteValue)(name);
        },
        openInTab(url, open_in_background = false) {
            return ((typeof GM_openInTab === "function") ? GM_openInTab : GM.openInTab)(url, open_in_background);
        },
        xmlHttpRequest(details) {
            return ((typeof GM_xmlhttpRequest === "function") ? GM_xmlhttpRequest : GM.xmlHttpRequest)(details);
        },
        download(details) {

            return

        },
        downloadTxt(text,defaultName) {
            let filename = prompt("Enter a filename:", defaultName);
            if (!filename) {
                return; // User cancelled or entered nothing
            }

            // Sanitize filename: remove illegal characters for most file systems
            filename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();

            // Optional: ensure it has a .txt extension
            if (!filename.toLowerCase().endsWith('.txt')) {
                filename += '.txt';
            }

            dowloadAsTxt(text,filename);
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
        message(text, disappearTime = 5000) {
            const id = "f8243rd238-gm-message-panel";
            let p = document.querySelector(`#${id}`);
            if (!p) {
                p = document.createElement("div");
                p.id = id;
                p.style = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: end;
                    z-index: 999999999999999;
                `;
                (document.body || document.documentElement).appendChild(p);
            }
            let mdiv = document.createElement("div");
            mdiv.innerText = text;
            mdiv.style = `
                padding: 5px 8px;
                border-radius: 5px;
                background: green;
                margin-top: 10px;
                font-size: small;
                color: #fff;
                text-align: right;
            `;
            p.appendChild(mdiv);
            setTimeout(() => {
                p.removeChild(mdiv);
            }, disappearTime);
        }
    };

    if (location.host === "localhost:3000") {
        mgmapi.addStyle("#userscript-tip{display:none !important;}");

        const _fetch = unsafeWindow.fetch;
        unsafeWindow.fetch = async function (...args) {

            try {
                let response = await _fetch(...args);
                if (response.status !== 200) throw new Error(response.status);
                return response;

            } catch (e) {

                if (args.length == 1) {
                    console.log(`+m3u8 tampermonkey+：${args[0]}`);
                    return await new Promise((resolve, reject) => {
                        let referer = new URLSearchParams(location.hash.slice(1)).get("referer");
                        let headers = {};
                        if (referer) {
                            referer = new URL(referer);
                            headers = {
                                "origin": referer.origin,
                                "referer": referer.href
                            };
                        }
                        mgmapi.xmlHttpRequest({
                            method: "GET",
                            url: args[0],
                            responseType: 'arraybuffer',
                            headers,
                            onload(r) {
                                resolve({
                                    status: r.status,
                                    headers: new Headers(r.responseHeaders.split("\n").filter(n => n).map(s => s.split(/:\s*/)).reduce((all, [a, b]) => { all[a] = b; return all; }, {})),
                                    async text() {
                                        return r.responseText;
                                    },
                                    async arrayBuffer() {
                                        return r.response;
                                    }
                                });
                            },
                            onerror() {
                                reject(new Error());
                            }
                        });
                    });
                } else {
                    throw e;
                }
            }
        }
        return;
    }

    window.addEventListener("message", async (e) => {
        if (e.data === "3j4t9uj349-gm-get-title") {
            let name = `top-title-${Date.now()}`;
            await mgmapi.setValue(name, document.title);
            e.source.postMessage(`3j4t9uj349-gm-top-title-name:${name}`, "*");
        }
    });

    function getTopTitle() {
        return new Promise(resolve => {
            window.addEventListener("message", async function l(e) {
                if (typeof e.data === "string") {
                    if (e.data.startsWith("3j4t9uj349-gm-top-title-name:")) {
                        let name = e.data.slice("3j4t9uj349-gm-top-title-name:".length);
                        await new Promise(r => setTimeout(r, 5));
                        resolve(await mgmapi.getValue(name));
                        mgmapi.deleteValue(name);
                        window.removeEventListener("message", l);
                    }
                }
            });
            window.top.postMessage("3j4t9uj349-gm-get-title", "*");
        });
    }


    {
        // 请求检测
        // const _fetch = unsafeWindow.fetch;
        // unsafeWindow.fetch = function (...args) {
        //     if (checkUrl(args[0])) doM3U({ url: args[0] });
        //     return _fetch(...args);
        // }

        const _r_text = unsafeWindow.Response.prototype.text;
        unsafeWindow.Response.prototype.text = function () {
            return new Promise((resolve, reject) => {
                _r_text.call(this).then((text) => {
                    resolve(text);
                    if (checkContent(text)) doM3U({ url: this.url, content: text });
                }).catch(reject);
            });
        }

        const _open = unsafeWindow.XMLHttpRequest.prototype.open;
        unsafeWindow.XMLHttpRequest.prototype.open = function (...args) {
            this.addEventListener("load", () => {
                try {
                    let content = this.responseText;
                    if (checkContent(content)) doM3U({ url: args[1], content });
                } catch { }
            });
            // checkUrl(args[1]);
            return _open.apply(this, args);
        }

        function checkUrl(url) {
            url = new URL(url, location.href);
            if (url.pathname.endsWith(".m3u8") || url.pathname.endsWith(".m3u")) {
                return true;
            }
        }

        function checkContent(content) {
            if (content.trim().startsWith("#EXTM3U")) {
                return true;
            }
        }

        setInterval(doVideos, 1000);
    }

    const rootDiv = document.createElement("div");
    rootDiv.style = `
        position: fixed;
        z-index: 9999999999999999;
        opacity: 0.9;
    `;
    rootDiv.style.display = "none";
    document.documentElement.appendChild(rootDiv);

    const shadowDOM = rootDiv.attachShadow({ mode: 'open' });
    const wrapper = document.createElement("div");

    shadowDOM.appendChild(wrapper);


    const bar = document.createElement("div");
    bar.style = `
        text-align: right;
    `;
    bar.innerHTML = `
        <span
            class="number-indicator"
            data-number="0"
            style="
                display: inline-flex;
                background: transparent;
                border-radius: 15%;
                margin-bottom: 0.08em;
                cursor: pointer;
                border: none;
            "
        >
        </span>
    `;
    wrapper.appendChild(bar);

    const downloadAllContainer = document.createElement("div");
    downloadAllContainer.style.textAlign = "right";
    downloadAllContainer.style.display = "block";
    downloadAllContainer.style.marginBottom = ".08em";
    downloadAllContainer.innerHTML = `

        <span
            class="clear-all-btn"
            style="
                display: inline-flex;
                background: transparent;
                font-size: .9rem;
                padding: .5em;
                cursor: pointer;
                border: none;
            "
        >
        🧹
        </span>

        <span
            class="copy-all-btn"
            style="
                display: inline-flex;
                background: transparent;
                font-size: .9rem;
                cursor: pointer;
                border: none;
                margin-left:1em;
                padding: .5em;
            "
        >
        📋
        </span>

        <span
            class="download-all-btn"
            style="
                display: inline-flex;
                background: transparent;
                font-size: .9rem;
                cursor: pointer;
                border: none;
                margin-left:1em;
                padding: .5em;
            "
        >
        💾
        </span>
    `;
    wrapper.appendChild(downloadAllContainer);
    const copyAll = downloadAllContainer.querySelector(".copy-all-btn")
    const downloadAll = downloadAllContainer.querySelector(".download-all-btn")
    const clearAll = downloadAllContainer.querySelector(".clear-all-btn")
    const subwrapper = document.createElement("div");
    subwrapper.style = `
        overflow-y: auto;
        max-height: 60dvh;
        padding-right: 10px;
    `;
    wrapper.appendChild(subwrapper);
    const style = document.createElement("style");

    style.innerHTML = `
        .number-indicator{
            position:relative;
        }

        .number-indicator::after{
            content: attr(data-number);
            color: #40a9ff;
            font-size: .9rem;
            padding: .5em;
            font-weight: bold;
            border-radius: 15%;
            background: rgba(0,0,0,0.6);
        }

        .copy-link:active{
            color: #ccc;
        }

        .download-btn:hover{
            text-decoration: underline;
        }
        .download-btn:active{
            opacity: 0.9;
        }

        .m3u8-item{
            color: white;
            margin-bottom: 0.3em;
            display: flex;
            flex-direction: row;
            background: black;
            padding: 3px 10px;
            border-radius: 3px;
            font-size: 0.9rem;
            user-select: none;
        }

        [data-shown="false"] {
            opacity: 0.8;
            zoom: 0.8;
        }

        [data-shown="false"]:hover{
            opacity: 1;
        }

        [data-shown="false"] .m3u8-item{
            display: none;
        }

    `;

    wrapper.appendChild(style);

    const barBtn = bar.querySelector(".number-indicator");

    let shownUrls = [];
    let count = 0;


    (async function () {

        let shown = await GM_getValue("shown", true);
        wrapper.setAttribute("data-shown", shown);

        let x = await GM_getValue("x", 10);
        let y = await GM_getValue("y", 20);

        x = Math.min(innerWidth - 50, x);
        y = Math.min(innerHeight - 50, y);

        if (x < 0) x = 0;
        if (y < 0) y = 0;

        rootDiv.style.top = `${y}px`;
        rootDiv.style.right = `${x}px`;

        barBtn.addEventListener("mousedown", e => {
            let startX = e.pageX;
            let startY = e.pageY;
            let moved = false;

            let mousemove = e => {
                let offsetX = e.pageX - startX;
                let offsetY = e.pageY - startY;

                if (moved || (Math.abs(offsetX) + Math.abs(offsetY)) > 5) {
                    moved = true;
                    rootDiv.style.top = `${y + offsetY}px`;
                    rootDiv.style.right = `${x - offsetX}px`;
                }
            };

            let mouseup = e => {
                let offsetX = e.pageX - startX;
                let offsetY = e.pageY - startY;

                if (moved) {
                    x -= offsetX;
                    y += offsetY;
                    mgmapi.setValue("x", x);
                    mgmapi.setValue("y", y);

                } else {

                    shown = !shown;
                    mgmapi.setValue("shown", shown);
                    wrapper.setAttribute("data-shown", shown);

                    if (shown) {
                        downloadAllContainer.style.display = "block"

                    } else {
                        downloadAllContainer.style.display = "none"
                    }
                }
                removeEventListener("mousemove", mousemove);
                removeEventListener("mouseup", mouseup);
            }
            addEventListener("mousemove", mousemove);
            addEventListener("mouseup", mouseup);
        });
        downloadAll.addEventListener("click", e => {
            let links = [];
            for (let v of Array.from(subwrapper.querySelectorAll(".copy-link"))) {

                links.push(v.getAttribute("title"));
            }
            mgmapi.downloadTxt(links.join('\n'),"m3u8list.txt")
        });
        copyAll.addEventListener("click", e => {
            let links = [];
            for (let v of Array.from(subwrapper.querySelectorAll(".copy-link"))) {

                links.push(v.getAttribute("title"));
            }
            mgmapi.copyText(links.join('\n'));
            mgmapi.message(`${links.length} links copied!`, 2000);
        });
        clearAll.addEventListener("click", e => {
            subwrapper.innerHTML = ""
            shownUrls = []
            bar.querySelector(".number-indicator").setAttribute("data-number", 0);
            count = 0
        });

    })();


    function doVideos() {
        for (let v of Array.from(document.querySelectorAll("video"))) {
            if (v.duration && v.src && v.src.startsWith("http") && (!shownUrls.includes(v.src))) {
                const src = v.src;

                shownUrls.push(src);
                showVideo({
                    type: "video",
                    url: new URL(src),
                    duration: `${Math.ceil(v.duration * 10 / 60) / 10} mins`,
                    download() {
                        const details = {
                            url: src,
                            name: (() => {
                                let name = new URL(src).pathname.split("/").slice(-1)[0];
                                if (!/\.\w+$/.test(name)) {
                                    if (name.match(/^\s*$/)) name = Date.now();
                                    name = name + ".mp4";
                                }
                                return name;
                            })(),
                            headers: {
                                // referer: location.origin,
                                origin: location.origin
                            },
                            onerror(e) {
                                mgmapi.openInTab(src);
                            }
                        };
                        mgmapi.downloadTxt(details.url,"m3u8video.txt")
                    }
                })
            }
        }
    }


    async function doM3U({ url, content }) {

        url = new URL(url);

        if (shownUrls.includes(url.href)) return;

        content = content || await (await fetch(url)).text();

        const parser = new m3u8Parser.Parser();
        parser.push(content);
        parser.end();
        const manifest = parser.manifest;

        if (manifest.segments) {
            let duration = 0;
            manifest.segments.forEach((segment) => {
                duration += segment.duration;
            });
            manifest.duration = duration;
        }

        showVideo({
            type: "m3u8",
            url,
            duration: manifest.duration ? `${Math.ceil(manifest.duration * 10 / 60) / 10} mins` : manifest.playlists ? `Multi ${manifest.playlists.length}` : "unknown",
            async download() {

                mgmapi.downloadTxt(url,"m3u8link.txt")
            }
        })
    }


    async function showVideo({
        type,
        url,
        duration,
        download
    }) {

        // if (!shownUrls.includes(url.href)) {
        let div = document.createElement("div");
        div.className = "m3u8-item";
        div.innerHTML = `
            <span
                class="delete-btn"
                style="
                    cursor: pointer;
            ">🗑️</span>
            <span
                class="typeof-link"
                style="
                    margin-left: .3em;
                "
            >${type}</span>
            <span
                class="copy-link"
                title="${url}"
                style="
                    max-width: 200px;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    overflow: hidden;
                    margin-left: .3em;
                    cursor: pointer;
                "
            >${url.pathname}</span>
            <span
                style="
                    margin-left: .3em;
                    flex-grow: 1;
                "
            >${duration}</span>
            <span
                class="download-btn"
                style="
                    margin-left: .3em;
                    cursor: pointer;
            ">💾</span>
        `;

        div.querySelector(".copy-link").addEventListener("click", () => {
            mgmapi.copyText(url.href);
            mgmapi.message("link copied!", 2000);
        });

        div.querySelector(".download-btn").addEventListener("click", download);

        div.querySelector(".delete-btn").addEventListener("click", () => {
            const index = shownUrls.indexOf(url.href);

            if (index !== -1) {
                shownUrls.splice(index, 1);
            } else {
                console.warn(`URL ${url.href} not found in shownUrls!`);
            }

            div.remove();

            count--;
            bar.querySelector(".number-indicator").setAttribute("data-number", count);

            mgmapi.message("item deleted!", 2000);
        });



        rootDiv.style.display = "block";
        count++;
        shownUrls.push(url.href);
        bar.querySelector(".number-indicator").setAttribute("data-number", count);
        subwrapper.appendChild(div);
        // }
    }
})();

```
