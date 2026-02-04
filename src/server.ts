import Fastify, { FastifyInstance } from 'fastify';
import { LidarDriver, ScanData } from './LidarDriver';

const fastify: FastifyInstance = Fastify({ logger: true });
const lidar = new LidarDriver();

let latestScanData: ScanData | null = null;

lidar.on('scan', (data: ScanData) => {
  latestScanData = data;
});

const indexHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Lidar Dashboard</title>
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
        
        /* 왼쪽 사이드바 (컨트롤 & 정보) */
        #sidebar {
            width: 320px;
            background-color: #1e1e1e;
            padding: 20px;
            display: flex;
            flex-direction: column;
            border-right: 1px solid #333;
            box-shadow: 2px 0 5px rgba(0,0,0,0.5);
        }

        h2 { margin-top: 0; font-size: 1.2rem; color: #fff; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
        
        /* 입력 폼 스타일 */
        .control-group { margin-bottom: 20px; background: #2c2c2c; padding: 15px; border-radius: 8px; }
        .control-group label { display: block; margin-bottom: 5px; font-size: 0.9rem; color: #aaa; }
        .input-row { display: flex; gap: 10px; margin-bottom: 10px; }
        input { 
            background: #333; border: 1px solid #444; color: white; 
            padding: 8px; border-radius: 4px; width: 100%; text-align: center; font-family: monospace;
        }
        
        /* 버튼 스타일 */
        button { 
            width: 100%; padding: 10px; border: none; border-radius: 4px; 
            cursor: pointer; font-weight: bold; transition: 0.2s; margin-bottom: 5px;
        }
        button.primary { background: #007bff; color: white; }
        button.primary:hover { background: #0056b3; }
        button.danger { background: #dc3545; color: white; }
        button.danger:hover { background: #a71d2a; }
        button.secondary { background: #444; color: #ddd; }
        button.secondary:hover { background: #555; }

        /* 센서 데이터 테이블 */
        .data-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .data-table td { padding: 8px 0; border-bottom: 1px solid #333; }
        .data-table td:first-child { color: #888; }
        .data-table td:last-child { text-align: right; color: #00ff00; font-family: monospace; font-size: 1rem; }

        /* 상태 표시 */
        #status-box { 
            text-align: center; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-weight: bold;
            background: #222; border: 1px solid #333;
        }
        .connected { color: #28a745; border-color: #28a745 !important; }
        .disconnected { color: #dc3545; border-color: #dc3545 !important; }

        /* 오른쪽 뷰어 영역 */
        #main-view {
            flex: 1;
            position: relative;
            background: #000;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        canvas { box-shadow: 0 0 30px rgba(0,0,0,0.5); border-radius: 50%; background: #050505; }
        
        #overlay-info {
            position: absolute; top: 20px; right: 20px; 
            background: rgba(0,0,0,0.7); padding: 10px; border-radius: 5px; 
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
                <input type="text" id="ip" value="192.168.0.10" placeholder="IP Address">
                <input type="number" id="port" value="8000" placeholder="Port" style="width: 60px;">
            </div>
            <button class="primary" onclick="connect()">Connect & Start</button>
            <button class="danger" onclick="disconnect()">Disconnect</button>
        </div>

        <h2>Sensor Data</h2>
        <div class="control-group">
            <table class="data-table">
                <tr><td>Scan Counter</td><td id="val-counter">-</td></tr>
                <tr><td>Scan Freq</td><td id="val-freq">- Hz</td></tr>
                <tr><td>Points</td><td id="val-points">-</td></tr>
                <tr><td>Angle Start</td><td id="val-start">-</td></tr>
                <tr><td>Angle Resol</td><td id="val-resol">-</td></tr>
                <tr><td>Status</td><td id="val-status">Wait</td></tr>
            </table>
        </div>

        <h2>Controls</h2>
        <button class="secondary" onclick="sendCommand('SetAccessLevel,0000')">Re-Login</button>
        <button class="secondary" onclick="sendCommand('SensorStart')">Force Start</button>
    </div>

    <div id="main-view">
        <canvas id="lidarCanvas" width="800" height="800"></canvas>
        <div id="overlay-info">
            Mouse Wheel: Zoom In/Out<br>
            Scale: <span id="scale-indicator">50</span> px/m
        </div>
    </div>

    <script>
        const canvas = document.getElementById('lidarCanvas');
        const ctx = canvas.getContext('2d');
        const statusEl = document.getElementById('status-box');
        
        // 데이터 표시 엘리먼트
        const elCounter = document.getElementById('val-counter');
        const elFreq = document.getElementById('val-freq');
        const elPoints = document.getElementById('val-points');
        const elStart = document.getElementById('val-start');
        const elResol = document.getElementById('val-resol');
        const elStatus = document.getElementById('val-status');
        const elScale = document.getElementById('scale-indicator');

        let isRunning = false;
        let scale = 50; 
        let scanData = null;

        // 줌 제어
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            scale += e.deltaY * -0.1;
            if (scale < 5) scale = 5;
            if (scale > 300) scale = 300;
            elScale.innerText = Math.round(scale);
            if(!scanData) drawGrid(); 
        });

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
            resetDataDisplay();
            drawGrid();
        }

        async function sendCommand(cmd) {
            await fetch('/command', {
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

        function resetDataDisplay() {
            elCounter.innerText = '-';
            elFreq.innerText = '- Hz';
            elPoints.innerText = '-';
            elStart.innerText = '-';
            elResol.innerText = '-';
            elStatus.innerText = 'Wait';
        }

        async function loop() {
            if (!isRunning) return;
            try {
                const res = await fetch('/scan');
                if (res.ok) {
                    const data = await res.json();
                    if (!data.status) { 
                        scanData = data;
                        updateUI(data);
                        draw(data);
                    }
                }
            } catch(e) {}
            setTimeout(loop, 50); // 20 FPS
        }

        function updateUI(data) {
            // 1. Scan Counter
            elCounter.innerText = data.scanCounter;

            // 2. Frequency (단위: 0.01Hz -> Hz)
            // autolidar.cpp: msg->scan_time = (1.0 / (lsc->scan_mea.scan_freq / 100.0));
            const freqHz = (data.scanFreq / 100.0).toFixed(1);
            elFreq.innerText = freqHz + ' Hz';

            // 3. Points
            elPoints.innerText = data.amountOfData;

            // 4. Angles (단위: 0.0001도 -> 도)
            // autolidar.cpp: lsc->scan_mea.angle_begin / 10000.0
            const startDeg = (data.angleBegin / 10000.0).toFixed(1);
            const resolDeg = (data.angleResol / 10000.0).toFixed(2);
            
            elStart.innerText = startDeg + '°';
            elResol.innerText = resolDeg + '°';
            
            elStatus.innerText = 'Receiving';
            elStatus.style.color = '#00ff00';
        }

        function draw(data) {
            const w = canvas.width;
            const h = canvas.height;
            const cx = w / 2;
            const cy = h / 2;

            // 배경 클리어 (잔상 효과)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.fillRect(0, 0, w, h);

            // 그리드 그리기
            drawGridOnly(cx, cy);

            // 데이터 그리기
            ctx.fillStyle = '#00ff00';
            
            const startAngle = data.angleBegin / 10000.0; 
            const stepAngle = data.angleResol / 10000.0;

            for (let i = 0; i < data.ranges.length; i++) {
                const dist = data.ranges[i]; 
                if (dist < 0.05) continue; 

                // Lidar 0도(정면) -> 화면 -90도(위쪽) 보정
                const currentAngleDeg = startAngle + (i * stepAngle);
                const rad = (currentAngleDeg - 90) * (Math.PI / 180);

                const x = cx + Math.cos(rad) * dist * scale;
                const y = cy + Math.sin(rad) * dist * scale;

                ctx.fillRect(x, y, 3, 3);
            }
        }

        function drawGrid() {
            ctx.fillStyle = '#050505';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            drawGridOnly(canvas.width/2, canvas.height/2);
        }

        function drawGridOnly(cx, cy) {
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.fillStyle = '#666';
            ctx.textAlign = 'center';
            ctx.font = '12px sans-serif';

            // 동심원 (1m 단위)
            const maxDist = (canvas.width / 2) / scale; 
            for (let r = 1; r < maxDist; r++) {
                ctx.beginPath();
                ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
                ctx.stroke();
                // 텍스트는 십자선 위쪽에 표시
                ctx.fillText(r + 'm', cx + 5, cy - (r * scale) - 2);
            }

            // 십자선
            ctx.beginPath();
            ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy);
            ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height);
            ctx.stroke();
            
            // 방향 텍스트
            ctx.fillStyle = '#ffcc00';
            ctx.fillText("FRONT", cx, 30);
        }

        // 초기 화면 그리기
        drawGrid();

    </script>
</body>
</html>
`;

// --- API 라우트 ---

fastify.get('/', async (req, reply) => reply.type('text/html').send(indexHtml));

fastify.post<{ Body: { ip: string; port?: number } }>('/connect', async (request, reply) => {
  const { ip, port } = request.body;
  try {
    if (!lidar.isConnected()) {
        await lidar.connect(ip, port || 8000);
    }
    // 자동 초기화: 로그인 -> 센서 시작
    setTimeout(() => lidar.sendCommand('SetAccessLevel,0000'), 200);
    setTimeout(() => lidar.sendCommand('SensorStart'), 600);

    return { status: 'connected', ip, port: port || 8000 };
  } catch (err: any) {
    return { status: 'error', message: err.message };
  }
});

fastify.post('/disconnect', async (request, reply) => {
  lidar.disconnect();
  return { status: 'disconnected' };
});

fastify.get('/scan', async (request, reply) => {
  if (!lidar.isConnected()) return { status: 'error', message: 'Not connected' };
  if (!latestScanData) return { status: 'waiting_for_data' };
  return latestScanData;
});

fastify.post<{ Body: { command: string } }>('/command', async (request, reply) => {
  try {
    lidar.sendCommand(request.body.command);
    return { status: 'sent', command: request.body.command };
  } catch (err: any) {
    return { status: 'error', message: err.message };
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server running at http://localhost:3000');
  } catch (err) {
    process.exit(1);
  }
};

start();