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
        let normalizedUrl = url.trim();

        // Accept a TikTok URL pasted from a browser/share sheet.
        const extracted = normalizedUrl.match(/https?:\\/\\/(?:www\\.|m\\.|vm\\.|vt\\.|v\\.)?tiktok\\.com\\/[^\\s<>"']+/i);
        if (extracted) normalizedUrl = extracted[0].replace(/[),.;]+$/, '');

        const originalUrl = normalizedUrl;

        try {
            const parsed = new URL(normalizedUrl);
            const host = parsed.hostname.toLowerCase();

            if (!host.endsWith('tiktok.com')) {
                return res.status(400).json({ error: 'URL harus berasal dari TikTok.' });
            }

            // Short/share links contain their resolver token in the path.
            // Never rebuild them as www.tiktok.com/path or the token is lost.
            const isShortLink =
                host === 'vm.tiktok.com' ||
                host === 'vt.tiktok.com' ||
                host === 'v.tiktok.com';

            normalizedUrl = isShortLink
                ? parsed.toString()
                : `https://www.tiktok.com${parsed.pathname}`;
        } catch {
            return res.status(400).json({ error: 'URL TikTok tidak valid.' });
        }

        async function requestTikwm(targetUrl) {
            const response = await fetch('https://www.tikwm.com/api/', {
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Referer': 'https://www.tikwm.com/'
                },
                body: new URLSearchParams({ url: targetUrl, hd: '1' })
            });

            const text = await response.text();
            let result = null;

            try {
                result = JSON.parse(text);
            } catch {
                result = null;
            }

            return { response, result };
        }

        // Try the cleaned URL first. If TikWM rejects it, retry once with
        // the exact original URL because some share URLs need their query form.
        let upstream = await requestTikwm(normalizedUrl);

        if ((!upstream.result || upstream.result.code !== 0 || !upstream.result.data) &&
            originalUrl !== normalizedUrl) {
            upstream = await requestTikwm(originalUrl);
        }

        const { response, result } = upstream;

        if (!result) {
            return res.status(502).json({
                error: 'Layanan TikTok mengembalikan respons tidak valid.'
            });
        }

        if (!response.ok || result.code !== 0 || !result.data) {
            return res.status(502).json({
                error: result.msg || 'Media TikTok tidak dapat diproses.'
            });
        }

        const data = result.data;
        const mediaUrl = format === 'mp3'
            ? (data.music || data.music_info?.play)
            : (data.hdplay || data.play);

        if (!mediaUrl) {
            return res.status(404).json({ error: `URL ${format.toUpperCase()} tidak ditemukan.` });
        }

        const duration = Number(data.duration ?? data.video?.duration ?? 0) || 0;
        const safeTitle = String(data.title || 'TikTok').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 90) || 'TikTok';

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
        return res.status(500).json({ error: 'Server error saat memproses TikTok.' });
    }
}
