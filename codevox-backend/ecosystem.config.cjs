module.exports = {
  apps: [
    {
      name: 'recruitment-assessment-backend',
      script: 'dist/main.js',
      cwd: '/home/ubuntu/recruitment-assessment-backend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3500,
      },
      error_file: '/home/ubuntu/recruitment-assessment-backend/logs/pm2-error.log',
      out_file: '/home/ubuntu/recruitment-assessment-backend/logs/pm2-out.log',
      time: true,
      kill_timeout: 5000,
      max_memory_restart: '1G',
    },
    {
      name: 'recruitment-voice-engine',
      script: 'services/voice-engine/start-native.sh',
      interpreter: 'bash',
      cwd: '/home/ubuntu/recruitment-assessment-backend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PORT: 8002,
      },
      error_file: '/home/ubuntu/recruitment-assessment-backend/logs/voice-engine-error.log',
      out_file: '/home/ubuntu/recruitment-assessment-backend/logs/voice-engine-out.log',
      time: true,
      kill_timeout: 10000,
      max_memory_restart: '2G',
    },
  ],
};
