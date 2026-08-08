/**
 * Menu Command - Display all available commands with category-based navigation
 * Usage:
 *   .menu              - Show category overview
 *   .menu <category>   - Show category commands
 *   .help              - Same as .menu
 */

const config = require('../../config');
const { loadCommands } = require('../../utils/commandLoader');

// Category icons for display
const CATEGORY_ICONS = {
  general: '🧭',
  admin: '🛡️',
  ai: '🤖',
  fun: '🎭',
  media: '🎞️',
  owner: '👑',
  textmaker: '🖋️',
  utility: '🔧',
  economy: '💰',
  anime: '👾',
  group: '🔵'
};

// Category display names
const CATEGORY_NAMES = {
  general: 'GENERAL',
  admin: 'ADMIN',
  ai: 'AI',
  fun: 'FUN',
  media: 'MEDIA',
  owner: 'SUDO',
  textmaker: 'TEXTMAKER',
  utility: 'UTILITY',
  economy: 'ECONOMY',
  anime: 'ANIME',
  group: 'GROUP'
};

const CATEGORY_ALIASES = {
  sudo: 'owner',
  sudocmds: 'owner',
  owner: 'owner',
  general: 'general',
  admin: 'admin',
  ai: 'ai',
  fun: 'fun',
  media: 'media',
  textmaker: 'textmaker',
  utility: 'utility',
  economy: 'economy',
  anime: 'anime',
  group: 'group'
};

module.exports = {
  name: 'menu',
  aliases: ['help', 'commands'],
  category: 'general',
  description: 'Show all available commands organized by category',
  usage: '.menu | .menu <category> | .help',
  
  async execute(sock, msg, args, extra) {
    try {
      const commands = loadCommands();
      
      // Determine which category was requested by args only
      let requestedCategory = null;
      if (args[0] && args[0].toLowerCase()) {
        const argCat = args[0].toLowerCase();
        requestedCategory = CATEGORY_ALIASES[argCat] || null;
      }
      
      if (requestedCategory) {
        await showCategory(sock, msg, extra, commands, requestedCategory);
      } else {
        await showOverview(sock, msg, extra, commands);
      }
      
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};

/**
 * Show overview of all categories with command counts
 */
async function showOverview(sock, msg, extra, commands) {
  const ownerNames = Array.isArray(config.ownerName) ? config.ownerName : [config.ownerName];
  const displayOwner = ownerNames[0] || config.ownerName || 'Bot Host';
  
  // Build categories with counts
  const categories = {};
  commands.forEach((cmd, name) => {
    if (cmd.name === name) { // Only count main command names, not aliases
      if (!categories[cmd.category]) {
        categories[cmd.category] = { count: 0, description: cmd.description || '' };
      }
      categories[cmd.category].count++;
      // Keep first description as category description
    }
  });
  
  let menuText = `╭━━『 *${config.botName}* 』━━╮\n\n`;
  menuText += `👋 Hello @${extra.sender.split('@')[0]}!\n\n`;
  menuText += `⚡ Prefix: \`${config.prefix}\`\n`;
  menuText += `📦 Total Commands: ${commands.size}\n`;
  menuText += `👑 Owner: ${displayOwner}\n\n`;
  menuText += `━━━ ❰ *CATEGORIES* ❱ ━━━\n\n`;
  
  // Sort categories: owner first, then general, then alphabetical
  const categoryOrder = ['owner', 'general', 'admin', 'ai', 'fun', 'media', 'textmaker', 'utility', 'economy', 'anime', 'group'];
  const sortedCategories = categoryOrder.filter(cat => categories[cat]);
  const remainingCats = Object.keys(categories).filter(cat => !categoryOrder.includes(cat)).sort();
  const allCats = [...sortedCategories, ...remainingCats];
  
  const categoryDisplayName = (cat) => {
    if (cat === 'owner') return 'sudo';
    return cat;
  };

  allCats.forEach(cat => {
    const icon = CATEGORY_ICONS[cat] || '📁';
    const displayName = CATEGORY_NAMES[cat] || cat.toUpperCase();
    const count = categories[cat]?.count || 0;
    const displayCatCommand = categoryDisplayName(cat);
    
    menuText += `${icon} *${displayName}*  ➜  \`${config.prefix}menu ${displayCatCommand}\`\n`;
    menuText += `│  📌 ${count} command${count !== 1 ? 's' : ''}\n\n`;
  });
  
  menuText += `━━━━━━━━━━━━━━━━━━\n\n`;
  menuText += `💡 *Usage:*\n`;
  menuText += `  \`${config.prefix}menu\` — Show this menu\n`;
  menuText += `  \`${config.prefix}menu general\` — General commands\n`;
  menuText += `  \`${config.prefix}menu admin\` — Admin commands\n`;
  menuText += `  \`${config.prefix}menu ai\` — AI commands\n`;
  menuText += `  \`${config.prefix}menu fun\` — Fun commands\n`;
  menuText += `  \`${config.prefix}menu media\` — Media commands\n`;
  menuText += `  \`${config.prefix}menu sudo\` — Sudo commands\n`;
  menuText += `  \`${config.prefix}menu textmaker\` — Textmaker commands\n`;
  menuText += `  \`${config.prefix}menu utility\` — Utility commands\n`;
  menuText += `  \`${config.prefix}menu economy\` — Economy commands\n`;
  menuText += `  \`${config.prefix}menu anime\` — Anime commands\n`;
  menuText += `  \`${config.prefix}menu group\` — Group commands\n`;
  menuText += `  \`${config.prefix}help <command>\` — Command details\n\n`;
  menuText += `🌟 Bot Version: 1.0.3\n`;
  
  await sendMenuWithImage(sock, msg, extra, menuText);
}

/**
 * Show commands for a specific category
 */
async function showCategory(sock, msg, extra, commands, category) {
  const icon = CATEGORY_ICONS[category] || '📁';
  const displayName = CATEGORY_NAMES[category] || category.toUpperCase();
  
  // Get commands for this category
  const categoryCmds = [];
  commands.forEach((cmd, name) => {
    if (cmd.name === name && cmd.category === category) {
      categoryCmds.push(cmd);
    }
  });
  
  // Filter based on permissions
  const filteredCmds = categoryCmds.filter(cmd => {
    if (cmd.ownerOnly && !extra.isOwner) return false;
    if (cmd.modOnly && !extra.isMod && !extra.isOwner) return false;
    return true;
  });
  
  if (filteredCmds.length === 0) {
    return extra.reply(`📭 No commands available in the *${displayName}* category.`);
  }
  
  let menuText = `╭━━『 *${config.botName}* 』━━╮\n\n`;
  menuText += `👋 Hello @${extra.sender.split('@')[0]}!\n\n`;
  menuText += `━━━ ❰ ${icon} *${displayName}* ❱ ━━━\n\n`;
  
  // Split into description/usage columns
  const maxNameLength = Math.max(...filteredCmds.map(c => c.name.length));
  
  filteredCmds.forEach(cmd => {
    const aliasText = cmd.aliases && cmd.aliases.length > 0
      ? ` (${cmd.aliases.filter(a => a !== cmd.name).slice(0, 3).join(', ')})`
      : '';
    const desc = cmd.description || 'No description';
    menuText += `│ \`${config.prefix}${cmd.name}\`${aliasText}\n`;
    menuText += `│  📌 ${desc}\n`;
    menuText += `│\n`;
  });
  
  menuText += `╰━━━━━━━━━━━━━━━━━\n\n`;
  menuText += `💡 *Total:* ${filteredCmds.length} command${filteredCmds.length !== 1 ? 's' : ''} in ${displayName}\n`;
  menuText += `💡 \`${config.prefix}menu\` — Back to categories\n`;
  menuText += `💡 \`${config.prefix}help <command>\` — Command details\n`;
  menuText += `🌟 Bot Version: 1.0.3\n`;
  
  await sendMenuWithImage(sock, msg, extra, menuText);
}

/**
 * Send menu text with image if available
 */
async function sendMenuWithImage(sock, msg, extra, menuText) {
  const fs = require('fs');
  const path = require('path');
  const imagePath = path.join(__dirname, '../../utils/bot_image.jpg');
  
  if (fs.existsSync(imagePath)) {
    const imageBuffer = fs.readFileSync(imagePath);
    await sock.sendMessage(extra.from, {
      image: imageBuffer,
      caption: menuText,
      mentions: [extra.sender],
      contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: config.newsletterJid || '120363411619820071@newsletter',
          newsletterName: config.botName,
          serverMessageId: -1
        }
      }
    }, { quoted: msg });
  } else {
    await sock.sendMessage(extra.from, {
      text: menuText,
      mentions: [extra.sender]
    }, { quoted: msg });
  }
}

