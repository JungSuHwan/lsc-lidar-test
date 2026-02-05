import Fastify, { FastifyInstance } from 'fastify';
import { LidarDriver, ScanData } from './LidarDriver';

const fastify: FastifyInstance = Fastify({ logger: true });
const lidar = new LidarDriver();

// 최신 스캔 데이터를 저장할 변수
let latestScanData: ScanData | null = null;

// 라이다 데이터 수신 이벤트
lidar.on('scan', (data: ScanData) => {
  latestScanData = data;
});

// 웹 대시보드 HTML (인코딩, 스타일, 스크립트 포함)
const indexHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Lidar Smart Dashboard</title>
    <style>
        body { 
            background-color: #121212; 
            color: #e0e0e0; 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            display: flex; 
            height: 100vh; 
            overflow: hidden;
        }
        
        /* 왼쪽 사이드바 스타일 */
        #sidebar {
            width: 300px;
            background-color: #1e1e1e;
            padding: 20px;
            display: flex;
            flex-direction: column;
            border-right: 1px solid #333;
            z-index: 10;
            overflow-y: auto; /* 내용 많으면 스크롤 */
        }

        h2 { margin-top: 0; font-size: 1.1rem; color: #fff; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
        
        .control-group { margin-bottom: 20px; background: #2c2c2c; padding: 15px; border-radius: 8px; }
        .input-row { display: flex; gap: 10px; margin-bottom: 10px; }
        
        /* 입력 필드 및 슬라이더 */
        input[type="text"], input[type="number"] { 
            background: #333; border: 1px solid #444; color: white; 
            padding: 8px; border-radius: 4px; width: 100%; text-align: center;
        }
        input[type="range"] { width: 100%; margin: 10px 0; cursor: pointer; }

        /* 버튼 스타일 */
        button { 
            width: 100%; padding: 10px; border: none; border-radius: 4px; 
            cursor: pointer; font-weight: bold; margin-bottom: 5px; 
            transition: background 0.2s;
        }
        button.primary { background: #007bff; color: white; }
        button.primary:hover { background: #0056b3; }
        button.danger { background: #dc3545; color: white; }
        button.danger:hover { background: #a71d2a; }
        button.secondary { background: #444; color: white; }
        button.secondary:hover { background: #666; }
        
        /* 데이터 테이블 */
        .data-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .data-table td { padding: 6px 0; border-bottom: 1px solid #333; }
        .data-table td:last-child { text-align: right; color: #00ff00; font-family: monospace; }

        /* 상태 박스 */
        #status-box { 
            text-align: center; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-weight: bold;
            background: #222; border: 1px solid #333;
        }
        .connected { color: #28a745; border-color: #28a745 !important; }
        .disconnected { color: #dc3545; border-color: #dc3545 !important; }

        /* 메인 뷰어 영역 */
        #main-view {
            flex: 1;
            position: relative;
            background: #000;
            display: flex;
            justify-content: center;
            align-items: center;
            cursor: crosshair; /* 십자 커서 */
        }
        canvas { border-radius: 50%; background: #050505; box-shadow: 0 0 30px rgba(0,0,0,0.6); }
        
        #overlay-info {
            position: absolute; top: 20px; right: 20px; 
            background: rgba(0,0,0,0.6); padding: 10px; border-radius: 5px; 
            pointer-events: none; color: #aaa; font-size: 0.8rem;
        }
    </style>
</head>
<body>

    <div id="sidebar">
        <h2>Connection</h2>
        <div id="status-box" class="disconnected">OFFLINE</div>
        
        <div class="control-group">
            <div class="input-row">
                <input type="text" id="ip" value="192.168.0.10" placeholder="IP">
                <input type="number" id="port" value="8000" placeholder="Port" style="width: 60px;">
            </div>
            <button class="primary" onclick="connect()">Connect</button>
            <button class="danger" onclick="disconnect()">Disconnect</button>
        </div>

        <h2>View Settings</h2>
        <div class="control-group">
            <label>Rotation Offset: <span id="rot-val" style="color:#0ff">-90</span>°</label>
            <input type="range" id="rot-slider" min="-180" max="180" value="-90" step="1">
            <button class="secondary" style="font-size:0.8rem;" onclick="resetRotation()">Reset (-90°)</button>
        </div>

        <h2>Real-time Data</h2>
        <div class="control-group">
            <table class="data-table">
                <tr><td>Scan Freq</td><td id="val-freq">- Hz</td></tr>
                <tr><td>Total Points</td><td id="val-points">-</td></tr>
                <tr><td>Cursor Dist</td><td id="cur-dist" style="color:#0ff">-</td></tr>
                <tr><td>Cursor Angle</td><td id="cur-angle" style="color:#0ff">-</td></tr>
            </table>
        </div>
        
        <h2>Manual CMD</h2>
        <button class="secondary" onclick="sendCommand('SetAccessLevel,0000')">Login (0000)</button>
        <button class="secondary" onclick="sendCommand('SensorStart')">Start</button>
        <button class="secondary" onclick="sendCommand('SensorStop')">Stop</button>
    </div>

    <div id="main-view">
        <canvas id="lidarCanvas" width="800" height="800"></canvas>
        <div id="overlay-info">
            Mouse Wheel: Zoom | Scale: <span id="scale-indicator">50</span> px/m
        </div>
    </div>

    <script>
        const canvas = document.getElementById('lidarCanvas');
        const ctx = canvas.getContext('2d');
        const statusEl = document.getElementById('status-box');
        
        // 데이터 표시용 엘리먼트
        const elFreq = document.getElementById('val-freq');
        const elPoints = document.getElementById('val-points');
        const elCurDist = document.getElementById('cur-dist');
        const elCurAngle = document.getElementById('cur-angle');
        const elScale = document.getElementById('scale-indicator');
        
        // 회전 슬라이더 엘리먼트
        const rotSlider = document.getElementById('rot-slider');
        const rotVal = document.getElementById('rot-val');

        // 상태 변수
        let isRunning = false;
        let scale = 50; // 초기 스케일 (px/m)
        let scanData = null;
        let rotationOffset = -90; // 초기 회전값 (-90도)

        // --- 이벤트 리스너 ---

        // 1. 회전 슬라이더 변경
        rotSlider.addEventListener('input', (e) => {
            rotationOffset = parseInt(e.target.value);
            rotVal.innerText = rotationOffset;
            if (!scanData) drawGrid();
            else draw(scanData);
        });

        // 2. 마우스 이동 (커서 위치 추적)
        let mouseX = 0;
        let mouseY = 0;
        const HIT_RADIUS = 15; // 마우스 감지 반경 (px)

        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            mouseX = e.clientX - rect.left;
            mouseY = e.clientY - rect.top;
        });

        // 3. 마우스 휠 (줌 인/아웃)
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            scale += e.deltaY * -0.1;
            if (scale < 5) scale = 5;
            if (scale > 400) scale = 400;
            elScale.innerText = Math.round(scale);
            if (!scanData) drawGrid();
        });

        // --- 기능 함수 ---

        function resetRotation() {
            rotationOffset = -90;
            rotSlider.value = -90;
            rotVal.innerText = -90;
            if (scanData) draw(scanData);
        }

        async function connect() {
            const ip = document.getElementById('ip').value;
            const port = parseInt(document.getElementById('port').value);
            
            setStatus('Connecting...', 'disconnected');
            
            try {
                const res = await fetch('/connect', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ ip, port })
                });
                const data = await res.json();
                
                if (data.status === 'connected' || data.status === 'already_connected') {
                    setStatus('CONNECTED', 'connected');
                    isRunning = true;
                    loop();
                } else {
                    alert('Connection Failed: ' + data.message);
                    setStatus('OFFLINE', 'disconnected');
                }
            } catch (e) {
                alert('Error: ' + e.message);
                setStatus('ERROR', 'disconnected');
            }
        }

        async function disconnect() {
            await fetch('/disconnect', { method: 'POST' });
            setStatus('OFFLINE', 'disconnected');
            isRunning = false;
            scanData = null;
            
            // UI 초기화
            elFreq.innerText = '- Hz';
            elPoints.innerText = '-';
            elCurDist.innerText = '-';
            elCurAngle.innerText = '-';
            drawGrid();
        }
        
        async function sendCommand(cmd) {
            fetch('/command', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ command: cmd })
            });
        }

        function setStatus(text, cls) {
            statusEl.textContent = text;
            statusEl.className = '';
            statusEl.classList.add(cls);
        }

        // --- 루프 및 그리기 ---

        async function loop() {
            if (!isRunning) return;
            try {
                const res = await fetch('/scan');
                if (res.ok) {
                    const data = await res.json();
                    if (!data.status) { // 에러 메시지가 아니면 데이터
                        scanData = data;
                        // UI 업데이트
                        elFreq.innerText = (data.scanFreq / 100.0).toFixed(1) + ' Hz';
                        elPoints.innerText = data.amountOfData;
                        
                        draw(data);
                    }
                }
            } catch(e) {}
            // 30~50ms 간격으로 재호출
            requestAnimationFrame(loop);
        }

        function draw(data) {
            const w = canvas.width;
            const h = canvas.height;
            const cx = w / 2;
            const cy = h / 2;

            // 1. 배경 클리어 (잔상 효과)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fillRect(0, 0, w, h);

            // 2. 그리드 그리기
            drawGridOnly(cx, cy);

            // 3. 점 데이터 그리기
            ctx.fillStyle = '#00ff00'; // 기본 점 색상
            
            // 각도 단위 변환 (0.0001도 -> 도)
            const startAngle = data.angleBegin / 10000.0;
            const stepAngle = data.angleResol / 10000.0;

            let closestDist = Infinity;
            let closestPoint = null;

            for (let i = 0; i < data.ranges.length; i++) {
                const dist = data.ranges[i];
                if (dist < 0.05) continue; // 노이즈 필터링

                const currentAngleDeg = startAngle + (i * stepAngle);
                
                // [핵심] 좌표 변환 로직
                // 1. (-currentAngleDeg): Lidar의 반시계 방향을 Canvas 시계 방향에 맞게 반전 (좌우 반전 해결)
                // 2. (+ rotationOffset): 회전 보정 (기본 -90도) 적용
                const rad = ((-currentAngleDeg) + rotationOffset) * (Math.PI / 180);

                const x = cx + Math.cos(rad) * dist * scale;
                const y = cy + Math.sin(rad) * dist * scale;

                // 점 찍기
                ctx.fillRect(x, y, 2, 2);

                // 마우스와 가장 가까운 점 찾기
                const dx = x - mouseX;
                const dy = y - mouseY;
                const d = Math.sqrt(dx*dx + dy*dy);

                if (d < HIT_RADIUS && d < closestDist) {
                    closestDist = d;
                    closestPoint = { x, y, dist, angle: currentAngleDeg };
                }
            }

            // 4. 하이라이트 및 툴팁 그리기
            if (closestPoint) {
                // 하이라이트 원
                ctx.beginPath();
                ctx.arc(closestPoint.x, closestPoint.y, 6, 0, Math.PI * 2);
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = 2;
                ctx.stroke();

                // 텍스트 정보
                ctx.font = 'bold 14px monospace';
                const infoText = \`\${closestPoint.dist.toFixed(3)}m / \${closestPoint.angle.toFixed(1)}°\`;
                const textWidth = ctx.measureText(infoText).width;
                
                // 텍스트 배경 박스
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.fillRect(closestPoint.x + 10, closestPoint.y - 35, textWidth + 10, 24);
                
                // 텍스트 그리기
                ctx.fillStyle = '#00ffff';
                ctx.fillText(infoText, closestPoint.x + 15, closestPoint.y - 19);

                // 사이드바 정보 업데이트
                elCurDist.innerText = closestPoint.dist.toFixed(3) + ' m';
                elCurAngle.innerText = closestPoint.angle.toFixed(1) + ' °';
            } else {
                elCurDist.innerText = '-';
                elCurAngle.innerText = '-';
            }
        }

        function drawGridOnly(cx, cy) {
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.fillStyle = '#666';
            ctx.textAlign = 'center';
            ctx.font = '12px sans-serif';

            const maxDist = (canvas.width / 2) / scale; 
            for (let r = 1; r < maxDist; r++) {
                // 원형 그리드
                ctx.beginPath();
                ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
                ctx.stroke();
                // 거리 텍스트
                ctx.fillText(r + 'm', cx + 5, cy - (r * scale) - 2);
            }

            // 십자선
            ctx.beginPath();
            ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy);
            ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height);
            ctx.stroke();
            
            // 전방 표시
            ctx.fillStyle = '#ffcc00';
            ctx.fillText("FRONT (12h)", cx, 30);
        }
        
        // 초기 그리드 표시
        drawGridOnly(canvas.width/2, canvas.height/2);

    </script>
</body>
</html>
`;

// --- API 라우트 정의 ---

// 1. 웹 페이지 제공
fastify.get('/', async (req, reply) => reply.type('text/html').send(indexHtml));

// 2. 연결 요청
fastify.post<{ Body: { ip: string; port?: number } }>('/connect', async (request, reply) => {
  const { ip, port } = request.body;
  try {
    if (!lidar.isConnected()) {
        await lidar.connect(ip, port || 8000);
    }
    
    // [자동 실행 시퀀스]
    // 연결 후 0.2초 뒤 로그인, 0.6초 뒤 시작 명령 전송
    setTimeout(() => lidar.sendCommand('SetAccessLevel,0000'), 200);
    setTimeout(() => lidar.sendCommand('SensorStart'), 600);

    return { status: 'connected', ip, port: port || 8000 };
  } catch (err: any) {
    return { status: 'error', message: err.message };
  }
});

// 3. 연결 해제
fastify.post('/disconnect', async (request, reply) => {
  lidar.disconnect();
  return { status: 'disconnected' };
});

// 4. 스캔 데이터 요청
fastify.get('/scan', async (request, reply) => {
  if (!lidar.isConnected()) return { status: 'error', message: 'Not connected' };
  if (!latestScanData) return { status: 'waiting_for_data' };
  return latestScanData;
});

// 5. 수동 커맨드 전송
fastify.post<{ Body: { command: string } }>('/command', async (request, reply) => {
  try {
    lidar.sendCommand(request.body.command);
    return { status: 'sent', command: request.body.command };
  } catch (err: any) {
    return { status: 'error', message: err.message };
  }
});

// --- 서버 시작 ---
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server running at http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

//