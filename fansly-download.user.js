// ==UserScript==
// @name        Fansly - Download single posts & messages
// @namespace   github.com/AnimatedEightball
// @match       https://fansly.com/*
// @grant       unsafeWindow
// @grant       GM_download
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_xmlhttpRequest
// @grant       GM_registerMenuCommand
// @grant       GM_unregisterMenuCommand
// @require 	https://cdn.jsdelivr.net/npm/@violentmonkey/dom@2
// @require     https://cdnjs.cloudflare.com/ajax/libs/mux.js/6.3.0/mux.js
// @downloadURL https://raw.githubusercontent.com/AnimatedEightball/Fansly-Userscript/1c3a6f3781a601492afdab7bbabbe08119a1b120/fansly-download.js
// @updateURL   https://raw.githubusercontent.com/AnimatedEightball/Fansly-Userscript/1c3a6f3781a601492afdab7bbabbe08119a1b120/fansly-download.js
// @homepageURL https://github.com/AnimatedEightball/Fansly-Userscript/
// @icon        https://m.leak.fans/ujs/fansly-icon.png
// @version     0.9.5
// @author      M&S
// @description Work in progress userscript for download media of single posts & message media on Fansly.
// ==/UserScript==

/**
 * Usage, changelog & other information - Please read the README on the GitHub Gist page: https://gist.github.com/M-rcus/a29673a5fcf22afd0e67d549b36496a7
 */

const downloadIconClasses = 'fal fa-fw fa-file-upload fa-rotate-180 pointer';

/**
 * curl and yt-dlp (for m3u8 files) commands will be put into a .sh script and that will be downloaded instead.
 * Alternative method, since browsers have a tendency to get a bit sluggish when you're downloading 30+ files all at once.
 *
 * For the time being, if you want this to work, you'll have to go on the "Values" tab at the top of this script and set `SCRIPT_DOWNLOAD` to true.
 */
const scriptDownload = GM_getValue('SCRIPT_DOWNLOAD', false);

/**
 * When enabled, m3u8 playlists are fetched and transmuxed to MP4 in-browser via mux.js.
 * Disable on lower-end devices to fall back to direct download (lower quality static file).
 * Toggled via the Violentmonkey context menu.
 */
let m3u8Download = GM_getValue('M3U8_DOWNLOAD', true);

let m3u8MenuCommandId = null;
function registerMenuCommands()
{
    if (m3u8MenuCommandId !== null) {
        GM_unregisterMenuCommand(m3u8MenuCommandId);
    }

    m3u8MenuCommandId = GM_registerMenuCommand(
        `M3U8 in-browser download: ${m3u8Download ? 'ON' : 'OFF'}`,
        function() {
            m3u8Download = !m3u8Download;
            console.log(`M3U8 in-browser download set to ${m3u8Download}`);
            GM_setValue('M3U8_DOWNLOAD', m3u8Download);
            registerMenuCommands();
        },
        {
            autoClose: true,
        }
    );
}

registerMenuCommands();

/**
 * Helper function to save text as a file (primarily for scriptDownload).
 */
const saveAs = (function () {
    var a = document.createElement("a");
    document.body.appendChild(a);
    a.style = "display: none";
    return function (data, fileName) {
        var blob = new Blob([data], {type: "octet/stream"});
        var url = window.URL.createObjectURL(blob);
        a.href = url;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(url);
    };
}());

/**
 * Create a timestamp
 */
function formatTimestamp(timestamp)
{
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[0];
}

function getAngularAttribute(element)
{
    const attributes = Array.from(element.attributes);
    const relevantAttribute = attributes.find(x => x.name.includes('_ngcontent'));

    if (!relevantAttribute) {
        console.error('Has no relevant attributes', element, attributes);
        return 'unable-to-find-it';
    }

    return relevantAttribute.name;
}

/**
 * Extract token from localStorage
 */
function getToken()
{
    const ls = unsafeWindow.localStorage;
    const session = JSON.parse(ls.getItem('session_active_session'));
    return session.token;
}

unsafeWindow.getAuthToken = getToken;

/**
 * Gets the position of the current accountMedia
 *
 * @param {Object} input Full response of a "get posts" request
 * @param {Object} accountMedia Current accountMedia object.
 * @param {Boolean} asNumber Return the position as a number, instead of a formatted string. Default: false
 */
function getPosition(input, accountMedia, asNumber)
{
    const accountMediaId = accountMedia.id;
    const { accountMediaBundles } = input.response;
    let position = null;

    if (!accountMediaBundles) {
        return position;
    }

    const bundle = accountMediaBundles.find(x => x.accountMediaIds.includes(accountMediaId));
    if (bundle) {
        const bundleContent = bundle.bundleContent;
        const getPosition = bundleContent.find(x => x.accountMediaId === accountMediaId);

        if (getPosition) {
            // Positions start from 0, so we add 1.
            position = getPosition.pos + 1;
        }
    }

    if (asNumber || position === null) {
        return position;
    }

    if (position < 10) {
        position = `0${position}`;
    }

    return `${position}`;
}

let fileIncrements = {};

/**
 * Extracts the highest-quality M3U8 URL and raw CloudFront cookies from a media object.
 * Returns null if the media has no M3U8 playlist variant.
 *
 * @param {Object} media
 * @returns {{ url: String, cookies: Object }|null}
 */
function getM3u8Info(media)
{
    const { variants } = media;
    // Type 302 = HLS (application/vnd.apple.mpegurl)
    const playlist = variants.find(file => file.type === 302);

    if (!playlist || playlist.locations.length === 0) {
        return null;
    }

    const location = playlist.locations[0];
    // location.location is the master playlist URL; downloadM3u8AsMP4 will
    // resolve the highest-quality variant stream from it at download time.
    return { url: location.location, cookies: location.metadata };
}

function getVideoDownloadCommand(media, filename, asCurl)
{
    const info = getM3u8Info(media);
    if (!info) {
        return null;
    }

    const { url, cookies } = info;
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `CloudFront-${k}=${v}`).join('; ');

    if (asCurl) {
        return `curl -L -o "${filename}" -H "Origin: https://fansly.com" -H "Referer: https://fansly.com/" -H "Cookie: ${cookieHeader}" "${url}"`;
    }

    return `yt-dlp -o "${filename}" --add-header "Origin:https://fansly.com" --add-header "Referer:https://fansly.com/" --add-header "Cookie:${cookieHeader}" "${url}"`;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Promise wrapper around GM_xmlhttpRequest.
 * Used to fetch m3u8 playlists and TS segments without CORS restrictions.
 * Automatically retries on 429 (rate limit), respecting Retry-After if present.
 *
 * @param {String} url
 * @param {Object} headers Key/value pairs to send as request headers.
 * @param {'text'|'arraybuffer'} responseType
 * @returns {Promise}
 */
async function gmFetch(url, headers = {}, responseType = 'text')
{
    const MAX_RETRIES = 5;
    let delay = 2000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers,
                responseType,
                onload: resolve,
                onerror: reject,
                ontimeout: reject,
            });
        });

        if (response.status !== 429) {
            return response;
        }

        if (attempt === MAX_RETRIES) {
            console.error(`[gmFetch] 429 after ${MAX_RETRIES} retries: ${url}`);
            return response;
        }

        // Parse Retry-After header from raw response header string
        const retryAfterMatch = response.responseHeaders?.match(/retry-after:\s*(\d+)/i);
        const waitMs = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) * 1000 : delay;
        console.warn(`[gmFetch] 429 rate limited. Retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await sleep(waitMs);
        delay = Math.min(delay * 2, 30000);
    }
}

/**
 * Fetches an M3U8 playlist, downloads all TS segments, transmuxes them to MP4
 * using mux.js, and triggers a browser download of the resulting file.
 *
 * @param {String} m3u8Url   URL of the M3U8 playlist (highest quality variant).
 * @param {Object} cookies   Key/value pairs for CloudFront cookies (without the CloudFront- prefix).
 * @param {String} filename  Output filename (without extension).
 * @param {Number} createdAt Unix timestamp in seconds from the API, used to set the file's modified date.
 */
async function downloadM3u8AsMP4(m3u8Url, cookies, filename, createdAt)
{
    const cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `CloudFront-${k}=${v}`)
        .join('; ');

    const sharedHeaders = {
        'Origin': 'https://fansly.com',
        'Referer': 'https://fansly.com/',
        'Cookie': cookieHeader,
    };

    console.log(`[m3u8] Fetching master playlist: ${m3u8Url}`);
    const masterRes = await gmFetch(m3u8Url, sharedHeaders, 'text');
    const masterText = masterRes.responseText;
    const masterBase = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);

    // If this is a master playlist, pick the highest-bandwidth variant stream.
    let variantUrl = m3u8Url;
    if (masterText.includes('#EXT-X-STREAM-INF')) {
        const lines = masterText.split('\n').map(l => l.trim());
        let bestBandwidth = -1;
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
            const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
            const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            const uri = lines[i + 1];
            if (uri && !uri.startsWith('#') && bandwidth > bestBandwidth) {
                bestBandwidth = bandwidth;
                variantUrl = uri.startsWith('http') ? uri : masterBase + uri;
            }
        }
        console.log(`[m3u8] Selected variant stream (bandwidth ${bestBandwidth}): ${variantUrl}`);
    }

    // Fetch the variant (media) playlist to get the segment list.
    const playlistRes = variantUrl === m3u8Url
        ? { responseText: masterText }
        : await gmFetch(variantUrl, sharedHeaders, 'text');
    const playlistText = playlistRes.responseText;

    // Resolve segment URLs (may be relative or absolute).
    const variantBase = variantUrl.substring(0, variantUrl.lastIndexOf('/') + 1);
    const segmentUrls = playlistText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
        .map(line => line.startsWith('http') ? line : variantBase + line);

    if (segmentUrls.length === 0) {
        console.error('[m3u8] No segments found in playlist.');
        return;
    }

    console.log(`[m3u8] Found ${segmentUrls.length} segments. Transmuxing to MP4...`);

    const transmuxer = new muxjs.mp4.Transmuxer();
    const mp4Chunks = [];

    // initSegment is only emitted on the first flush. Prepend it once, then
    // append only the data portion from subsequent flushes to avoid duplicate
    // MOOV atoms (one per segment) that confuse players and tools like ffprobe.
    let initSegmentWritten = false;
    // mux.js does not include duration on the 'data' segment object.
    // Instead, accumulate from videoSegmentTimingInfo (end.pts in 90kHz ticks).
    // Fall back to audioSegmentTimingInfo if there is no video track.
    let videoDuration90k = 0;
    let audioDuration90k = 0;
    transmuxer.on('videoSegmentTimingInfo', info => {
        videoDuration90k = Math.max(videoDuration90k, info.end.pts);
    });
    transmuxer.on('audioSegmentTimingInfo', info => {
        audioDuration90k = Math.max(audioDuration90k, info.end.pts);
    });
    transmuxer.on('data', segment => {
        if (!initSegmentWritten && segment.initSegment.byteLength > 0) {
            mp4Chunks.push(new Uint8Array(segment.initSegment));
            initSegmentWritten = true;
        }
        mp4Chunks.push(new Uint8Array(segment.data));
    });

    for (let i = 0; i < segmentUrls.length; i++) {
        const segUrl = segmentUrls[i];
        console.log(`[m3u8] Fetching segment ${i + 1}/${segmentUrls.length}`);
        const segRes = await gmFetch(segUrl, sharedHeaders, 'arraybuffer');
        transmuxer.push(new Uint8Array(segRes.response));
    }

    transmuxer.flush();

    // Concatenate all chunks into a single Uint8Array.
    const totalLength = mp4Chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const mp4Data = new Uint8Array(totalLength);
    let writeOffset = 0;
    for (const chunk of mp4Chunks) {
        mp4Data.set(chunk, writeOffset);
        writeOffset += chunk.byteLength;
    }

    const totalDuration90k = videoDuration90k || audioDuration90k;
    console.log(`[m3u8] Transmux complete. Total size: ${(totalLength / 1024 / 1024).toFixed(2)} MB. Duration: ${(totalDuration90k / 90000).toFixed(2)}s. Triggering download...`);

    patchMp4Timestamps(mp4Data, createdAt, totalDuration90k);

    const file = new File([mp4Data], `${filename}.mp4`, {
        type: 'video/mp4',
        lastModified: createdAt * 1000,
    });
    const blobUrl = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${filename}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
}

/**
 * Recursively walks MP4 boxes within [start, end) and patches creation_time
 * and modification_time in mvhd and tkhd boxes.
 *
 * @param {DataView} view
 * @param {Number} start Byte offset of first child box
 * @param {Number} end   Byte offset of end of parent box
 * @param {Number} macTimestamp Seconds since Mac epoch (Jan 1 1904)
 * @param {Number} duration90k Total duration in 90kHz ticks (mvhd/tkhd timescale)
 */
function patchBoxes(view, start, end, macTimestamp, duration90k)
{
    let i = start;
    while (i + 8 <= end) {
        const boxSize = view.getUint32(i, false);
        const boxType = view.getUint32(i + 4, false);
        if (boxSize < 8) break;

        if (boxType === 0x6D766864) { // 'mvhd'
            // version(1)+flags(3)+creation(4)+modification(4)+timescale(4)+duration(4)
            view.setUint32(i + 12, macTimestamp, false); // creation_time
            view.setUint32(i + 16, macTimestamp, false); // modification_time
            view.setUint32(i + 24, duration90k >>> 0, false); // duration (after timescale)
        } else if (boxType === 0x746B6864) { // 'tkhd'
            // version(1)+flags(3)+creation(4)+modification(4)+track_id(4)+reserved(4)+duration(4)
            view.setUint32(i + 12, macTimestamp, false); // creation_time
            view.setUint32(i + 16, macTimestamp, false); // modification_time
            view.setUint32(i + 28, duration90k >>> 0, false); // duration (after track_id+reserved)
        } else if (boxType === 0x74726163 || boxType === 0x6D646961) { // 'trak' or 'mdia'
            patchBoxes(view, i + 8, i + boxSize, macTimestamp, duration90k);
        }

        i += boxSize;
    }
}

/**
 * Patches the creation_time and modification_time fields in the mvhd and tkhd
 * MP4 boxes of a transmuxed Uint8Array in-place, so tools like ffprobe report
 * the correct date instead of a pre-1970 timestamp emitted by mux.js.
 *
 * @param {Uint8Array} mp4Data
 * @param {Number} createdAt Unix timestamp in seconds
 * @param {Number} duration90k Total duration in 90kHz ticks from transmuxer
 */
function patchMp4Timestamps(mp4Data, createdAt, duration90k)
{
    // MP4 stores time as seconds since Mac epoch (Jan 1 1904), not Unix epoch
    const macTimestamp = (createdAt + 2082844800) >>> 0;
    const view = new DataView(mp4Data.buffer, mp4Data.byteOffset, mp4Data.byteLength);

    let i = 0;
    while (i + 8 <= mp4Data.byteLength) {
        const boxSize = view.getUint32(i, false);
        const boxType = view.getUint32(i + 4, false);
        if (boxSize < 8) break;

        if (boxType === 0x6D6F6F76) { // 'moov'
            patchBoxes(view, i + 8, i + boxSize, macTimestamp, duration90k);
            break;
        }

        i += boxSize;
    }
}

/**
 * Returns true if the media object has a resolvable download URL,
 * meaning we have access to the real file and don't need the preview.
 *
 * @param {Object} media
 * @returns {Boolean}
 */
function mediaIsAccessible(media)
{
    const { locations, variants } = media;

    if (locations && locations.length > 0 && locations[0].location) {
        return true;
    }

    if (variants && variants.length > 0) {
        return variants.some(v => v.locations && v.locations.length > 0 && v.locations[0].location);
    }

    return false;
}

let cmds = [];

/**
 * @param {Object} input The whole post API response
 * @param {Object} accountMedia The `accountMedia` object
 * @param {Number} createdAt Timestamp in seconds (not milliseconds)
 * @param {Object} media The `media` key inside the `accountMedia` object (legacy)
 * @param {Object} metaType Used for differentiating between "preview" and unlocked posts.
 */
function extractMediaAndPreview(input, accountMedia, createdAt, media, metaType)
{
    let { filename, locations, id, variants, mimetype, post } = media;
    let usesVariants = false;

    if (!locations || locations.length === 0) {
        if (!variants || variants.length === 0) {
            return;
        }

        usesVariants = true;
        locations = variants;
    }

    /**
     * Download best quality of video even if the "original" quality currently isn't available
     * Seems like Fansly isn't the quickest when it comes to processing videos.
     */
    let url;
    let fileId = id;

    /**
     * Variants aka... quality options? Rescaled/reencoded lower resolutions I believe.
     * See if statement above.
     *
     * This handles the 'variants' section and retrieves file ID, mimetype etc. from the variant.
     * The default/fallback `location` is basically the "root" media object.
     */
    if (usesVariants) {
        for (const variant of locations)
        {
            const loc = variant.locations;
            if (!loc[0] || !loc[0].location) {
                continue;
            }

            url = loc[0].location;
            filename = variant.filename;
            mimetype = variant.mimetype;
            fileId = variant.id;

            console.log('Variant', variant);

            // End the loop on first match, or else it will overwrite with the worse qualities
            break;
        }
    } else {
        url = locations[0].location;
    }

    if (!url) {
        console.log(`No file found for media: ${id}`);
        return;
    }

    /**
     * Remove the file extension from the filename
     * And use the mimetype for the final file extension
     */
    let fileIncrement = parseInt(fileIncrements[fileId], 10);
    if (isNaN(fileIncrement)) {
        fileIncrement = 0;
    }

    fileIncrement++;
    fileIncrements[fileId] = fileIncrement;

    if (filename) {
        filename = filename.replace(/\.+[\w]+$/, '');
    }
    else {
        filename = fileIncrement < 10 ? `0${fileIncrement}` : `${fileIncrement}`;
    }
    const filetype = mimetype.replace(/^[\w]+\//, '');

    /**
     * Make sure metaType is formatted properly for use in filename.
     */
    if (!metaType) {
        metaType = '';
    } else {
        metaType = metaType + '_';
    }

    let postId = createdAt;
    if (post) {
        postId = post.id;
    }

    const position = getPosition(input, accountMedia);

    const date = formatTimestamp(createdAt);
    let filenameSegments = [
        date,
        postId,
        id,
        fileId,
    ];

    if (position !== null) {
        filenameSegments.splice(2, 0, position);
    }

    const finalFilename = `${filenameSegments.join('_')}.${filetype}`;
    let downloadCmd = `curl -Lo "${finalFilename}" -H "Origin: https://fansly.com" -H "Referer: https://fansly.com/" "${url}"`;
    if (filetype === 'mp4' && scriptDownload) {
        const newCmd = getVideoDownloadCommand(media, finalFilename);
        if (newCmd) {
            downloadCmd = newCmd;
        }
    }

    console.log(`Found file: ${finalFilename} - Triggering download...`);

    if (!scriptDownload) {
        // For mp4s backed by an M3U8 playlist, transmux in-browser via mux.js (if enabled).
        const m3u8Info = m3u8Download && filetype === 'mp4' && media.variants ? getM3u8Info(media) : null;
        if (m3u8Info) {
            const filenameNoExt = finalFilename.replace(/\.mp4$/, '');
            downloadM3u8AsMP4(m3u8Info.url, m3u8Info.cookies, filenameNoExt, createdAt);
        } else {
            GM_download({
                method: 'GET',
                url: url,
                name: finalFilename,
                saveAs: false,
            });
        }
    }
    else {
        cmds.push(downloadCmd);
    }
}

async function getMediaByIds(mediaIds)
{
    const response = await apiFetch(`/account/media?ids=${mediaIds.join(',')}&ngsw-bypass=true`);
    const medias = await response.json();
    return medias;
}

/**
 * Filters media and attempts to download available media.
 * Some posts are locked, but have open previews. Open previews will be downloaded.
 */
async function filterMedia(input, noPreview, maxCount)
{
    cmds = [];
    fileIncrements = {};
    if (!input) {
        if (!unsafeWindow.temp1) {
            console.error('No temp1 var');
            return;
        }

        input = unsafeWindow.temp1;
    }

    /**
     * New in v0.6.0
     */
    let mediaIds = [];
    let medias = input.response.accountMedia || input.response.aggregationData.accountMedia;
    const bundles = input.response.accountMediaBundles || [];
    for (const bundle of bundles)
    {
        const bundleMediaIds = bundle.accountMediaIds || [];
        mediaIds = [...mediaIds, ...bundleMediaIds];
    }

    // Get rid of dupes
    mediaIds = [... new Set(mediaIds)];

    // Get rid of any media objects we're about to fetch from the API.
    medias = medias.filter(x => !mediaIds.includes(x.id));

    const mediaResponse = await getMediaByIds(mediaIds);
    medias = [...medias, ...mediaResponse.response];

    const mediaCount = medias.length;
    maxCount = maxCount || mediaCount;
    let currentCount = 0;
    for (const entry of medias)
    {
        currentCount++;
        if (currentCount > maxCount) {
            break;
        }

        const { createdAt, media, preview } = entry;

        const posts = input.response.posts || [];

        let thePost = null;
        if (posts.length === 1) {
            thePost = posts[0];
        }

        media.post = thePost;

        // Trigger download for `media` (unlocked)
        extractMediaAndPreview(input, entry, createdAt, media);

        if (!preview || noPreview || mediaIsAccessible(media)) {
            continue;
        }

        preview.post = thePost;

        // Trigger download for locked media, with available previews.
        extractMediaAndPreview(input, entry, createdAt, preview, 'preview_');
    }

    if (scriptDownload) {
        saveAs(cmds.join('\n'), `fansly_${Date.now()}.sh`);
    }
}

unsafeWindow.filterMedia = filterMedia;

function buildApiUrl(path)
{
    if (path.includes('https://')) return path;
    if (path[0] !== '/') path = '/' + path;
    return `https://apiv3.fansly.com/api/v1${path}`;
}

async function apiFetch(path, method = 'GET', body = null)
{
    if (!path) {
        console.error('No path specified in apiFetch!');
        return;
    }

    const options = {
        headers: {
            accept: 'application/json',
            authorization: getToken(),
        },
        referrer: 'https://fansly.com/',
        referrerPolicy: 'strict-origin-when-cross-origin',
        method,
        mode: 'cors',
        credentials: 'include',
    };

    if (body !== null) {
        options.body = JSON.stringify(body);
    }

    const MAX_RETRIES = 5;
    let delay = 2000;
    const url = buildApiUrl(path);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await fetch(url, options);

        if (response.status !== 429) {
            return response;
        }

        if (attempt === MAX_RETRIES) {
            console.error(`[apiFetch] 429 after ${MAX_RETRIES} retries: ${url}`);
            return response;
        }

        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
        console.warn(`[apiFetch] 429 rate limited. Retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await sleep(waitMs);
        delay = Math.min(delay * 2, 30000);
    }
}

unsafeWindow.apiFetch = apiFetch;

/**
 * Get post data for a post ID and print cURL commands.
 */
async function getPost(postId, returnValue)
{
    const request = await apiFetch(`/post?ids=${postId}`);
    const response = await request.json();
    if (returnValue) {
        console.log('Post response', response);
        return response;
    }

    filterMedia(response);
}

unsafeWindow.getPost = getPost;

const cachedMessageGroups = {};
async function fetchAllMessageGroups()
{
    const BATCH_SIZE = 50;
    let allData = [];
    let allAccounts = [];
    let allGroups = [];
    let offset = 0;

    while (true) {
        const url = `/messaging/groups?limit=${BATCH_SIZE}&offset=${offset}`;
        const request = await apiFetch(url);
        const apiResponse = await request.json();

        if (!apiResponse.success) {
            console.error(apiResponse);
            return null;
        }

        const { response } = apiResponse;
        const batch = response.data ?? [];

        allData = [...allData, ...batch];
        allAccounts = [...allAccounts, ...(response.aggregationData?.accounts ?? [])];
        allGroups = [...allGroups, ...(response.aggregationData?.groups ?? [])];

        if (batch.length < BATCH_SIZE) {
            break;
        }

        offset += BATCH_SIZE;
        console.log('Getting message groups with offset', offset);
    }

    for (const groupMeta of allData)
    {
        const { groupId, partnerAccountId } = groupMeta;
        const accountMeta = allAccounts.find(x => x.id === partnerAccountId) || null;
        const messageMeta = allGroups.find(x => x.createdBy === partnerAccountId) || null;

        cachedMessageGroups[groupId] = {
            group: groupMeta,
            account: accountMeta,
            messageMeta,
        };
    }

    return { data: allData, aggregationData: { accounts: allAccounts, groups: allGroups } };
}

/**
 * Insert 'Download media' entry in the post dropdown
 */
async function handleSinglePost(dropdown, postId)
{
    const BUTTON_ID = 'fansly-dl-post-btn';
    if (dropdown.querySelector(`#${BUTTON_ID}`)) {
        return;
    }

    const btn = document.createElement('div');
    btn.classList.add('dropdown-item');
    btn.setAttribute('id', BUTTON_ID);
    btn.innerHTML = `<i class="${downloadIconClasses}"></i>Download media`;

    // Copy the Angular scoped-CSS attribute from a sibling item so the button
    // inherits the same styles as the other dropdown entries.
    const sibling = dropdown.querySelector('.dropdown-item');
    if (sibling) {
        const ngAttr = Array.from(sibling.attributes).find(a => a.name.startsWith('_ngcontent'));
        if (ngAttr) {
            btn.setAttribute(ngAttr.name, '');
        }
    }

    btn.addEventListener('click', async () => {
        await getPost(postId);
    });

    dropdown.insertAdjacentElement('beforeend', btn);
}

/**
 * Fetch messages and cache them during navigation.
 */
const cachedMessages = {};
const messageSyncSelector = '.fal.fa-arrows-rotate';
const messageUnreadSelector = '.fas.fa-circle.overlay.top.right.blue-1';

const MESSAGE_PAGE_SIZE = 50;//Let's stick to the default Fansly fetching, to avoid detection a tiny bit more.
const dedupeById = (arr) => [...new Map(arr.map(x => [x.id, x])).values()];

async function handleMessages(groupId, force)
{
    if (!force && cachedMessages[groupId]) {
        addDownloadMessageMediaButton();
        return;
    }

    if (Object.keys(cachedMessageGroups).length === 0) {
        fetchAllMessageGroups();
    }

    try {
        const url = `/message?groupId=${groupId}&limit=${MESSAGE_PAGE_SIZE}`;
        const request = await apiFetch(url);

        if (!request.ok) {
            console.error('[handleMessages] API failed:', request.status);
            return;
        }

        const data = await request.json();

        const messages = data?.response?.messages ?? [];

        cachedMessages[groupId] = {
            response: {
                ...data.response,
                messages,
                accountMedia: data.response?.accountMedia ?? [],
                accountMediaBundles: data.response?.accountMediaBundles ?? [],
            },
            beforeId: messages.length >= MESSAGE_PAGE_SIZE
                ? messages[messages.length - 1].id
                : null,
            hasMore: messages.length >= MESSAGE_PAGE_SIZE,
        };

        console.log('[handleMessages] cachedMessages set:', groupId, cachedMessages[groupId]);

        addDownloadMessageMediaButton();
    } catch (err) {
        console.error('[handleMessages] failed:', err);
    }
}

/**
 * Fetches the next page of messages for a group and merges them into the cache.
 * Returns true if there may be more pages, false if we've reached the end.
 */
async function fetchMoreMessages(groupId)
{
    const cached = cachedMessages[groupId];
    if (!cached?.hasMore) {
        return false;
    }

    const url = `/message?groupId=${groupId}&limit=${MESSAGE_PAGE_SIZE}&before=${cached.beforeId}`;
    const request = await apiFetch(url);
    const data = await request.json();

    const newMessages = data.response?.messages ?? [];
    const newMedia = data.response?.accountMedia ?? [];
    const newBundles = data.response?.accountMediaBundles ?? [];

    const allMessages = [...cached.response.messages, ...newMessages];
    const allMedia = dedupeById([...cached.response.accountMedia, ...newMedia]);
    const allBundles = dedupeById([...cached.response.accountMediaBundles, ...newBundles]);

    const hasMore = newMessages.length >= MESSAGE_PAGE_SIZE;

    cachedMessages[groupId] = {
        response: {
            ...cached.response,
            messages: allMessages,
            accountMedia: allMedia,
            accountMediaBundles: allBundles,
        },
        beforeId: hasMore ? newMessages[newMessages.length - 1].id : null,
        hasMore,
    };

    console.log(`fetchMoreMessages: fetched ${newMessages.length} more for group ${groupId}. hasMore=${hasMore}`);
    return hasMore;
}

async function getMessageMedia(groupId, messageId)
{
	if (!cachedMessageGroups[groupId]) {
		await fetchAllMessageGroups();
	}

	if (!cachedMessages[groupId]) {
		await handleMessages(groupId, true);
	}

    const cached = cachedMessages[groupId];
    const messages = cached.response.messages;
    const message = messages.find(x => x.id === messageId);

    if (!message) {
        console.error(`Could not find message ID ${messageId} for group ID ${groupId}`);
        return;
    }

    const creatorId = cachedMessageGroups[groupId]?.account?.id;
    if (creatorId && message.senderId !== creatorId) {
        return { medias: [], bundles: [], mediaCount: 0 };
    }

    const data = cached.response;
    let medias = [];
    let bundles = [];
    let mediaCount = 0;
    for (const attachment of message.attachments)
    {
        const { contentId, contentType } = attachment;

        let messageMedias = data.accountMedia.filter(x => x.id === contentId);

        /**
         * From what I know:
         * contentType = 1 = accountMedia
         * contentType = 2 = accountMediaBundle
         */
        if (contentType === 2) {
            const bundle = data.accountMediaBundles.find(x => x.id === contentId);
            if (!bundle) {
                continue;
            }

            const mediaIds = bundle.accountMediaIds;
            const accountMedias = data.accountMedia.filter(x => mediaIds.includes(x.id));

            messageMedias = [...messageMedias, ...accountMedias];
            bundles.push(bundle);
            // Use the bundle's declared ID list for the true count, as some
            // items may not yet be in the local cache (fetched lazily by filterMedia).
            mediaCount += mediaIds.length;
        } else {
            mediaCount += messageMedias.length;
        }

        medias = [...medias, ...messageMedias];
    }

    return {
        medias,
        bundles,
        mediaCount,
    };
}

/**
 * Adds download button in the message view
 */
function addDownloadMessageMediaButton()
{
    const sync = document.querySelector(messageSyncSelector);
    if (!sync) {
        console.log('Cannot find sync selector', messageSyncSelector);
        return;
    }

    const unread = document.querySelector(messageUnreadSelector);
    if (!unread) {
        console.log('Cannot find unread selector', messageUnreadSelector);
        return;
    }

    const parent = sync.parentElement;

	const parent2 = unread.parentElement.parentElement;

	const buttons = getDownloadMessageButtons();

	if (!buttons.iconButton) {
		const iconButton = createDownloadButton(
			'downloadMessageBundles',
			`<i _ngcontent-opw-c157="" class="${downloadIconClasses} blue-1"></i>`,
			openDownloadMessageModal
		);
		parent.insertAdjacentElement('afterend', iconButton);
	}

	if (!buttons.menuButton) {
		const menuButton = createDownloadButton(
			'downloadMessagesMenuButton',
			`<i _ngcontent-opw-c157="" class="${downloadIconClasses}"></i> Download Messages`,
			openDownloadMessageModal
		);
		menuButton.classList.add('dropdown-item');
		parent2.insertAdjacentElement('beforebegin', menuButton);
	}
}

/**
 * Helpers for getting the download media button (if they already exist)
 */
function getDownloadMessageButtons()
{
    return {
        iconButton: document.querySelector('#downloadMessageBundles'),
        menuButton: document.querySelector('#downloadMessagesMenuButton'),
    };
}

/**
 * Begin profile page handling
 *
 * TODO: This is very incomplete as of right now.
 */
async function fetchProfile(username)
{
    const response = await apiFetch(`/account?usernames=${username}`);
    const json = await response.json();

    if (!json.success || json.response.length < 1) {
        return;
    }

    const profile = json.response[0];
    const neighborButton = document.querySelector('.dm-profile') || document.querySelector('.tip-profile') || document.querySelector('.follow-profile');
    const relevantAttribute = getAngularAttribute(neighborButton);

    // Don't add another button
    const downloadButtonId = 'profile-dl';
    if (document.getElementById(downloadButtonId)) {
        return;
    }

    const downloadButton = document.createElement('div');
    downloadButton.setAttribute(relevantAttribute, '');
    downloadButton.setAttribute('class', 'dm-profile');
    downloadButton.setAttribute('id', downloadButtonId);
    downloadButton.innerHTML = `<i class="${downloadIconClasses}"></i>`;
    neighborButton.insertAdjacentElement('beforebegin', downloadButton);

    console.log('Profile', profile);
}

/**
 * Helpers for dealing with page load, page changing etc.
 */
function getCurrentUrlPaths()
{
    const url = new URL(window.location.href);
    const paths = url.pathname.split('/').slice(1);
    return paths;
}

const postDropdownSelector = 'div.feed-item-title > div.feed-item-actions.dropdown-trigger.more-dropdown > div.dropdown-list';

async function handleLoad()
{
    const paths = getCurrentUrlPaths();

    const root = paths[0] || '';
    const secondary = paths[1] || null;

    if (root === 'messages' && secondary) {
        await handleMessages(secondary);
    }

    if (root !== '' && secondary === 'posts') {
        // await fetchProfile(root);
    }
}

async function openDownloadMessageModal(button) {
	if (document.querySelector('#downloadModal')) return;
	button.setAttribute('disabled', '1');
	const groupId = getCurrentUrlPaths()[1] || null;

	if (!groupId) {
		button.removeAttribute('disabled');
		return;
	}

	const modalWrapper = document.querySelector('.modal-wrapper');
	if (!modalWrapper) {
		button.removeAttribute('disabled');
		return;
	}

	if (!cachedMessageGroups[groupId]) {
		await fetchAllMessageGroups();
	}

	const messageGroup = cachedMessageGroups[groupId];
	const { account } = messageGroup;

	/**
	 * Set certain modal classes to other elements
	 */
	const body = document.querySelector('body');
	const xdModal = modalWrapper.querySelector('.xdModal');
	xdModal.classList.add('back-drop');
	body.classList.add('modal-opened');

	/**
	 * Add the modal to the page and allow for functionality.
	 */
	const username = account.username;
	const displayName = account.displayName || username;
	const modal = `<div class="active-modal" id="downloadModal">
						<div class="modal">
							<div class="modal-header">
								<div class="title flex-1">
									<p>Download media message from ${displayName} (@${username})</p>
								</div>
								<div class="actions"><i class="fa-fw fa fa-times pointer blue-1-hover-only hover-effect"></i></div>
							</div>
							<div class="modal-content">
								<p class="introduction">Select the message you want to grab the media from:</p>
								<p class="introduction" id="messageStatsText" style="margin-top: 0.5em;"></p>
								<select><option value="">-- No selection --</option></select>
								<div class="btn large outline-dark-blue" style="margin-top: 1em;" id="loadMoreMessagesButton">Load more messages</div>
								<div style="margin-top: 0.75em; align-self: center;">
									<label style="cursor: pointer; user-select: none;">
										<input type="checkbox" id="loadAllMessagesCheckbox" style="margin-right: 0.4em;">
										Load complete message history (use with caution)
									</label>
								</div>
								<div class="btn large outline-dark-blue disabled" style="margin-top: 1.5em;" id="downloadModalButton" disabled="1"><i class="${downloadIconClasses}"></i> Download! <span></span></div>
								<div class="btn large outline-dark-blue" style="margin-top: 1.5em;" id="downloadMessagesButton"><i class="${downloadIconClasses}"></i> Download Messages! <span></span></div>

								<div style="margin-top: 1.5em;" class="introduction">
									The file count shown on the download button assumes that the message media is unlocked for you.
									<br />
									It may be inaccurate if it is a PPV that hasn't been purchased yet. Messages with 0 media are not listed.
								</div>

								<div style="margin-top: 1.5em;" class="introduction">
									If you wish to download message media from another creator, close this modal and select their message thread.
									<br />
									A new download icon should show up above the thread list, click it.
								</div>
							</div>
						</div>
				</div>`;

	modalWrapper.insertAdjacentHTML('beforeend', modal);

	// Get the modal element after adding it, so that we can add event listeners
	const modalElem = document.querySelector('#downloadModal');

	/**
	 * Handle selection and download
	 */
	const selectElem = modalElem.querySelector('select');
	const messageStatsText = modalElem.querySelector('#messageStatsText');
	const loadMoreButton = modalElem.querySelector('#loadMoreMessagesButton');
	const loadAllCheckbox = modalElem.querySelector('#loadAllMessagesCheckbox');
	const loadAllCheckboxWrapper = loadAllCheckbox.closest('div');
	const downloadButton = modalElem.querySelector('#downloadModalButton');
	const downloadMessagesButton = modalElem.querySelector('#downloadMessagesButton');
	const downloadCount = downloadButton.querySelector('span');
	const downloadIcons = downloadButton.querySelector('.fal');

	function disableDownload()
	{
		downloadButton.setAttribute('disabled', '1');
		downloadButton.classList.add('disabled');
	}

	function enableDownload()
	{
		downloadButton.removeAttribute('disabled');
		downloadButton.classList.remove('disabled');
	}

	let statsTotalMessages = 0;
	let statsMessagesWithMedia = 0;
	let statsTotalMediaCount = 0;

	function updateStats()
	{
		messageStatsText.textContent = `Fetched ${statsTotalMessages} messages — ${statsMessagesWithMedia} with media (${statsTotalMediaCount} files total)`;
	}

	async function appendMessageOptions(messages)
	{
		statsTotalMessages += messages.length;
		for (const message of messages)
		{
			const messageMedia = await getMessageMedia(groupId, message.id);
			if (messageMedia.medias.length === 0) {
				continue;
			}

			statsMessagesWithMedia++;
			statsTotalMediaCount += messageMedia.mediaCount;

			const option = document.createElement('option');
			const date = new Date(message.createdAt * 1000);
			const text = message.content.trim();
			option.textContent = `${date.toLocaleString()} | ${text.length > 83 ? text.slice(0, 80) : text}${text.length > 83 ? '...' : ''}`;
			option.setAttribute('value', message.id);
			selectElem.appendChild(option);
		}
		updateStats();
	}

	function waitForCachedMessages(groupId, timeout = 10000)
	{
		return new Promise((resolve, reject) => {
			const start = Date.now();

			const interval = setInterval(() => {
				if (cachedMessages[groupId]) {
					clearInterval(interval);
					resolve(cachedMessages[groupId]);
				}

				if (Date.now() - start > timeout) {
					clearInterval(interval);
					reject(new Error('Timed out waiting for cachedMessages'));
				}
			}, 50);
		});
	}

	console.log('groupId', groupId);
	console.log('cachedMessages', cachedMessages);
	console.log('cachedMessages[groupId]', cachedMessages[groupId]);
	// Populate the select with the initially-fetched messages.
	if (!cachedMessages[groupId]) {
		await handleMessages(groupId, true);
	}

	const cached = await waitForCachedMessages(groupId);
	await appendMessageOptions(cached.response.messages);

	if (!cachedMessages[groupId].hasMore) {
		loadMoreButton.style.display = 'none';
		loadAllCheckboxWrapper.remove();
	}

	loadAllCheckbox.addEventListener('change', function() {
		loadMoreButton.textContent = loadAllCheckbox.checked ? 'Load all messages' : 'Load more messages';
	});

	loadMoreButton.addEventListener('click', async function() {
		loadMoreButton.textContent = 'Loading...';
		loadMoreButton.classList.add('disabled');
		loadAllCheckbox.disabled = true;

		let hasMore;
		do {
			const previousCount = cachedMessages[groupId].response.messages.length;
			hasMore = await fetchMoreMessages(groupId);
			const newMessages = cachedMessages[groupId].response.messages.slice(previousCount);
			await appendMessageOptions(newMessages);
		} while (hasMore && loadAllCheckbox.checked);

		if (!hasMore) {
			loadMoreButton.style.display = 'none';
			loadAllCheckboxWrapper.remove();
		} else {
			loadMoreButton.textContent = loadAllCheckbox.checked ? 'Load all messages' : 'Load more messages';
			loadMoreButton.classList.remove('disabled');
			loadAllCheckbox.disabled = false;
		}
	});

	selectElem.addEventListener('change', async function(ev) {
		const selectedMessageId = selectElem.value;
		if (!selectedMessageId) {
			disableDownload();
			downloadCount.textContent = '';
			return;
		}

		const messageMedia = await getMessageMedia(groupId, selectedMessageId);
		enableDownload();
		downloadCount.textContent = `(${messageMedia.mediaCount} files)`;
	});

	downloadButton.addEventListener('click', async function() {
		if (downloadButton.hasAttribute('disabled')) {
			return;
		}

		const selectedMessageId = selectElem.value;

		console.log('Group ID', groupId, 'Selected Message ID', selectedMessageId);
		const { bundles, medias } = await getMessageMedia(groupId, selectedMessageId);

		// Disable the button and add spinner
		disableDownload();
		downloadIcons.classList.add('fa-circle-notch');
		downloadIcons.classList.add('fa-spin');
		downloadIcons.classList.remove('fa-download');

		// Since `filterMedia` just triggers downloads in the background, we're just adding a small delay before re-enabling the button.
		setTimeout(() => {
			enableDownload();
			downloadIcons.classList.remove('fa-circle-notch');
			downloadIcons.classList.remove('fa-spin');
			downloadIcons.classList.add('fa-download');
		}, 1500);

		const parameter = {
			response: {
				accountMediaBundles: bundles,
				accountMedia: medias,
			},
		};

		filterMedia(parameter);
	});

	downloadMessagesButton.addEventListener('click', async function() {
		console.log('Group ID', groupId);
		downloadMessages(cachedMessages[groupId].response,groupId);
	});

	/**
	 * Add handlers for closing the modal.
	 */
	const closeButton = modalElem.querySelector('.fa-times');
	function removeModal() {
		modalElem.remove();
		xdModal.classList.remove('back-drop');
		body.classList.remove('modal-opened');
	}

	closeButton.addEventListener('click', removeModal);
	xdModal.addEventListener('click', removeModal);
	button.removeAttribute('disabled');
}

function createDownloadButton(id, html, clickHandler)
{
    const button = document.createElement('div');
    button.innerHTML = html;
    button.setAttribute('id', id);

    button.addEventListener('click', function() {
        clickHandler(button);
    });

    return button;
}

let oldUrl = location.href;
let observerTimeout;

function handleDomChanges()
{
    const paths = getCurrentUrlPaths();

    // Ignore irrelevant pages entirely
    if (
        paths[0] !== 'messages' &&
        paths[0] !== 'post'
    ) {
        return;
    }

    const newUrl = location.href;

    // SPA navigation detection
    if (newUrl !== oldUrl) {
        oldUrl = newUrl;

        const buttons = getDownloadMessageButtons();

        if (buttons.iconButton) {
            buttons.iconButton.remove();
        }

        if (buttons.menuButton) {
            buttons.menuButton.remove();
        }

        handleLoad();
    }

    if (paths[0] === 'post' && paths[1]) {
        const dropdown = document.querySelector(postDropdownSelector);

        if (dropdown) {
            handleSinglePost(dropdown, paths[1]);
        }
    }

    // Handle message buttons
    if (paths[0] === 'messages' && paths[1]) {
        addDownloadMessageMediaButton();
    }
}

function scheduleDomHandling()
{
    clearTimeout(observerTimeout);

    observerTimeout = setTimeout(() => {
        handleDomChanges();
    }, 50);
}

function initObserver()
{
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.addedNodes.length > 0) {
				scheduleDomHandling();
				return;
			}
		}
	});
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    // Initial load
    scheduleDomHandling();
}

initObserver();

function downloadMessages(messages, groupId)
{
    const exportData = structuredClone(messages);

    exportData.groupId = groupId;
    exportData.userId = cachedMessageGroups[groupId]?.group?.account_id ?? null;
    exportData.creatorId = cachedMessageGroups[groupId]?.group?.partnerAccountId ?? null;

    exportData.messages.sort((a, b) =>
        String(a.id).localeCompare(String(b.id))
    );

    exportData.accountMedia.sort((a, b) =>
        String(a.id).localeCompare(String(b.id))
    );

    exportData.accountMediaBundles.sort((a, b) =>
        String(a.id).localeCompare(String(b.id))
    );

    exportData.accountMedia.forEach(entry => {
        if (entry?.media?.variants) delete entry.media.variants;
        if (entry?.preview?.variants) delete entry.preview.variants;
    });

    const content = JSON.stringify(messages, null, 2);

	//Output must be JSON in a Javascript file so it can be loaded be a local reader HTML
    const blob = new Blob([content], {
        type: 'text/javascript'
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'messageData.js';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
}
