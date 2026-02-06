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

// 공통 지연 함수 (ms)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 16진수 변환 헬퍼 함수
function toHex(num: number): string {
    return (num >>> 0).toString(16).toUpperCase();
}

// 웹 대시보드 HTML
const indexHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>LSC Lidar Controller</title>
    <style>
        body { background-color: #121212; color: #e0e0e0; font-family: sans-serif; margin: 0; display: flex; height: 100vh; overflow: hidden; }
        #sidebar { width: 320px; background-color: #1e1e1e; padding: 20px; display: flex; flex-direction: column; border-right: 1px solid #333; overflow-y: auto; }
        h2 { border-bottom: 2px solid #007bff; padding-bottom: 10px; font-size: 1.1rem; }
        .control-group { background: #2c2c2c; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .input-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
        input[type="text"], input[type="number"] { background: #333; border: 1px solid #444; color: white; padding: 8px; border-radius: 4px; width: 100%; text-align: center; }
        button { width: 100%; padding: 10px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 5px; color: white; transition: 0.2s; }
        button.primary { background: #007bff; } button.primary:hover { background: #0056b3; }
        button.danger { background: #dc3545; } button.danger:hover { background: #a71d2a; }
        button.secondary { background: #444; } button.secondary:hover { background: #666; }
        #status-box { text-align: center; padding: 10px; background: #222; border: 1px solid #333; margin-bottom: 15px; font-weight: bold; border-radius: 4px; }
        .connected { color: #28a745; border-color: #28a745 !important; }
        .disconnected { color: #dc3545; border-color: #dc3545 !important; }
        #main-view { flex: 1; position: relative; background: #000; display: flex; justify-content: center; align-items: center; }
        canvas { background: #050505; border-radius: 50%; box-shadow: 0 0 30px rgba(0,0,0,0.6); }
    </style>
</head>
<body>
    <div id="sidebar">
        <h2>Connection</h2>
        <div id="status-box" class="disconnected">OFFLINE</div>
        <div class="control-group">
            <div class="input-row"><input type="text" id="ip" value="192.168.0.10" placeholder="IP"><input type="number" id="port" value="8000" style="width: 60px;"></div>
            <button class="primary" onclick="connect()">Connect & Sync</button>
            <button class="danger" onclick="disconnect()">Disconnect</button>
        </div>
        <h2>Scan Configuration</h2>
        <div class="control-group">
            <div class="input-row"><label>Min(°)</label><input type="number" id="scan-min" value="-45" step="1"></div>
            <div class="input-row"><label>Max(°)</label><input type="number" id="scan-max" value="225" step="1"></div>
            <button class="primary" onclick="applyScanConfig()">Apply Config</button>
        </div>
        <h2>Data Info</h2>
        <div class="control-group" style="font-size: 0.9rem;">
            <div>Freq: <span id="val-freq" style="color:#0f0">-</span> Hz</div>
            <div>Points: <span id="val-points" style="color:#0f0">-</span></div>
        </div>
    </div>
    <div id="main-view"><canvas id="lidarCanvas" width="800" height="800"></canvas></div>
    <script>
        const canvas = document.getElementById('lidarCanvas');
        const ctx = canvas.getContext('2d');
        let isRunning = false;
        let scanData = null;
        let scale = 50; 

        // Canvas Scale Zoom
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            scale += e.deltaY * -0.1;
            if(scale < 5) scale = 5;
            if(scale > 400) scale = 400;
            if(!scanData) drawGrid();
        });

        async function connect() {
            const ip = document.getElementById('ip').value;
            const port = parseInt(document.getElementById('port').value);
            setStatus('Connecting...', 'disconnected');
            try {
                const res = await fetch('/connect', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ ip, port })
                });
                const data = await res.json();
                if (data.status === 'connected') {
                    setStatus('CONNECTED', 'connected');
                    isRunning = true;
                    loop();
                } else {
                    alert('Failed: ' + data.message);
                    setStatus('OFFLINE', 'disconnected');
                }
            } catch (e) { alert(e.message); }
        }

        async function disconnect() {
            await fetch('/disconnect', { method: 'POST' });
            setStatus('OFFLINE', 'disconnected');
            isRunning = false;
        }

        async function applyScanConfig() {
            const min = parseFloat(document.getElementById('scan-min').value);
            const max = parseFloat(document.getElementById('scan-max').value);
            setStatus('Configuring...', 'disconnected');
            try {
                const res = await fetch('/config/scan', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ min, max })
                });
                const data = await res.json();
                if(data.status === 'success') {
                    alert('Config Applied!');
                    setStatus('CONNECTED', 'connected');
                } else {
                    alert('Error: ' + data.message);
                    setStatus('CONNECTED', 'connected');
                }
            } catch(e) { alert(e.message); }
        }

        function setStatus(text, cls) {
            const el = document.getElementById('status-box');
            el.textContent = text; el.className = cls;
        }

        async function loop() {
            if(!isRunning) return;
            try {
                const res = await fetch('/scan');
                if(res.ok) {
                    const data = await res.json();
                    if(!data.status) {
                        scanData = data;
                        document.getElementById('val-freq').innerText = (data.scanFreq/100).toFixed(1);
                        document.getElementById('val-points').innerText = data.amountOfData;
                        draw(data);
                    }
                }
            } catch(e){}
            requestAnimationFrame(loop);
        }

        function draw(data) {
            const w = canvas.width, h = canvas.height;
            const cx = w/2, cy = h/2;
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0,0,w,h);
            drawGridOnly(cx, cy);
            
            ctx.fillStyle = '#00ff00';
            const startAngle = data.angleBegin / 10000.0;
            const stepAngle = data.angleResol / 10000.0;
            
            for(let i=0; i<data.ranges.length; i++) {
                const dist = data.ranges[i];
                if(dist < 0.05) continue;
                const angleDeg = startAngle + (i * stepAngle);
                const rad = ((-angleDeg) - 90) * (Math.PI/180); // -90 for rotation
                const x = cx + Math.cos(rad) * dist * scale;
                const y = cy + Math.sin(rad) * dist * scale;
                ctx.fillRect(x,y,2,2);
            }
        }

        function drawGridOnly(cx, cy) {
            ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.beginPath();
            ctx.arc(cx, cy, 1*scale, 0, Math.PI*2); ctx.stroke();
            ctx.beginPath(); ctx.arc(cx, cy, 2*scale, 0, Math.PI*2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height); ctx.stroke();
        }
        drawGridOnly(400,400);
    </script>
</body>
</html>
`;

// --- 초기화 시퀀스 (로그 기반 재구현) ---
async function runLogBasedInit() {
    console.log('[Init] Starting Sequence based on Log Analysis...');

    lidar.sendCommand('SensorScanInfo');
    await delay(100);

    lidar.sendCommand('LSDIConfig');
    await delay(50);

    lidar.sendCommand('LSDOConfig');
    await delay(50);

    lidar.sendCommand('LSFConfig');
    await delay(50);

    lidar.sendCommand('LSScanDataConfig');
    await delay(100);

    lidar.sendCommand('LSTeachingConfig');
    await delay(50);

    // 로그인 및 스캔 시작 (초기화 마무리)
    console.log('[Init] Sending Login & Start...');
    lidar.sendCommand('SetAccessLevel,0000');
    await delay(100);
    lidar.sendCommand('SensorStart');

    console.log('[Init] Sequence Completed.');
}

// --- API 라우트 ---

fastify.get('/', async (req, reply) => reply.type('text/html').send(indexHtml));

fastify.post<{ Body: { ip: string; port?: number } }>('/connect', async (request, reply) => {
    const { ip, port } = request.body;
    try {
        if (!lidar.isConnected()) {
            await lidar.connect(ip, port || 8000);
            runLogBasedInit().catch(err => console.error('Init failed:', err));
        }
        return { status: 'connected' };
    } catch (err: any) {
        return { status: 'error', message: err.message };
    }
});

fastify.post('/disconnect', async (request, reply) => {
    if (lidar.isConnected()) {
        lidar.sendCommand('SensorStop');
        setTimeout(() => lidar.disconnect(), 100);
    }
    return { status: 'disconnected' };
});

fastify.get('/scan', async (request, reply) => {
    if (!lidar.isConnected()) return { status: 'error', message: 'Not connected' };
    if (!latestScanData) return { status: 'waiting_for_data' };
    return latestScanData;
});

// [핵심 수정] 스캔 설정 API (요청한 시퀀스 적용)
fastify.post<{ Body: { min: number; max: number } }>('/config/scan', async (request, reply) => {
    const { min, max } = request.body;
    if (!lidar.isConnected()) return { status: 'error', message: 'Not connected' };

    try {
        console.log(`[Config] Sequence Start: Min ${min}° ~ Max ${max}°`);

        // 1. SetAccessLevel (로그인)
        // 로그 기반: 보통 Command 응답까지 약 50~100ms 소요
        console.log('1. SetAccessLevel,0000');
        lidar.sendCommand('SetAccessLevel,0000');
        await delay(100);

        // 2. LSScanDataConfig (설정 전송)
        // UI에서 입력받은 Min/Max 값을 16진수로 변환하여 전송
        // Output Period는 로그 기반값인 '1' 사용
        const startVal = Math.round(min * 10000);
        const endVal = Math.round(max * 10000);
        const configCmd = `LSScanDataConfig,${toHex(startVal)},${toHex(endVal)},1,1,1`;

        console.log(`2. Sending Config: ${configCmd}`);
        lidar.sendCommand(configCmd);
        await delay(200); // 설정 쓰기(sWC)는 읽기보다 시간이 더 필요함

        // 3. SensorStop (설정 적용을 위한 정지)
        console.log('3. SensorStop');
        lidar.sendCommand('SensorStop');
        await delay(500); // 정지 후 내부 상태 안정화 대기 (로그의 긴 갭 반영)

        // 4. SensorStart (재시작)
        console.log('4. SensorStart');
        lidar.sendCommand('SensorStart');

        return { status: 'success', command: configCmd };
    } catch (err: any) {
        console.error(err);
        return { status: 'error', message: err.message };
    }
});

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