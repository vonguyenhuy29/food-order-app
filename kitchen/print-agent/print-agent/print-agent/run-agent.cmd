@echo off
cd /d C:\print-agent
REM ==== Tuỳ chỉnh định dạng hoá đơn ====
set "LINE_WIDTH=48"
set "HEADER_W=2"
set "HEADER_H=2"
set "BODY_W=1"
set "BODY_H=2"
set "BODY_BOLD=1"
set "FONT=A"
set "FEED_BEFORE_CUT=8"
set "CUT_AFTER_FEED=4"

REM ==== Chạy agent và ghi log ====
"C:\Program Files\nodejs\node.exe" agent.js --listen 0.0.0.0 --port 9393 --printer 192.168.100.131:9100 >> "C:\print-agent\agent.log" 2>&1
