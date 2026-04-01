module.exports = {
  apps: [
    {
      name: "print-agent",
      script: "./agent.js",
      watch: true,
      env: {
        LISTEN_HOST: "0.0.0.0",
        LISTEN_PORT: 9393,
        PRINTER_HOST: "192.168.100.131",
        PRINTER_PORT: 9100,

        // tuỳ chọn layout
        LINE_WIDTH: 40,
        QTY_COL: 3,
        FEED_BEFORE_CUT: 6,
        CUT_AFTER_FEED: 2,

        // tăng khoảng cách chữ cho dễ đọc
        LETTER_SPACE: 4
      }
    }
  ]
};
