/**
 * YouTube Video Link Finder - share YouTube video links only
 */

const yts = require('yt-search');

module.exports = {
  name: 'ytvideo',
  aliases: ['ytv', 'ytmp4', 'ytvid', 'video'],
  category: 'media',
  description: 'Search for a YouTube video and share the link only',
  usage: '.video <video name or URL>',

  async execute(sock, msg, args) {
    const text = args.join(' ').trim();
    const chatId = msg.key.remoteJid;

    if (!text) {
      return await sock.sendMessage(chatId, {
        text: 'Usage: .video <video name or URL>'
      }, { quoted: msg });
    }

    let video;
    if (text.includes('youtube.com') || text.includes('youtu.be')) {
      video = { url: text };
      const search = await yts(text);
      if (search && search.videos && search.videos.length) {
        video = search.videos[0];
      }
    } else {
      const search = await yts(text);
      if (!search || !search.videos.length) {
        return await sock.sendMessage(chatId, {
          text: 'No videos found for that query.'
        }, { quoted: msg });
      }
      video = search.videos[0];
    }

    const caption = `🎥 ${video.title || 'YouTube video'}\n🔗 ${video.url}` +
      (video.timestamp ? `\n⏱ Duration: ${video.timestamp}` : '');

    if (video.thumbnail) {
      await sock.sendMessage(chatId, {
        image: { url: video.thumbnail },
        caption
      }, { quoted: msg });
    } else {
      await sock.sendMessage(chatId, {
        text: caption
      }, { quoted: msg });
    }
  }
};
