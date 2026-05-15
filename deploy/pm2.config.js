// PM2 process manager config for the Conversation Canvas production deploy.
//
// Run on the VM as the `canvas` user:
//   pm2 start deploy/pm2.config.js
//   pm2 save
//   pm2 startup systemd   # follow the printed sudo command
//
// We invoke `node --env-file=.env.local` so the production secrets in
// `.env.local` (Speechmatics + Gemini keys, NEXT_PUBLIC_WS_URL) are loaded by
// Node 22's built-in dotenv loader before tsx executes the server entry.
// tsx is run by absolute path inside the repo's node_modules to avoid PATH
// surprises under pm2's spawned shell.
module.exports = {
  apps: [
    {
      name: 'conversation-canvas',
      cwd: '/home/canvas/conversation-canvas',
      script: 'node',
      args: '--env-file=.env.local node_modules/.bin/tsx server/index.ts',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      out_file: '/home/canvas/.pm2/logs/conversation-canvas-out.log',
      error_file: '/home/canvas/.pm2/logs/conversation-canvas-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
