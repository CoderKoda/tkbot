const MULTIPLIER = 1;

const ROLES = [
  { min: 1, name: 'User' },
  { min: 5, name: 'Computational Thinker' },
  { min: 10, name: 'Block Coder' },
  { min: 15, name: 'Python Pro' },
  { min: 20, name: 'Web Developer' },
  { min: 25, name: 'C-Style Noob' },
  { min: 30, name: 'C-Style Pro' },
  { min: 40, name: 'Website Owner' },
  { min: 50, name: 'App Developer' },
  { min: 60, name: 'App Owner' },
  { min: 70, name: 'Language Creator' },
  { min: 80, name: 'Company Executive' },
  { min: 90, name: 'Company Owner' },
  { min: 100, name: 'Ultimate Developer' },
];

function xpForLevel(level, multiplier = MULTIPLIER) {
  return Math.floor(level * 150 * multiplier);
}

function canLevelUp(level, xp, multiplier = MULTIPLIER) {
  return xp >= xpForLevel(level, multiplier);
}

function getRole(level) {
  let role = ROLES[0];
  for (const entry of ROLES) {
    if (level >= entry.min) role = entry;
  }
  return { name: role.name, min: role.min };
}

function formatLevelUpMessage(before, after, role, diamondsEarned = 0) {
  let text =
    `*▢ LEVEL UP!*\n\n` +
    `*${before}* ➜ *${after}*\n` +
    `Rank: *${role}*`;
  if (diamondsEarned > 0) text += `\nReward: *+${diamondsEarned}* 💎`;
  return text;
}

module.exports = {
  MULTIPLIER,
  ROLES,
  xpForLevel,
  canLevelUp,
  getRole,
  formatLevelUpMessage,
};
