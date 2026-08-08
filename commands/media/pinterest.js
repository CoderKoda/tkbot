/**
 * Pinterest Link Finder - share Pinterest pin links only
 */

const axios = require('axios');

const PINTEREST_PATTERNS = [
  /https?:\/\/[^\s]*pinterest\.com\//i,
  /https?:\/\/pin\.it\//i
];

const PINTEREST_PIN_PATTERNS = [
  /https?:\/\/[^\s]*pinterest\.com\/[A-Za-z0-9_\/\-]+\/pin\/[0-9]+/i,
  /https?:\/\/pin\.it\/[A-Za-z0-9_-]+/i
];

async function findPinterestUrl(query) {
  const response = await axios.get('https://html.duckduckgo.com/html/', {
    params: { q: `site:pinterest.com ${query}` },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 20000
  });

  const html = response.data;
  const urls = new Set();

  for (const pattern of [...PINTEREST_PIN_PATTERNS, ...PINTEREST_PATTERNS]) {
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
        Referer: 'https://www.pinterest.com/'
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
  name: 'pinterest',
  aliases: ['pin', 'pindl', 'pinterestdl'],
  category: 'media',
  description: 'Search for a Pinterest pin and share the link only',
  usage: '.pinterest <Pinterest link or search query>',

  async execute(sock, msg, args, extra) {
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || args.join(' ');
    const query = (text || '').trim();

    if (!query) {
      return await extra.reply('Usage: .pinterest <Pinterest link or search query>');
    }

    let url = null;
    if (PINTEREST_PATTERNS.some(pattern => pattern.test(query))) {
      url = query;
    } else {
      url = await findPinterestUrl(query);
    }

    if (!url) {
      return await extra.reply('No Pinterest pin result found. Try a different search query or provide a direct Pinterest link.');
    }

    const metadata = await fetchMetadata(url);
    const caption = `🎵 ${metadata.title || 'Pinterest result'}\n🔗 ${url}`;

    if (metadata.thumbnail) {
      await sock.sendMessage(extra.from, { image: { url: metadata.thumbnail }, caption }, { quoted: msg });
    } else {
      await sock.sendMessage(extra.from, { text: caption }, { quoted: msg });
    }
  }
};
