module.exports = {
  apps: [
    // === Backend (server.js nằm ngay trong C:\Apps\food-order-app) ===
    {
      name: 'food-backend',
      script: 'server.js',
      cwd: 'C:\\Apps\\food-order-app\\food-order-backend',
      interpreter: 'C:\\Program Files\\nodejs\\node.exe',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        APP_VERSION: String(Date.now()),
        // giữ HOME/USERPROFILE ở thư mục trung lập để tránh lỗi EPERM
        HOME: 'C:\\pm2home',
        USERPROFILE: 'C:\\pm2home'
      },
      autorestart: true,
      watch: false,
      out_file: 'C:\\logs\\food-backend.out.log',
      error_file: 'C:\\logs\\food-backend.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // === User frontend (serve build bằng serve local) ===
    {
      name: 'food-user',
      script: 'node_modules\\serve\\build\\main.js',
      args: '-s build -l 3001',
      cwd: 'C:\\Apps\\food-order-app\\food-order-user',
      interpreter: 'C:\\Program Files\\nodejs\\node.exe',
      env: {
        NODE_ENV: 'production',
        HOME: 'C:\\pm2home',
        USERPROFILE: 'C:\\pm2home'
      },
      autorestart: true,
      watch: false,
      out_file: 'C:\\logs\\food-user.out.log',
      error_file: 'C:\\logs\\food-user.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // === Admin frontend ===
    {
      name: 'food-admin',
      script: 'node_modules\\serve\\build\\main.js',
      args: '-s build -l 3000',
      cwd: 'C:\\Apps\\food-order-app\\food-order-admin',
      interpreter: 'C:\\Program Files\\nodejs\\node.exe',
      env: {
        NODE_ENV: 'production',
        HOME: 'C:\\pm2home',
        USERPROFILE: 'C:\\pm2home'
      },
      autorestart: true,
      watch: false,
      out_file: 'C:\\logs\\food-admin.out.log',
      error_file: 'C:\\logs\\food-admin.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
