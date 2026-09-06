export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL wajib diisi!' });
    }

    try {
        const apiUrl = `https://api.tikmate.app/api/lookup?url=${encodeURIComponent(url)}`;

        const response = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const data = await response.json();

        if (data && data.video_url) {
            return res.status(200).json({
                success: true,
                video_url: data.video_url,
                title: data.title || 'TikTok',
                author: data.author || '@unknown'
            });
        } else {
            return res.status(404).json({
                error: 'Video tidak ditemukan'
            });
        }
    } catch (error) {
        return res.status(500).json({
            error: 'Server error'
        });
    }
}
