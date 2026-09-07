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
        const response = await fetch('https://www.tikwm.com/api/', {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ url, hd: '1' })
        });

        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch {
            return res.status(502).json({ error: 'Layanan TikTok mengembalikan respons tidak valid.' });
        }

        if (!response.ok || result.code !== 0 || !result.data) {
            return res.status(502).json({ error: result.msg || 'Video tidak dapat diproses.' });
        }

        const data = result.data;

        // TikWM can return different media fields depending on the video.
        // Keep several fallbacks so a valid response does not become "URL media tidak tersedia".
        const videoCandidates = [
            data.hdplay,
            data.play,
            data.wmplay,
            data.hdplay_api,
            data.play_api
        ];
        const audioCandidates = [
            data.music,
            data.music_info?.play,
            data.music_info?.url,
            data.music_info?.music
        ];

        const mediaUrl = (format === 'mp3' ? audioCandidates : videoCandidates)
            .find(value => typeof value === 'string' && /^https?:\/\//i.test(value));

        if (!mediaUrl) {
            console.error('TikWM media fields missing:', {
                format,
                keys: Object.keys(data || {}),
                musicKeys: data.music_info ? Object.keys(data.music_info) : []
            });
            return res.status(404).json({
                error: `URL ${format.toUpperCase()} tidak ditemukan dari layanan TikTok.`
            });
        }

        return res.status(200).json({
            success: true,
            platform: 'tiktok',
            format,
            media_url: mediaUrl,
            title: data.title || 'TikTok',
            author: data.author?.unique_id ? `@${data.author.unique_id}` : '@unknown'
        });
    } catch (error) {
        console.error('TikTok API error:', error);
        return res.status(500).json({ error: 'Server error saat memproses TikTok.' });
    }
}
