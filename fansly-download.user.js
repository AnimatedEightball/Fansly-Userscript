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
// @downloadURL https://github.com/AnimatedEightball/Fansly-Userscript/raw/refs/heads/main/fansly-download.user.js
// @updateURL   https://github.com/AnimatedEightball/Fansly-Userscript/raw/refs/heads/main/fansly-download.user.js
// @homepageURL https://github.com/AnimatedEightball/Fansly-Userscript/
// @icon        https://m.leak.fans/ujs/fansly-icon.png
// @version     0.9.7a
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
 * Toggled via the Violentmonkey context menu.
 */
let scriptDownload = GM_getValue('SCRIPT_DOWNLOAD', false);

/**
 * When enabled, HLS playlists are converted to MP4 in-browser via MediaBunny.
 *
 * MediaBunny selects the highest-quality HLS video variant and attempts
 * to preserve the original encoded video/audio streams where possible.
 *
 * Disable on lower-end devices to fall back to direct download
 * (lower quality static file).
 *
 * Toggled via the Violentmonkey context menu.
 */

let m3u8Download = GM_getValue('M3U8_DOWNLOAD', true);

const MEDIA_BUNNY_URL =
    'https://cdn.jsdelivr.net/npm/mediabunny@1.58.0/+esm';

const mediaBunnyPromise = import(MEDIA_BUNNY_URL);

// Files below 100 MiB use BufferTarget; 100 MiB and above use StreamTarget.
const BUFFER_TARGET_MAX_BYTES = 100 * 1024 * 1024;

const IMAGE_DOWNLOAD_CONCURRENCY = 10;

let m3u8MenuCommandId = null;
let scriptMenuCommandId = null;

const DEBUG = false;

function debugLog(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

function debugWarn(...args) {
    if (DEBUG) {
        console.warn(...args);
    }
}

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
	
   if (scriptMenuCommandId !== null) {
        GM_unregisterMenuCommand(scriptMenuCommandId);
    }

    scriptMenuCommandId = GM_registerMenuCommand(
        `Download Scripts for external downloads: ${scriptDownload ? 'ON' : 'OFF'}`,
        function() {
            scriptDownload = !scriptDownload;
            console.log(`Download Scripts for external downloads ${scriptDownload}`);
            GM_setValue('SCRIPT_DOWNLOAD', scriptDownload);
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
 * For Fansly HLS, the audio is normally muxed into the media playlist's
 * MPEG-TS segments. The master playlist may nevertheless advertise
 * separate AUDIO renditions which are invalid/unusable.
 *
 * @param {Object} media
 * @returns {{ url: String, cookies: Object, duration: Number|null }|null}
 */
function getM3u8Info(media)
{
    const { variants } = media;

    // Type 302 = HLS (application/vnd.apple.mpegurl)
    const playlist = variants?.find(file => file.type === 302);

    if (!playlist || !playlist.locations || playlist.locations.length === 0) {
        return null;
    }

    const location = playlist.locations[0];

    let metadata = null;

    try {
        metadata = playlist.metadata
            ? JSON.parse(playlist.metadata)
            : null;
    } catch (error) {
        debugWarn(
            '[MediaBunny] Could not parse HLS metadata:',
            playlist.metadata,
            error
        );
    }

    return {
        url: location.location,
        cookies: location.metadata,
        duration: metadata?.duration ?? null,
    };
}

function getVideoDownloadCommand(media, filename)
{
    const info = getM3u8Info(media);
    if (!info) {
        return null;
    }

    const { url, cookies} = info;
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `CloudFront-${k}=${v}`).join('; ');

/* 
 if (asCurl) {
        return `curl -L -o "${filename}" -H "Origin: https://fansly.com" -H "Referer: https://fansly.com/" -H "Cookie: ${cookieHeader}" "${url}"`;
    }
*/
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
 * Resolve a Fansly HLS master playlist to the highest-resolution
 * muxed media playlist.
 *
 * Fansly may advertise separate AUDIO renditions at the master level
 * even when the selected media playlist already contains both video
 * and audio. We therefore select the media playlist directly and let
 * MediaBunny handle the contained tracks.
 *
 * @param {String} masterUrl HLS master playlist URL.
 * @param {Object} cookies CloudFront cookie values without the prefix.
 * @returns {Promise<{url: String, averageBandwidth: Number|null}>}
 */
async function resolveMuxedMediaPlaylist(masterUrl, cookies)
{
    const cookieHeader = Object.entries(cookies || {})
        .map(([key, value]) => `CloudFront-${key}=${value}`)
        .join('; ');

    const response = await gmFetch(
        masterUrl,
        {
            'Origin': 'https://fansly.com',
            'Referer': 'https://fansly.com/',
            'Cookie': cookieHeader,
        },
        'text'
    );

    if (response.status < 200 || response.status >= 300) {
        throw new Error(
            `Failed to fetch HLS master playlist: HTTP ${response.status}`
        );
    }

    const text = response.responseText;

    const lines = text
        .split(/\r?\n/)
        .map(line => line.trim());

    const variants = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (!line.startsWith('#EXT-X-STREAM-INF:')) {
            continue;
        }

        const attributes = line.slice('#EXT-X-STREAM-INF:'.length);

        const resolutionMatch =
            attributes.match(/(?:^|,)RESOLUTION=(\d+)x(\d+)/);

        const bandwidthMatch =
            attributes.match(/(?:^|,)AVERAGE-BANDWIDTH=(\d+)/);

        const bandwidthFallbackMatch =
            attributes.match(/(?:^|,)BANDWIDTH=(\d+)/);

        let playlistUrl = null;

        for (let j = i + 1; j < lines.length; j++) {
            if (!lines[j]) {
                continue;
            }

            if (!lines[j].startsWith('#')) {
                playlistUrl = new URL(lines[j], masterUrl).href;
                break;
            }
        }

        if (!playlistUrl) {
            continue;
        }

        variants.push({
            url: playlistUrl,
            width: resolutionMatch
                ? parseInt(resolutionMatch[1], 10)
                : 0,
            height: resolutionMatch
                ? parseInt(resolutionMatch[2], 10)
                : 0,
            bandwidth: bandwidthMatch
                ? parseInt(bandwidthMatch[1], 10)
                : bandwidthFallbackMatch
                    ? parseInt(bandwidthFallbackMatch[1], 10)
                    : 0,
        });
    }

    if (variants.length === 0) {
        throw new Error(
            'No HLS media playlists found in master playlist.'
        );
    }

    variants.sort((a, b) => {
        if (b.height !== a.height) {
            return b.height - a.height;
        }

        return b.bandwidth - a.bandwidth;
    });

    const selected = variants[0];
	
    debugLog(
        '[MediaBunny] Resolved muxed HLS media playlist:',
        selected
    );

    return {
        url: selected.url,
        averageBandwidth: selected.bandwidth || null,
    };

}

/**
 * Download an authenticated Fansly HLS stream as MP4 using MediaBunny.
 *
 * MediaBunny handles:
 *   - HLS master/media playlist parsing
 *   - variant/track selection
 *   - MPEG-TS/fMP4 demuxing
 *   - MP4 muxing
 *   - transmuxing/copying where possible
 *
 * GM_xmlhttpRequest is used as MediaBunny's fetchFn because Fansly's
 * CloudFront resources require authentication metadata that should not
 * be exposed to ordinary cross-origin browser fetches.
 *
 * @param {String} m3u8Url
 * @param {Object} cookies CloudFront metadata without the prefix.
 * @param {String} filename Filename without extension.
 */
async function downloadM3u8AsMP4(
    m3u8Url,
    cookies,
    filename,
    fanslyDuration
) {
    const {
			Input,
			UrlSource,
			HLS_FORMATS,
			BufferSource,
			ReadableStreamSource,
			MPEG_TS,
			Output,
			Mp4OutputFormat,
			BufferTarget,
			StreamTarget,
			Conversion,
	} = await mediaBunnyPromise;

    const cookieHeader = Object.entries(cookies || {})
        .map(([key, value]) => `CloudFront-${key}=${value}`)
        .join('; ');

    const commonHeaders = {
        'Origin': 'https://fansly.com',
        'Referer': 'https://fansly.com/',
        'Cookie': cookieHeader,
    };

    /**
     * Convert GM_xmlhttpRequest's raw response headers into a
     * standard Headers object.
     */
    function parseResponseHeaders(rawHeaders) {
        const headers = new Headers();

        if (!rawHeaders) {
            return headers;
        }

        for (const line of rawHeaders.split(/\r?\n/)) {
            const separator = line.indexOf(':');

            if (separator === -1) {
                continue;
            }

            const name = line.slice(0, separator).trim();
            const value = line.slice(separator + 1).trim();

            if (name) {
                headers.set(name, value);
            }
        }

        return headers;
    }

    /**
     * Fetch implementation supplied to MediaBunny.
     *
     * UrlSource can accept a custom fetch function. This lets the
     * HLS parser continue to use MediaBunny's normal URL/range/
     * prefetch machinery while every actual HTTP request goes
     * through GM_xmlhttpRequest.
     */
    function authenticatedFetch(input, init = {}) {
        let url;

        if (typeof input === 'string') {
            url = input;
        } else if (input instanceof URL) {
            url = input.href;
        } else if (input instanceof Request) {
            url = input.url;
        } else {
            url = String(input);
        }

        const requestHeaders = {
            ...commonHeaders,
        };

        /*
         * Copy headers supplied by MediaBunny/requestInit.
         */
        if (init.headers) {
            const suppliedHeaders = new Headers(init.headers);

            suppliedHeaders.forEach((value, key) => {
                requestHeaders[key] = value;
            });
        }

        /*
         * A Request passed to fetchFn can also contain headers.
         */
        if (input instanceof Request) {
            input.headers.forEach((value, key) => {
                requestHeaders[key] = value;
            });
        }

        /*
         * GM_xmlhttpRequest doesn't directly use AbortSignal in all
         * Violentmonkey versions, so keep a reference to the request
         * and connect AbortSignal when possible.
         */
        return new Promise((resolve, reject) => {
            let settled = false;

            const finishReject = error => {
                if (settled) {
                    return;
                }

                settled = true;
                reject(error);
            };

            const finishResolve = response => {
                if (settled) {
                    return;
                }

                settled = true;
                resolve(response);
            };

            const request = GM_xmlhttpRequest({
                method: init.method || 'GET',
                url,
                headers: requestHeaders,
                responseType: 'arraybuffer',

				onload: response => {

					if (response.status === 429) {
						debugWarn(
							'[MediaBunny HTTP] 429 RATE LIMITED',
							url,
							response.responseHeaders
						);
					} else if (response.status >= 400) {
						debugWarn(
							'[MediaBunny HTTP] HTTP ERROR',
							response.status,
							url,
							response.responseHeaders
						);
					}

					const body = response.response instanceof ArrayBuffer
						? response.response
						: new ArrayBuffer(0);

					finishResolve(
                        new Response(body, {
                            status: response.status,
                            statusText: response.statusText,
                            headers: parseResponseHeaders(
                                response.responseHeaders
                            ),
                        })
                    );
                },

				onerror: () => {

					finishReject(

                        new TypeError(
                            `Network error while fetching ${url}`
                        )
                    );
                },

				ontimeout: () => {
					debugWarn(
						'[MediaBunny HTTP] TIMEOUT',
						url
					);
                    finishReject(
                        new TypeError(
                            `Timeout while fetching ${url}`
                        )
                    );
                },

                onabort: () => {
                    finishReject(
                        new DOMException(
                            'The request was aborted.',
                            'AbortError'
                        )
                    );
                },
            });

            /*
             * Connect MediaBunny's AbortSignal to the GM request.
             */
            if (init.signal) {
                if (init.signal.aborted) {
                    request.abort();
                    return;
                }

                init.signal.addEventListener(
                    'abort',
                    () => {
                        try {
                            request.abort();
                        } catch {
                            // Ignore abort cleanup failures.
                        }
                    },
                    { once: true }
                );
            }
        });
    }

    debugLog(
        `[MediaBunny] Loading HLS master playlist: ${m3u8Url}`
    );

    /*
     * Fansly's master playlist can advertise external AUDIO renditions
     * which are invalid, while the selected media playlist itself
     * contains multiplexed H.264 + AAC MPEG-TS segments.
     *
     * Resolve the video variant ourselves and give MediaBunny the
     * media playlist directly. This prevents the HLS layer from
     * selecting the invalid external audio playlists.
     */
    const resolvedPlaylist = await resolveMuxedMediaPlaylist(
        m3u8Url,
        cookies
    );

    const mediaPlaylistUrl = resolvedPlaylist.url;
    const masterAverageBandwidth =
        resolvedPlaylist.averageBandwidth;

    debugLog(
        `[MediaBunny] Using muxed media playlist: ${mediaPlaylistUrl}`
    );

    debugLog(
        '[MediaBunny] Master playlist average bandwidth:',
        masterAverageBandwidth
            ? `${(masterAverageBandwidth / 1000).toFixed(0)} kbps`
            : 'unknown'
    );

    const source = new UrlSource(mediaPlaylistUrl, {


        fetchFn: authenticatedFetch,

        parallelism: 6,

        getRetryDelay: previousAttempts => {
            /*
             * Exponential retry delay, capped at 30 seconds.
             */
            return Math.min(
                2 ** previousAttempts,
                30
            );
        },
    });

    const input = new Input({
        source,
        formats: HLS_FORMATS,
    });

	/*
	 * The HLS variant was selected above, so this playlist should contain
	 * the desired video track. MediaBunny handles the demuxing and conversion.
	 */
	const videoTracks = await input.getVideoTracks();

	if (!videoTracks.length) {
		throw new Error(
			'MediaBunny found no video tracks in the HLS playlist.'
		);
	}

	const videoTrack = videoTracks[0];


    const averageBitrate =
        masterAverageBandwidth ??
        await videoTrack.getAverageBitrate();

		
	const duration =
		fanslyDuration ?? await videoTrack.getDurationFromMetadata();

	const estimatedBytes =
		averageBitrate && Number.isFinite(duration)
			? (averageBitrate * duration) / 8
			: null;

	const useBufferTarget =
		estimatedBytes !== null &&
		estimatedBytes < BUFFER_TARGET_MAX_BYTES;

	let target;
	let fileHandle = null;
	let opfsRoot = null;
	let opfsFilename = null;

	if (useBufferTarget) {
		target = new BufferTarget();

	} else {
		if (!navigator.storage?.getDirectory) {
			throw new Error(
				'OPFS is not available in this browser; cannot use StreamTarget for this file.'
			);
		}

		opfsRoot =
			await navigator.storage.getDirectory();

		opfsFilename =
			`fansly-mediabunny-${Date.now()}.mp4`;

		fileHandle = await opfsRoot.getFileHandle(
			opfsFilename,
			{
				create: true,
			}
		);

		const writable = await fileHandle.createWritable();

		target = new StreamTarget(writable, {
			chunked: true,
			chunkSize: 16 * 1024 * 1024,
		});

	}



    const output = new Output({
        format: new Mp4OutputFormat(),
        target,
    });

	output._muxer.creationTime = 0;
	
	/*
	 * The selected HLS variant is already muxed, so retain its audio track
	 * and discard only video tracks that are not the selected variant.
	 */
    const conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        copy: {
            mode: 'preferred',
        },
        video: track => {
            if (track !== videoTrack) {
                return {
                    discard: true,
                };
            }

            return {};
        },
		tags: {},
    });

    if (!conversion.isValid) {
        const discarded = conversion.discardedTracks
            .map(item => {
                return `${String(item.track)}: ${item.reason}`;
            })
            .join('\n');

        throw new Error(
            `MediaBunny conversion is invalid.\n\n` +
            `Discarded tracks:\n${discarded || '(none)'}`
        );
    }

		debugLog(
			`[MediaBunny] Converting ${filename}.mp4`
		);

		let lastLoggedPercent = -1;

		conversion.onProgress = progress => {
			const percent = Math.floor(progress * 100);

			/*
			 * Only log every 5%.
			 *
			 * This keeps the console useful without generating hundreds
			 * of messages during a large conversion.
			 */
			if (percent >= lastLoggedPercent + 5 || percent === 100) {
				lastLoggedPercent = percent;

				console.log(
					`[MediaBunny] ${percent}%`
				);
			}
		};

		try {
			await conversion.execute();

			if (useBufferTarget) {
				/*
				 * BufferTarget contains the completed MP4.
				 */
				const buffer = target.buffer;

				if (!buffer) {
					throw new Error(
						'MediaBunny completed conversion but produced ' +
						'no output buffer.'
					);
				}

				const file = new File(
					[buffer],
					`${filename}.mp4`,
					{
						type: 'video/mp4',
					}
				);

				const blobUrl = URL.createObjectURL(file);

				const link = document.createElement('a');

				link.href = blobUrl;
				link.download = `${filename}.mp4`;
				link.style.display = 'none';

				document.body.appendChild(link);
				link.click();
				link.remove();

				setTimeout(() => {
					URL.revokeObjectURL(blobUrl);
				}, 60_000);

				console.log(
					`[MediaBunny] Finished ${filename}.mp4 ` +
					`(${(buffer.byteLength / 1024 / 1024).toFixed(2)} MiB)`
				);

			} else {
				/*
				 * StreamTarget has written the completed MP4 to OPFS.
				 */

				const opfsFile = await fileHandle.getFile();

				console.log(
					`[MediaBunny] Finished ${filename}.mp4 ` +
					`(${(opfsFile.size / 1024 / 1024).toFixed(2)} MiB)`
				);

				const blobUrl = URL.createObjectURL(opfsFile);

				const link = document.createElement('a');

				link.href = blobUrl;
				link.download = `${filename}.mp4`;
				link.style.display = 'none';

				document.body.appendChild(link);
				link.click();
				link.remove();

				setTimeout(async () => {
					URL.revokeObjectURL(blobUrl);
					await cleanupOpfsFile(opfsRoot, opfsFilename);
				}, 60_000);
				
			}

        /*
         * Dispose the input so UrlSource can stop outstanding requests.
         */
        } finally {
			try {
				input.dispose();
			} catch {
				// Ignore disposal errors.
			}
	}
}

/**
 * Live HLS capture helper.
 *
 * Initial version:
 * - Discovers the current live stream through the Fansly API.
 * - Resolves the master HLS playlist.
 * - Selects the highest-quality video variant.
 * - Polls the live variant playlist.
 * - Reports newly discovered segments.
 *
 * No media is downloaded yet.
 */
const liveCapture = (() => {
    let running = false;
    let timer = null;

    let accountId = null;
    let streamId = null;
    let historyId = null;

    let masterUrl = null;
    let variantUrl = null;

    let lastMediaSequence = null;
    const seenSegments = new Set();
	
	let liveStreamWriter = null;
	let liveConversionPromise = null;
	let liveInput = null;
	

	const pendingSegmentDownloads = new Set();
	const pendingSegments = new Map();

	let nextSegmentSequence = null;
	let segmentWriteChain = Promise.resolve();
	
	const TEST_CAPTURE_DURATION = 60;

	let captureStarted = false;
	let capturedDuration = 0;
	
    /**
     * Fetch the current live-stream information for an account.
     *
     * @param {String} id Fansly account ID
     * @returns {Object|null}
     */
	async function getStreamInfo(id)
	{
		const response = await apiFetch(
			`/streaming/channel/${id}?ngsw-bypass=true`
		);

		const data = await response.json();

		console.log(
			'[LiveCapture] /streaming/channel response:',
			data
		);

		if (!data.success || !data.response) {
			throw new Error(
				'Fansly returned an invalid live-stream response.'
			);
		}

		return data.response;
	}

    /**
     * Select the highest-quality video variant from a master playlist.
     *
     * @param {String} url Master playlist URL
     * @returns {String} Variant playlist URL
     */
    async function resolveVariant(url)
    {
		console.log(
			'[LiveCapture] Fetching master playlist...'
		);

		const text = await fetchLivePlaylist(url);

		console.log(
			'[LiveCapture] Master playlist fetched:',
			text.length,
			'bytes'
		);

		const lines = text
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(Boolean);

        const variants = [];

        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) {
                continue;
            }

            const attributes = lines[i]
                .substring('#EXT-X-STREAM-INF:'.length);

            const bandwidthMatch =
                attributes.match(/(?:^|,)BANDWIDTH=(\d+)/);

            const resolutionMatch =
                attributes.match(/(?:^|,)RESOLUTION=(\d+)x(\d+)/);

            const bandwidth = bandwidthMatch
                ? Number(bandwidthMatch[1])
                : 0;

            const height = resolutionMatch
                ? Number(resolutionMatch[2])
                : 0;

            const variantLine = lines[i + 1];

            if (!variantLine || variantLine.startsWith('#')) {
                continue;
            }

            variants.push({
                url: new URL(variantLine, url).href,
                bandwidth,
                height,
            });
        }

        if (variants.length === 0) {
            throw new Error(
                'No video variants were found in the master playlist.'
            );
        }

        variants.sort((a, b) => {
            if (a.height !== b.height) {
                return b.height - a.height;
            }

            return b.bandwidth - a.bandwidth;
        });

        const selected = variants[0];

        console.log(
            `[LiveCapture] Selected ${selected.height}p ` +
            `(${selected.bandwidth} bps)`
        );

        return selected.url;
    }

    /**
     * Poll the selected live variant playlist.
     */
    async function poll()
    {
        if (!running) {
            return;
        }

        try {
            const text = await fetchLivePlaylist(variantUrl);

            const lines = text
                .split(/\r?\n/)
                .map(line => line.trim());

            let mediaSequence = null;
            let currentSegment = null;
            let segmentCount = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                    mediaSequence = Number(
                        line.substring('#EXT-X-MEDIA-SEQUENCE:'.length)
                    );
                    continue;
                }

                if (line.startsWith('#EXTINF:')) {
                    const durationText = line
                        .substring('#EXTINF:'.length)
                        .split(',')[0];

                    currentSegment = {
                        duration: Number(durationText),
                    };

                    continue;
                }

                if (
                    currentSegment &&
                    line &&
                    !line.startsWith('#')
                ) {
                    currentSegment.url =
                        new URL(line, variantUrl).href;

                    currentSegment.sequence =
                        mediaSequence + segmentCount;

                    const key =
                        String(currentSegment.sequence);

					if (!seenSegments.has(key)) {
						seenSegments.add(key);

						console.log(
							`[LiveCapture] New segment ` +
							`#${currentSegment.sequence} ` +
							`(${currentSegment.duration}s)`
						);

						if (captureStarted) {
							downloadSegment(currentSegment);

							capturedDuration += currentSegment.duration;

							console.log(
								`[LiveCapture] Capture progress: ` +
								`${capturedDuration.toFixed(1)} / ` +
								`${TEST_CAPTURE_DURATION}s`
							);

							if (capturedDuration >= TEST_CAPTURE_DURATION) {
								console.log(
									`[LiveCapture] Reached test capture duration ` +
									`of ${TEST_CAPTURE_DURATION}s.`
								);

								stop();
							}
						}
					}
                    segmentCount++;
                    currentSegment = null;
                }
            }

            if (mediaSequence !== null) {
                if (lastMediaSequence !== null) {
                    const difference =
                        mediaSequence - lastMediaSequence;

                    if (difference > 0) {
                        console.log(
                            `[LiveCapture] Playlist advanced ` +
                            `by ${difference} segment(s): ` +
                            `${lastMediaSequence} → ${mediaSequence}`
                        );
                    }
                }

                lastMediaSequence = mediaSequence;
            }

            if (text.includes('#EXT-X-ENDLIST')) {
                console.log(
                    '[LiveCapture] Stream playlist ended.'
                );

                stop();
                return;
            }

        } catch (error) {
            console.error(
                '[LiveCapture] Playlist polling failed:',
                error
            );
        }

		if (!captureStarted) {
			captureStarted = true;

			console.log(
				'[LiveCapture] Initial playlist established. ' +
				'Beginning live segment capture.'
			);
		}

        if (running) {
            timer = setTimeout(poll, 5000);
        }
    }
	
	async function finalizeCapture()
	{
		if (!capturedSegments.length) {
			console.warn(
				'[LiveCapture] No captured segments to finalize.'
			);
			return;
		}

		console.log(
			`[LiveCapture] Waiting for ` +
			`${pendingSegmentDownloads.size} pending segment download(s)...`
		);

		await Promise.allSettled(
			[...pendingSegmentDownloads]
		);

		if (!capturedSegments.length) {
			console.warn(
				'[LiveCapture] No segments were successfully captured.'
			);
			return;
		}

		capturedSegments.sort(
			(a, b) => a.sequence - b.sequence
		);

		console.log(
			`[LiveCapture] Finalizing ${capturedSegments.length} ` +
			`MPEG-TS segment(s) with MediaBunny.`
		);

		const totalBytes = capturedSegments.reduce(
			(total, segment) =>
				total + segment.buffer.byteLength,
			0
		);

		console.log(
			`[LiveCapture] Captured size: ` +
			`${(totalBytes / 1024 / 1024).toFixed(2)} MiB`
		);

		/*
		 * Concatenate the MPEG-TS segments into one contiguous
		 * ArrayBuffer.
		 */
		const combined = new Uint8Array(totalBytes);

		let offset = 0;

		for (const segment of capturedSegments) {
			const bytes = new Uint8Array(segment.buffer);

			combined.set(bytes, offset);
			offset += bytes.byteLength;
		}

		const {
			Input,
			MPEG_TS,
			BufferSource,
			Output,
			Mp4OutputFormat,
			BufferTarget,
			Conversion,
		} = await mediaBunnyPromise;

		const source = new BufferSource(combined);

		const input = new Input({
			source,
			formats: [MPEG_TS],
		});

		try {
			const videoTracks =
				await input.getVideoTracks();

			if (!videoTracks.length) {
				throw new Error(
					'MediaBunny found no video tracks in the captured MPEG-TS data.'
				);
			}

			const videoTrack = videoTracks[0];

			const duration =
				await videoTrack.getDurationFromMetadata();

			console.log(
				`[LiveCapture] MediaBunny detected duration: ` +
				`${Number.isFinite(duration)
					? duration.toFixed(2)
					: 'unknown'}s`
			);

			const target = new BufferTarget();

			const output = new Output({
				format: new Mp4OutputFormat(),
				target,
			});

			output._muxer.creationTime = 0;

			const conversion = await Conversion.init({
				input,
				output,

				tracks: 'primary',

				copy: {
					mode: 'preferred',
				},

				video: track => {
					if (track !== videoTrack) {
						return {
							discard: true,
						};
					}

					return {};
				},

				tags: {},
			});

			if (!conversion.isValid) {
				const discarded =
					conversion.discardedTracks
						.map(item => {
							return (
								`${String(item.track)}: ` +
								`${item.reason}`
							);
						})
						.join('\n');

				throw new Error(
					`MediaBunny conversion is invalid.\n\n` +
					`Discarded tracks:\n` +
					`${discarded || '(none)'}`
				);
			}

			conversion.onProgress = progress => {
				const percent =
					Math.floor(progress * 100);

				console.log(
					`[LiveCapture] MediaBunny ${percent}%`
				);
			};

			await conversion.execute();

			const buffer = target.buffer;

			if (!buffer) {
				throw new Error(
					'MediaBunny completed conversion but produced no output buffer.'
				);
			}

			const filename =
				`fansly-live-test-${Date.now()}.mp4`;

			const file = new File(
				[buffer],
				filename,
				{
					type: 'video/mp4',
				}
			);

			const blobUrl =
				URL.createObjectURL(file);

			const link =
				document.createElement('a');

			link.href = blobUrl;
			link.download = filename;
			link.style.display = 'none';

			document.body.appendChild(link);
			link.click();
			link.remove();

			setTimeout(() => {
				URL.revokeObjectURL(blobUrl);
			}, 60_000);

			console.log(
				`[LiveCapture] MediaBunny produced ` +
				`${filename} ` +
				`(${(buffer.byteLength / 1024 / 1024).toFixed(2)} MiB)`
			);

		} finally {
			try {
				input.dispose();
			} catch {
				// Ignore disposal errors.
			}
		}
	}

	async function startMediaBunny()
	{
		const {
			Input,
			ReadableStreamSource,
			MPEG_TS,
			Output,
			Mp4OutputFormat,
			BufferTarget,
			Conversion,
		} = await mediaBunnyPromise;

		const {
			writable,
			readable,
		} = new TransformStream();

		liveStreamWriter = writable.getWriter();

		const source = new ReadableStreamSource(
			readable,
			{
				maxCacheSize: 128 * 1024 * 1024,
			}
		);

		liveInput = new Input({
			source,
			formats: [MPEG_TS],
		});

		const target = new BufferTarget();

		const output = new Output({
			format: new Mp4OutputFormat(),
			target,
		});

		output._muxer.creationTime = 0;

		/*
		 * Start MediaBunny before writing any live segments.
		 *
		 * The conversion will wait for enough MPEG-TS data to
		 * become available from the ReadableStreamSource.
		 */
		liveConversionPromise = (async () => {
			const videoTracks =
				await liveInput.getVideoTracks();

			if (!videoTracks.length) {
				throw new Error(
					'MediaBunny found no video tracks in the live MPEG-TS stream.'
				);
			}

			const videoTrack = videoTracks[0];

			console.log(
				'[LiveCapture] MediaBunny detected live video track.'
			);

			const conversion =
				await Conversion.init({
					input: liveInput,
					output,

					tracks: 'primary',

					copy: {
						mode: 'preferred',
					},

					video: track => {
						if (track !== videoTrack) {
							return {
								discard: true,
							};
						}

						return {};
					},

					tags: {},
				});

			if (!conversion.isValid) {
				const discarded =
					conversion.discardedTracks
						.map(item => {
							return (
								`${String(item.track)}: ` +
								`${item.reason}`
							);
						})
						.join('\n');

				throw new Error(
					`MediaBunny conversion is invalid.\n\n` +
					`Discarded tracks:\n` +
					`${discarded || '(none)'}`
				);
			}

			let lastLoggedPercent = -1;

			conversion.onProgress = progress => {
				/*
				 * A live source has no known final duration, so
				 * progress is not expected to behave like a normal
				 * finite-file conversion.
				 *
				 * Keep this for diagnostic purposes only.
				 */
				const percent =
					Math.floor(progress * 100);

				if (
					percent >= lastLoggedPercent + 5 &&
					percent <= 100
				) {
					lastLoggedPercent = percent;

					console.log(
						`[LiveCapture] MediaBunny progress: ${percent}%`
					);
				}
			};

			console.log(
				'[LiveCapture] MediaBunny conversion started.'
			);

			await conversion.execute();

			const buffer = target.buffer;

			if (!buffer) {
				throw new Error(
					'MediaBunny completed but produced no MP4 output.'
				);
			}

			const filename =
				`fansly-live-${Date.now()}.mp4`;

			const file = new File(
				[buffer],
				filename,
				{
					type: 'video/mp4',
				}
			);

			const blobUrl =
				URL.createObjectURL(file);

			const link =
				document.createElement('a');

			link.href = blobUrl;
			link.download = filename;
			link.style.display = 'none';

			document.body.appendChild(link);
			link.click();
			link.remove();

			setTimeout(() => {
				URL.revokeObjectURL(blobUrl);
			}, 60_000);

			console.log(
				`[LiveCapture] MediaBunny finished ${filename} ` +
				`(${(buffer.byteLength / 1024 / 1024).toFixed(2)} MiB)`
			);
		})();

		/*
		 * Catching here prevents an unhandled promise rejection.
		 * stop() will also await this promise.
		 */
		liveConversionPromise.catch(error => {
			console.error(
				'[LiveCapture] MediaBunny conversion failed:',
				error
			);
		});

		console.log(
			'[LiveCapture] MediaBunny stream initialized.'
		);
	}

	async function queueSegmentForMediaBunny(
		sequence,
		buffer
	) {
		pendingSegments.set(
			sequence,
			new Uint8Array(buffer)
		);

		/*
		 * The first successfully downloaded segment establishes
		 * the starting sequence number for this capture.
		 */
		if (nextSegmentSequence === null) {
			nextSegmentSequence = sequence;
		}

		/*
		 * Serialize all writes to MediaBunny.
		 *
		 * This is important because multiple GM_xmlhttpRequest()
		 * calls can complete in a different order than the HLS
		 * sequence numbers.
		 */
		segmentWriteChain =
			segmentWriteChain.then(async () => {
				while (
					pendingSegments.has(nextSegmentSequence)
				) {
					const bytes =
						pendingSegments.get(
							nextSegmentSequence
						);

					pendingSegments.delete(
						nextSegmentSequence
					);

					console.log(
						`[LiveCapture] Feeding segment ` +
						`#${nextSegmentSequence} to MediaBunny ` +
						`(${bytes.byteLength} bytes)`
					);

					if (!liveStreamWriter) {
						console.warn(
							`[LiveCapture] Ignoring segment #${nextSegmentSequence} because the MediaBunny writer is no longer active.`
						);
						return;
					}

					await liveStreamWriter.write(bytes);

					nextSegmentSequence++;
				}
			});

		return segmentWriteChain;
	}

    /**
     * Start monitoring a live stream.
     *
     * @param {String} id Fansly account ID
     */
    async function start(id)
    {
        if (running) {
            console.warn(
                '[LiveCapture] Already running.'
            );
            return;
        }

        if (!id) {
            throw new Error(
                'A Fansly account ID is required.'
            );
        }
		
		captureStarted = false;
		capturedDuration = 0;

		seenSegments.clear();

		pendingSegments.clear();

		nextSegmentSequence = null;

		segmentWriteChain =
			Promise.resolve();

		lastMediaSequence = null;

        accountId = String(id);

        console.log(
            `[LiveCapture] Discovering stream for account ${accountId}...`
        );

        const stream = await getStreamInfo(accountId);

        if (!stream.stream) {
            throw new Error(
                'No active stream was returned.'
            );
        }
		
		console.log('[LiveCapture] Raw stream response:', stream);

		if (!stream.stream.access) {
			throw new Error(
				'The current account does not have access to this stream.'
			);
		}

        streamId = stream.stream.id;
        historyId = stream.stream.historyId;
        masterUrl = stream.stream.playbackUrl;

        if (!masterUrl) {
            throw new Error(
                'The stream response did not contain a playback URL.'
            );
        }

        console.log(
            '[LiveCapture] Stream discovered:',
            {
                accountId,
                streamId,
                historyId,
                startedAt: stream.stream.startedAt,
            }
        );

        console.log(
            '[LiveCapture] Master playlist:',
            masterUrl
        );

		variantUrl = await resolveVariant(masterUrl);

		console.log(
			'[LiveCapture] Variant playlist:',
			variantUrl
		);

		await startMediaBunny();

		running = true;
		await poll();
    }

	function downloadSegment(segment)
	{
		const promise = new Promise((resolve, reject) => {
			GM_xmlhttpRequest({
				method: 'GET',
				url: segment.url,
				headers: {
					'Origin': 'https://fansly.com',
					'Referer': 'https://fansly.com/',
				},
				responseType: 'arraybuffer',

				onload: async response => {
					if (
						response.status < 200 ||
						response.status >= 300
					) {
						reject(
							new Error(
								`HTTP ${response.status}`
							)
						);
						return;
					}

					const buffer = response.response;

					if (!(buffer instanceof ArrayBuffer)) {
						reject(
							new Error(
								`Segment #${segment.sequence} ` +
								`did not return an ArrayBuffer.`
							)
						);
						return;
					}

					try {
						await queueSegmentForMediaBunny(
							segment.sequence,
							buffer
						);

						console.log(
							`[LiveCapture] Segment #${segment.sequence} ` +
							`fed to MediaBunny.`
						);

						resolve();
					} catch (error) {
						reject(error);
					}
				},

				onerror: error => {
					reject(error);
				},

				ontimeout: () => {
					reject(
						new Error(
							`Segment #${segment.sequence} timed out`
						)
					);
				},

				onabort: () => {
					reject(
						new Error(
							`Segment #${segment.sequence} aborted`
						)
					);
				},
			});
		});

		pendingSegmentDownloads.add(promise);

		promise.finally(() => {
			pendingSegmentDownloads.delete(promise);
		});

		promise.catch(error => {
			console.error(
				`[LiveCapture] Failed segment #${segment.sequence}:`,
				error
			);
		});

		return promise;
	}

    /**
     * Stop monitoring.
     */
	async function stop()
	{
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}

		if (!running) {
			return;
		}

		running = false;

		console.log(
			'[LiveCapture] Stopped.'
		);

		console.log(
			`[LiveCapture] Waiting for ` +
			`${pendingSegmentDownloads.size} pending segment download(s)...`
		);

		await Promise.allSettled(
			[...pendingSegmentDownloads]
		);

		if (liveStreamWriter) {
			try {
				await liveStreamWriter.close();

				console.log(
					'[LiveCapture] MediaBunny input stream closed.'
				);
			} catch (error) {
				console.error(
					'[LiveCapture] Failed to close MediaBunny input stream:',
					error
				);
			}

			liveStreamWriter = null;
		}

		if (liveConversionPromise) {
			try {
				await liveConversionPromise;

				console.log(
					'[LiveCapture] MediaBunny finalization complete.'
				);
			} catch (error) {
				console.error(
					'[LiveCapture] MediaBunny finalization failed:',
					error
				);
			}

			liveConversionPromise = null;
		}

		if (liveInput) {
			try {
				liveInput.dispose();
			} catch {
				// Ignore disposal errors.
			}

			liveInput = null;
		}
	}

    return {
        start,
        stop,
    };
})();

unsafeWindow.liveCapture = liveCapture;

/**
 * Fetch a live HLS playlist through GM_xmlhttpRequest.
 *
 * This is intentionally separate from the MediaBunny-specific
 * authenticatedFetch() inside downloadM3u8AsMP4().
 */
function fetchLivePlaylist(url)
{
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            headers: {
                'Origin': 'https://fansly.com',
                'Referer': 'https://fansly.com/',
            },

            onload: response => {
                if (response.status < 200 || response.status >= 300) {
                    reject(
                        new Error(
                            `Live playlist request failed: HTTP ${response.status}`
                        )
                    );
                    return;
                }

                resolve(response.responseText);
            },

            onerror: error => {
                reject(
                    new Error(
                        'Live playlist request failed.'
                    )
                );
            },

            ontimeout: () => {
                reject(
                    new Error(
                        'Live playlist request timed out.'
                    )
                );
            },
        });
    });
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

/**
 * Global MediaBunny download queue.
 *
 * Only one MediaBunny/HLS download is allowed to run at a time.
 * Jobs are processed FIFO.
 */
const mediaDownloadQueue = (() => {
    const queue = [];
    let running = false;

    async function processNext() {
        if (running || queue.length === 0) {
            return;
        }

        running = true;

        const job = queue.shift();

        console.log(
            `[MediaBunny Queue] Starting ${job.filename} ` +
            `(${queue.length} remaining)`
        );

        try {
            await job.run();

            console.log(
                `[MediaBunny Queue] Completed ${job.filename} ` +
                `(${queue.length} remaining)`
            );

            job.resolve();
        } catch (error) {
            console.error(
                `[MediaBunny Queue] Failed ${job.filename}:`,
                error
            );

            job.reject(error);
        } finally {
            running = false;

            // Start the next queued job, if any.
            processNext();
        }
    }

    function add(filename, run) {
        return new Promise((resolve, reject) => {
            queue.push({
                filename,
                run,
                resolve,
                reject,
            });

            console.log(
                `[MediaBunny Queue] Queued ${filename} ` +
                `(${queue.length} total waiting)`
            );

            processNext();
        });
    }

    return {
        add,
    };
})();

/**
 * Global image download queue.
 *
 * Allows multiple image downloads to run simultaneously, but limits
 * the number of active downloads to avoid overwhelming the browser
 * or server when downloading large photosets.
 */
const imageDownloadQueue = (() => {
    const queue = [];
    let running = 0;

    function processNext() {
        while (
            running < IMAGE_DOWNLOAD_CONCURRENCY &&
            queue.length > 0
        ) {
            const job = queue.shift();
            running++;

            console.log(
                `[Image Queue] Starting ${job.filename} ` +
                `(${queue.length} remaining, ${running} active)`
            );

            GM_download({
                method: 'GET',
                url: job.url,
                name: job.filename,
                saveAs: false,

                onload: () => {
                    console.log(
                        `[Image Queue] Completed ${job.filename}`
                    );

                    running--;
                    job.resolve();
                    processNext();
                },

                onerror: error => {
                    console.error(
                        `[Image Queue] Failed ${job.filename}:`,
                        error
                    );

                    running--;
                    job.reject(error);
                    processNext();
                },

                onabort: () => {
                    console.warn(
                        `[Image Queue] Aborted ${job.filename}`
                    );

                    running--;
                    job.reject(new Error('Download aborted'));
                    processNext();
                },

                ontimeout: () => {
                    console.warn(
                        `[Image Queue] Timed out ${job.filename}`
                    );

                    running--;
                    job.reject(new Error('Download timed out'));
                    processNext();
                },
            });
        }
    }

    function add(url, filename) {
        return new Promise((resolve, reject) => {
            queue.push({
                url,
                filename,
                resolve,
                reject,
            });

            console.log(
                `[Image Queue] Queued ${filename} ` +
                `(${queue.length} waiting, ${running} active)`
            );

            processNext();
        });
    }

    return {
        add,
    };
})();

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
		/*
		 * For MP4 media backed by an HLS playlist, use MediaBunny when
		 * enabled. Otherwise retain the original direct-file download.
		 */
		const m3u8Info =
			m3u8Download &&
			filetype === 'mp4' &&
			media.variants
				? getM3u8Info(media)
				: null;

		if (m3u8Info) {
			const filenameNoExt =
				  finalFilename.replace(/\.mp4$/i, '');

			/*
			 * Intentionally don't await this.
			 *
			 * filterMedia() historically triggers downloads in the
			 * background, and preserving that behavior means multiple
			 * media items can begin downloading without blocking the
			 * iteration.
			 */
			mediaDownloadQueue.add(
				finalFilename,
				() => downloadM3u8AsMP4(
					m3u8Info.url,
					m3u8Info.cookies,
					filenameNoExt,
					m3u8Info.duration
				)
			).catch(error => {
				console.error(
					`[MediaBunny] Failed to download ${finalFilename}:`,
					error
				);
			});
		} else {
			if (mimetype.startsWith('image/')) {
				imageDownloadQueue
					.add(url, finalFilename)
					.catch(error => {
						console.error(
							`[Image Queue] Failed ${finalFilename}:`,
							error
						);
					});
			} else {
				GM_download({
					method: 'GET',
					url: url,
					name: finalFilename,
					saveAs: false,
				});
			}
		}
	} else {
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
        debugWarn(`[apiFetch] 429 rate limited. Retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
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
	
	const accountsById = new Map(
		allAccounts.map(account => [account.id, account])
	);

	const groupsByCreator = new Map(
		allGroups.map(group => [group.createdBy, group])
	);

	for (const groupMeta of allData)
	{
		const { groupId, partnerAccountId } = groupMeta;

		const accountMeta = accountsById.get(partnerAccountId) || null;
		const messageMeta = groupsByCreator.get(partnerAccountId) || null;

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

// Match Fansly's default message-page size.
const MESSAGE_PAGE_SIZE = 50;
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

        debugLog('[handleMessages] cachedMessages set:', groupId, cachedMessages[groupId]);

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
		return;
	}

	const unread = document.querySelector(messageUnreadSelector);
	if (!unread) {
		return;
	}

	const parent = sync.parentElement;
	const parent2 = unread.parentElement?.parentElement;

	if (!parent || !parent2) {
		return;
	}
	
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

	const content =
        `var messageData = ${JSON.stringify(exportData, null, 2)};`;

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

async function cleanupOpfsFile(opfsRoot, filename) {
    if (!opfsRoot || !filename) {
        return;
    }

    try {
        await opfsRoot.removeEntry(filename);
    } catch (error) {
        debugWarn(
            `[MediaBunny] Failed to remove temporary OPFS file ${filename}:`,
            error
        );
    }
}
