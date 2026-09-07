export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { url, format = 'mp4', quality = '720' } = req.query;

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL YouTube wajib diisi!' });
    }

    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
        return res.status(400).json({ error: 'Masukkan URL YouTube yang valid.' });
    }

    if (!['mp4', 'mp3'].includes(format)) {
        return res.status(400).json({ error: 'Format harus mp4 atau mp3.' });
    }

    const allowedQuality = ['144', '240', '360', '480', '720', '1080', '1440', '2160', 'max'];
    const videoQuality = allowedQuality.includes(String(quality)) ? String(quality) : '720';

    const cobaltUrl = process.env.COBALT_API_URL;
    if (!cobaltUrl) {
        return res.status(503).json({
            error: 'COBALT_API_URL belum dikonfigurasi di Vercel.'
        });
    }

    try {
        const endpoint = cobaltUrl.replace(/\/$/, '');
        const payload = {
            url,
            downloadMode: format === 'mp3' ? 'audio' : 'auto',
            audioFormat: 'mp3',
            audioBitrate: '128',
            videoQuality,
            youtubeVideoCodec: 'h264',
            youtubeVideoContainer: 'mp4',
            filenameStyle: 'pretty'
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            console.error('Cobalt non-JSON response:', text.slice(0, 300));
            return res.status(502).json({
                error: 'Layanan downloader YouTube mengembalikan respons tidak valid.'
            });
        }

        if (!response.ok || data.status === 'error' || data.status === 'rate-limit') {
            return res.status(502).json({
                error: data.text || 'Video YouTube tidak dapat diproses.'
            });
        }

        const mediaUrl = data.url || data.audio;
        if (!mediaUrl) {
            return res.status(502).json({
                error: 'Layanan YouTube tidak memberikan URL file.'
            });
        }

        return res.status(200).json({
            success: true,
            platform: 'youtube',
            format,
            media_url: mediaUrl,
            title: data.filename || 'YouTube Media',
            author: '',
            status: data.status
        });
    } catch (error) {
        console.error('YouTube API error:', error);
        return res.status(500).json({ error: 'Server error saat memproses YouTube.' });
    }
}
