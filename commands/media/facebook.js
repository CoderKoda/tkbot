/**
 * Facebook Link Finder - share Facebook video/page links only
 */

const axios = require('axios');

const FACEBOOK_PATTERNS = [
  /https?:\/\/(?:www\.)?facebook\.com\//i,
  /https?:\/\/(?:www\.)?fb\.com\//i,
  /https?:\/\/(?:www\.)?fb\.watch\//i
];

const FACEBOOK_VIDEO_PATTERNS = [
  /https?:\/\/(?:www\.)?facebook\.com\/.+\/videos\/[0-9]+/i,
  /https?:\/\/(?:www\.)?facebook\.com\/watch\/\?v=[0-9]+/i,
  /https?:\/\/(?:www\.)?fb\.watch\/[A-Za-z0-9_-]+/i
];

async function findFacebookUrl(query) {
  const response = await axios.get('https://html.duckduckgo.com/html/', {
    params: { q: `site:facebook.com ${query}` },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 20000
  });

  const html = response.data;
  const urls = new Set();

  for (const pattern of [...FACEBOOK_VIDEO_PATTERNS, ...FACEBOOK_PATTERNS]) {
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
        Referer: 'https://www.facebook.com/'
      },
      timeout: 20000
    });

    const html = response.data;
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+property="twitter:title"\s+content="([^"]+)"/i);
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
  name: 'facebook',
  aliases: ['fb', 'fbdl', 'facebookdl'],
  category: 'media',
  description: 'Search for a Facebook video or page link and share it',
  usage: '.facebook <Facebook link or search query>',

  async execute(sock, msg, args, extra) {
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || args.join(' ');
    const query = (text || '').trim();

    if (!query) {
      return await extra.reply('Usage: .facebook <Facebook link or search query>');
    }

    let url = null;
    if (FACEBOOK_PATTERNS.some(pattern => pattern.test(query))) {
      url = query;
    } else {
      url = await findFacebookUrl(query);
    }

    if (!url) {
      return await extra.reply('No Facebook video or page result found. Try a different query or provide a direct Facebook link.');
    }

    const metadata = await fetchMetadata(url);
    const caption = `🎵 ${metadata.title || 'Facebook result'}\n🔗 ${url}`;

    if (metadata.thumbnail) {
      await sock.sendMessage(extra.from, { image: { url: metadata.thumbnail }, caption }, { quoted: msg });
    } else {
      await sock.sendMessage(extra.from, { text: caption }, { quoted: msg });
    }
  }
};
