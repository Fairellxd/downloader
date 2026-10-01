export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { url, format = 'mp4' } = req.query;

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL wajib diisi!' });
    }

    if (!['mp4', 'mp3'].includes(format)) {
        return res.status(400).json({ error: 'Format harus MP4 atau MP3.' });
    }

    try {
        let inputUrl = url.trim();

        // If the user pasted extra text around the TikTok URL, extract only the URL.
        // Keep this regex single-escaped: it runs directly as a JavaScript regex.
        const extracted = inputUrl.match(/https?:\/\/(?:www\.|m\.|vm\.|vt\.|v\.)?tiktok\.com\/[^\s<>"']+/i);
        if (extracted) inputUrl = extracted[0].replace(/[),.;]+$/, '');

        const originalUrl = inputUrl;
        let normalizedUrl = inputUrl;

        try {
            const parsed = new URL(inputUrl);
            const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

            if (!host.endsWith('tiktok.com')) {
                return res.status(400).json({ error: 'URL harus berasal dari TikTok.' });
            }

            const isShortLink =
                host === 'vm.tiktok.com' ||
                host === 'vt.tiktok.com' ||
                host === 'v.tiktok.com';

            // Normal TikTok post URLs do not need tracking query parameters.
            // Short/share URLs must keep their full resolver path/query.
            normalizedUrl = isShortLink
                ? parsed.toString()
                : `https://www.tiktok.com${parsed.pathname}`;
        } catch {
            return res.status(400).json({ error: 'URL TikTok tidak valid.' });
        }

        async function parseUpstream(response) {
            const text = await response.text();
            const contentType = response.headers.get('content-type') || '';

            let result = null;
            try {
                result = JSON.parse(text);
            } catch {
                // Some upstream failures return HTML instead of JSON.
            }

            return {
                ok: response.ok,
                status: response.status,
                contentType,
                result
            };
        }

        async function requestTikwmGet(targetUrl) {
            const endpoint =
                `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}&hd=1`;

            const response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://www.tikwm.com/'
                }
            });

            return parseUpstream(response);
        }

        async function requestTikwmPost(targetUrl) {
            const response = await fetch('https://www.tikwm.com/api/', {
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Referer': 'https://www.tikwm.com/'
                },
                body: new URLSearchParams({
                    url: targetUrl,
                    hd: '1'
                })
            });

            return parseUpstream(response);
        }

        // TikWM's current API supports GET for /api/?url=... .
        // Try GET first; POST is only a fallback for compatibility.
        let upstream = await requestTikwmGet(normalizedUrl);

        if ((!upstream.result || upstream.result.code !== 0 || !upstream.result.data) &&
            originalUrl !== normalizedUrl) {
            upstream = await requestTikwmGet(originalUrl);
        }

        if (!upstream.result || upstream.result.code !== 0 || !upstream.result.data) {
            const postFallback = await requestTikwmPost(normalizedUrl);

            if (postFallback.result && postFallback.result.code === 0 && postFallback.result.data) {
                upstream = postFallback;
            } else if (originalUrl !== normalizedUrl) {
                const originalPostFallback = await requestTikwmPost(originalUrl);
                if (originalPostFallback.result && originalPostFallback.result.code === 0 && originalPostFallback.result.data) {
                    upstream = originalPostFallback;
                }
            }
        }

        const { response, result } = {
            response: { ok: upstream.ok, status: upstream.status },
            result: upstream.result
        };

        if (!result) {
            console.error('TikWM returned non-JSON:', {
                status: upstream.status,
                contentType: upstream.contentType
            });

            return res.status(502).json({
                error: 'Layanan TikTok sedang mengembalikan respons tidak valid. Coba lagi beberapa saat.'
            });
        }

        if (!response.ok || result.code !== 0 || !result.data) {
            return res.status(502).json({
                error: result.msg || `Layanan TikTok menolak URL (HTTP ${response.status}).`
            });
        }

        const data = result.data;
        const mediaUrl = format === 'mp3'
            ? (data.music || data.music_info?.play)
            : (data.hdplay || data.play);

        if (!mediaUrl) {
            return res.status(404).json({
                error: `URL ${format.toUpperCase()} tidak ditemukan.`
            });
        }

        const duration = Number(data.duration ?? data.video?.duration ?? 0) || 0;
        const safeTitle =
            String(data.title || 'TikTok')
                .trim()
                .replace(/[\\/:*?"<>|]/g, '_')
                .slice(0, 90) || 'TikTok';

        return res.status(200).json({
            success: true,
            platform: 'tiktok',
            format,
            media_url: mediaUrl,
            title: data.title || 'TikTok',
            author: data.author?.unique_id ? `@${data.author.unique_id}` : '@unknown',
            duration,
            filename: `${safeTitle}.${format}`
        });
    } catch (error) {
        console.error('TikTok API error:', error);
        return res.status(500).json({
            error: 'Server error saat memproses TikTok.'
        });
    }
}
