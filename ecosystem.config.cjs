const fs = require('fs');

function loadEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const env = {};
    content.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    return env;
  } catch (e) { return {}; }
}

const env = loadEnv('/root/stargate/.env');

module.exports = {
  apps: [
    {
      name: 'stargate',
      script: 'pnpm',
      args: '--filter @stargate/discord-bot run start',
      interpreter: 'none',
      cwd: '/root/stargate',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      watch: false,
      env: { ...env, NODE_ENV: 'production' },
    },
  ],
};
