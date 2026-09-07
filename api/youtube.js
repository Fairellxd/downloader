export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { url, format = 'mp4' } = req.query;
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL YouTube wajib diisi!' });
    }

    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
        return res.status(400).json({ error: 'Masukkan URL YouTube yang valid.' });
    }

    if (!['mp4', 'mp3'].includes(format)) {
        return res.status(400).json({ error: 'Format harus mp4 atau mp3.' });
    }

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
            videoQuality: '720',
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

        if (!response.ok || data.status === 'error') {
            const code = data.error?.code || '';
            return res.status(502).json({
                error: code ? `YouTube gagal diproses: ${code}` : 'Video YouTube tidak dapat diproses.'
            });
        }

        if (!data.url) {
            return res.status(502).json({
                error: 'Layanan YouTube tidak memberikan URL file.'
            });
        }

        return res.status(200).json({
            success: true,
            url: data.url,
            filename: data.filename || `youtube_${Date.now()}.${format}`,
            format,
            status: data.status
        });
    } catch (error) {
        console.error('YouTube API error:', error);
        return res.status(500).json({ error: 'Server error saat memproses YouTube.' });
    }
}
