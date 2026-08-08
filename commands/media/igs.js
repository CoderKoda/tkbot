/**
 * Instagram Sticker Link Finder - share Instagram post links only
 */

const axios = require('axios');

const INSTAGRAM_PATTERNS = [
  /https?:\/\/(?:www\.)?instagram\.com\//i,
  /https?:\/\/(?:www\.)?instagr\.am\//i
];

const INSTAGRAM_VIDEO_PATTERNS = [
  /https?:\/\/(?:www\.)?instagram\.com\/p\/[A-Za-z0-9_-]+/i,
  /https?:\/\/(?:www\.)?instagram\.com\/reel\/[A-Za-z0-9_-]+/i,
  /https?:\/\/(?:www\.)?instagram\.com\/tv\/[A-Za-z0-9_-]+/i,
  /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.]+\/status\/[0-9]+/i
];

async function findInstagramUrl(query) {
  const response = await axios.get('https://html.duckduckgo.com/html/', {
    params: { q: `site:instagram.com ${query}` },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 20000
  });

  const html = response.data;
  const urls = new Set();

  for (const pattern of [...INSTAGRAM_VIDEO_PATTERNS, ...INSTAGRAM_PATTERNS]) {
    let match;
    const regex = new RegExp(pattern.source, 'gim');
    while ((match = regex.exec(html)) !== null) {
      urls.add(match[0]);
    }
  }

  return urls.values().next().value || null;
}

async function fetchMetadata(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://www.instagram.com/'
      },
      timeout: 20000
    });

    const html = response.data;
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
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
  name: 'igs',
  aliases: ['ig', 'igsc', 'instagramsticker'],
  category: 'media',
  description: 'Share Instagram post links only instead of downloading media',
  usage: '.igs <Instagram link or search query>',

  async execute(sock, msg, args, extra) {
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || args.join(' ');
    const query = (text || '').trim();

    if (!query) {
      return await extra.reply('Usage: .igs <Instagram link or search query>');
    }

    let url = null;
    if (INSTAGRAM_PATTERNS.some(pattern => pattern.test(query))) {
      url = query;
    } else {
      url = await findInstagramUrl(query);
    }

    if (!url) {
      return await extra.reply('No Instagram result found. Try a different query or provide a direct Instagram link.');
    }

    const metadata = await fetchMetadata(url);
    const caption = `🎵 ${metadata.title || 'Instagram result'}\n🔗 ${url}`;

    if (metadata.thumbnail) {
      await sock.sendMessage(extra.from, { image: { url: metadata.thumbnail }, caption }, { quoted: msg });
    } else {
      await sock.sendMessage(extra.from, { text: caption }, { quoted: msg });
    }
  }
};
