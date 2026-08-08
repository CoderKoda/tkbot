/**
 * TikTok Link Finder - search TikTok and share the video link
 */

const axios = require('axios');

const TIKTOK_VIDEO_PATTERNS = [
  /https?:\/\/(?:www\.)?tiktok\.com\/@[^\/]+\/video\/\d+/i,
  /https?:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9_-]+/i,
  /https?:\/\/(?:www\.)?tiktok\.com\/t\/[A-Za-z0-9_-]+/i
];

async function findTikTokVideoUrl(query) {
  const response = await axios.get('https://html.duckduckgo.com/html/', {
    params: {
      q: `site:tiktok.com ${query}`
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 20000
  });

  const html = response.data;
  const urls = new Set();

  for (const pattern of TIKTOK_VIDEO_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, 'gim');
    while ((match = regex.exec(html)) !== null) {
      urls.add(match[0]);
    }
  }

  return urls.values().next().value || null;
}

async function fetchTikTokMetadata(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.tiktok.com/'
      },
      timeout: 20000
    });

    const html = response.data;
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+name="title"\s+content="([^"]+)"/i);
    const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);

    return {
      title: titleMatch ? titleMatch[1] : null,
      thumbnail: imageMatch ? imageMatch[1] : null
    };
  } catch (error) {
    return { title: null, thumbnail: null };
  }
}

module.exports = {
  name: 'tiktok',
  aliases: ['tt', 'ttdl', 'tiktokdl'],
  category: 'media',
  description: 'Search for a TikTok video and share the link',
  usage: '.tiktok <search query or TikTok link>',

  async execute(sock, msg, args) {
    try {
      const text = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text ||
                   args.join(' ');
      const chatId = msg.key.remoteJid;
      const query = (text || '').trim();

      if (!query) {
        return await sock.sendMessage(chatId, {
          text: 'Usage: .tiktok <search query or TikTok link>'
        }, { quoted: msg });
      }

      let videoUrl = null;
      let title = null;
      let thumbnail = null;

      const normalizedQuery = query.trim();
      const isLink = /https?:\/\/(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\//i.test(normalizedQuery);

      if (isLink) {
        videoUrl = normalizedQuery;
      } else {
        videoUrl = await findTikTokVideoUrl(normalizedQuery);
      }

      if (!videoUrl) {
        return await sock.sendMessage(chatId, {
          text: 'No TikTok video result found. Try a different search query.'
        }, { quoted: msg });
      }

      const metadata = await fetchTikTokMetadata(videoUrl);
      title = metadata.title || 'TikTok video';
      thumbnail = metadata.thumbnail;

      const caption = `🎵 ${title}\n🔗 ${videoUrl}`;
      const message = thumbnail
        ? { image: { url: thumbnail }, caption }
        : { text: caption };

      await sock.sendMessage(chatId, message, { quoted: msg });
    } catch (err) {
      console.error('TikTok command error:', err);
      await sock.sendMessage(msg.key.remoteJid, {
        text: '❌ Could not find a TikTok video. Please try a different query or link.'
      }, { quoted: msg });
    }
  }
};
