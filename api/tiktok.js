export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { url } = req.query;
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL wajib diisi!' });
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
            console.error('TikWM non-JSON response:', text.slice(0, 300));
            return res.status(502).json({
                error: 'Layanan TikTok sedang mengembalikan respons yang tidak valid.'
            });
        }

        if (!response.ok || result.code !== 0 || !result.data) {
            return res.status(502).json({
                error: result.msg || 'Video tidak dapat diproses.'
            });
        }

        const data = result.data;
        const videoUrl = data.hdplay || data.play;
        const audioUrl = data.music || data.music_info?.play || '';

        if (!videoUrl) {
            return res.status(404).json({ error: 'URL video tidak ditemukan.' });
        }

        return res.status(200).json({
            success: true,
            video_url: videoUrl,
            audio_url: audioUrl,
            title: data.title || 'TikTok',
            author: data.author?.unique_id ? `@${data.author.unique_id}` : '@unknown'
        });
    } catch (error) {
        console.error('TikTok API error:', error);
        return res.status(500).json({ error: 'Server error saat memproses video.' });
    }
}
