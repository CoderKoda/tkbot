/**
 * Song Link Finder - share YouTube music links only
 */

const yts = require('yt-search');

module.exports = {
  name: 'song',
  aliases: ['play', 'music', 'yta'],
  category: 'media',
  description: 'Search for a song on YouTube and share the link',
  usage: '.song <song name or YouTube link>',

  async execute(sock, msg, args) {
    try {
      const text = args.join(' ').trim();
      const chatId = msg.key.remoteJid;

      if (!text) {
        return await sock.sendMessage(chatId, {
          text: 'Usage: .song <song name or YouTube link>'
        }, { quoted: msg });
      }

      let video;

      if (text.includes('youtube.com') || text.includes('youtu.be')) {
        const search = await yts(text);
        if (search && search.videos && search.videos.length) {
          video = search.videos[0];
        } else {
          video = { url: text, title: text, thumbnail: null, timestamp: '' };
        }
      } else {
        const search = await yts(text);
        if (!search || !search.videos.length) {
          return await sock.sendMessage(chatId, {
            text: 'No results found.'
          }, { quoted: msg });
        }
        video = search.videos[0];
      }

      const caption = `🎵 ${video.title || 'Song result'}\n🔗 ${video.url}` +
        (video.timestamp ? `\n⏱ Duration: ${video.timestamp}` : '');

      const message = { text: caption };
      if (video.thumbnail) {
        message.image = { url: video.thumbnail };
        message.caption = caption;
        delete message.text;
      }

      await sock.sendMessage(chatId, message, { quoted: msg });
    } catch (err) {
      console.error('Song command error:', err);
      await sock.sendMessage(msg.key.remoteJid, {
        text: '❌ Could not find the song. Please try a different title or link.'
      }, { quoted: msg });
    }
  }
};
