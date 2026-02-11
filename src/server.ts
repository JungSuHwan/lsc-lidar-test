import Fastify, { FastifyInstance } from 'fastify';
import { LidarDriver, ScanData } from './LidarDriver';

const fastify: FastifyInstance = Fastify({ logger: true });

// --- 다중 센서 상태 관리 ---
interface TransformConfig {
    x: number;        // Global X (meter)
    y: number;        // Global Y (meter)
    rotation: number; // Global Rotation (degree)
    color: string;    // Display Color
}

interface SensorContext {
    driver: LidarDriver;
    data: ScanData | null;
    ip: string;
    port: number;
    config: TransformConfig; // 위치 보정 정보 추가
}

// 센서 ID를 키로 하여 관리
const sensors = new Map<number, SensorContext>();
let nextSensorId = 1;

// 색상 팔레트
const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function toHex(num: number): string {
    return (num >>> 0).toString(16).toUpperCase();
}

// --- 웹 대시보드 HTML ---
const indexHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Multi-Lidar Fusion Dashboard</title>
    <style>
        body { background-color: #121212; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; margin: 0; display: flex; height: 100vh; overflow: hidden; }
        
        /* 사이드바 */
        #sidebar { width: 340px; background-color: #1e1e1e; padding: 20px; display: flex; flex-direction: column; border-right: 1px solid #333; z-index: 10; overflow-y: auto; }
        h2 { border-bottom: 2px solid #007bff; padding-bottom: 10px; font-size: 1.1rem; margin-top: 20px; }
        
        .control-group { background: #2c2c2c; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #333; }
        .input-row { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; justify-content: space-between; }
        .input-row label { font-size: 0.9rem; color: #aaa; width: 60px; }
        input[type="text"], input[type="number"] { background: #333; border: 1px solid #444; color: white; padding: 6px; border-radius: 4px; flex: 1; text-align: center; }
        
        button { width: 100%; padding: 10px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 5px; color: white; transition: 0.2s; }
        button.primary { background: #007bff; } button.primary:hover { background: #0056b3; }
        button.danger { background: #dc3545; } button.danger:hover { background: #a71d2a; }
        button.success { background: #28a745; } button.success:hover { background: #218838; }

        /* 메인 영역 */
        #main-area { flex: 1; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
        
        /* 통합 뷰 (Merged View) */
        #merged-container { flex: 2; background: #000; border-bottom: 2px solid #333; position: relative; display: flex; justify-content: center; align-items: center; }
        #merged-canvas { background: #080808; box-shadow: inset 0 0 50px rgba(0,0,0,0.8); }
        .view-label { position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.7); padding: 5px 10px; border-radius: 4px; font-weight: bold; color: #00afff; pointer-events: none; }

        /* 개별 센서 그리드 */
        #grid-container { flex: 1; padding: 10px; overflow-y: auto; background: #121212; border-top: 1px solid #444; }
        #dashboard-grid { display: flex; flex-wrap: wrap; gap: 10px; }
        
        /* 개별 센서 카드 */
        .sensor-card { 
            background: #1a1a1a; border: 1px solid #333; border-radius: 6px; 
            width: 250px; height: 300px; display: flex; flex-direction: column; 
            position: relative; transition: all 0.2s;
        }
        .sensor-card.selected { border: 2px solid #00afff; box-shadow: 0 0 15px rgba(0, 175, 255, 0.4); transform: translateY(-2px); }
        
        .card-header { padding: 8px; background: #252525; border-bottom: 1px solid #333; font-size: 0.85rem; display: flex; justify-content: space-between; }
        .card-body { flex: 1; background: #000; position: relative; }
        .card-canvas { width: 100%; height: 100%; display: block; }
        
        #empty-msg { width: 100%; text-align: center; color: #444; margin-top: 20px; }
    </style>
</head>
<body>
    <div id="sidebar">
        <h2 style="margin-top:0">Connection</h2>
        <div class="control-group">
            <div class="input-row">
                <input type="text" id="new-ip" value="192.168.0.10" placeholder="IP Address">
                <input type="number" id="new-port" value="8000" placeholder="Port" style="width: 50px;">
            </div>
            <button class="primary" onclick="addSensor()">+ Connect Sensor</button>
        </div>

        <h2>Transform (Fusion)</h2>
        <div class="control-group">
            <div style="margin-bottom:10px; font-size:0.9rem; color:#00afff;">
                Selected: <span id="tf-target-id" style="font-weight:bold; color:#fff;">None</span>
            </div>
            <div class="input-row"><label>X (m)</label><input type="number" id="tf-x" value="0" step="0.1"></div>
            <div class="input-row"><label>Y (m)</label><input type="number" id="tf-y" value="0" step="0.1"></div>
            <div class="input-row"><label>Rot (°)</label><input type="number" id="tf-rot" value="0" step="1"></div>
            <button class="success" onclick="applyTransform()">Update Transform</button>
        </div>

        <h2>Scan Config</h2>
        <div class="control-group">
             <div class="input-row"><label>Min(°)</label><input type="number" id="scan-min" placeholder="-45" step="1"></div>
             <div class="input-row"><label>Max(°)</label><input type="number" id="scan-max" placeholder="225" step="1"></div>
             <button class="primary" onclick="applyConfig()">Apply Scan Range</button>
             <button class="danger" onclick="disconnectSelected()" style="margin-top:5px;">Disconnect</button>
        </div>

        <h2>View Settings</h2>
        <div class="control-group">
            <label>Zoom (px/m): <span id="scale-val">15</span></label>
            <input type="range" min="5" max="300" value="15" style="width:100%" oninput="updateScale(this.value)">
        </div>
    </div>

    <div id="main-area">
        <div id="merged-container">
            <div class="view-label">Global Merged Map</div>
            <canvas id="merged-canvas"></canvas>
        </div>
        
        <div id="grid-container">
            <div id="dashboard-grid">
                <div id="empty-msg">No sensors connected.</div>
            </div>
        </div>
    </div>

    <script>
        // --- 전역 상태 ---
        let scale = 15; // px per meter (25m 반경을 위해 축소)
        let selectedSensorId = null;
        let isLooping = false;
        
        // 데이터 저장소
        // sensorsData 구조: { [id]: { config: {x,y,rot,color}, data: ScanData } }
        let sensorsData = {}; 

        const mergedCanvas = document.getElementById('merged-canvas');
        const mergedCtx = mergedCanvas.getContext('2d');

        // 캔버스 크기 조정 (반응형)
        function resizeCanvas() {
            const container = document.getElementById('merged-container');
            mergedCanvas.width = container.clientWidth;
            mergedCanvas.height = container.clientHeight;
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        function init() {
            isLooping = true;
            loop();
        }

        // --- API 호출 함수들 ---
        async function addSensor() {
            const ip = document.getElementById('new-ip').value;
            const port = document.getElementById('new-port').value;
            try {
                const res = await fetch('/connect', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ ip, port: parseInt(port) })
                });
                const data = await res.json();
                if(data.status !== 'connected') alert(data.message);
            } catch(e) { alert('Conn Error'); }
        }

        async function applyTransform() {
            if(!selectedSensorId) return alert('Select a sensor first');
            const x = parseFloat(document.getElementById('tf-x').value);
            const y = parseFloat(document.getElementById('tf-y').value);
            const rot = parseFloat(document.getElementById('tf-rot').value);

            await fetch('/config/transform', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ id: selectedSensorId, x, y, rotation: rot })
            });
        }

        async function applyConfig() {
            if(!selectedSensorId) return alert("Select a sensor");
            const min = parseFloat(document.getElementById('scan-min').value);
            const max = parseFloat(document.getElementById('scan-max').value);
            
            await fetch('/config/scan', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ id: selectedSensorId, min, max })
            });
            alert('Scan config sent!');
        }

        async function disconnectSelected() {
            if(!selectedSensorId || !confirm('Disconnect ID ' + selectedSensorId + '?')) return;
            await fetch('/disconnect', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ id: selectedSensorId })
            });
            selectedSensorId = null;
            document.getElementById('tf-target-id').innerText = 'None';
        }

        function updateScale(val) {
            scale = parseInt(val);
            document.getElementById('scale-val').innerText = scale;
        }

        // --- UI 상호작용 ---
        function selectSensor(id) {
            selectedSensorId = id;
            
            // 데이터가 있으면 입력창 채우기
            if(sensorsData[id]) {
                const cfg = sensorsData[id].config;
                document.getElementById('tf-target-id').innerText = \`#\${id} (\${cfg.color})\`;
                document.getElementById('tf-target-id').style.color = cfg.color;
                
                document.getElementById('tf-x').value = cfg.x;
                document.getElementById('tf-y').value = cfg.y;
                document.getElementById('tf-rot').value = cfg.rotation;

                // 스캔 범위도 업데이트 (데이터가 있을 시)
                const sData = sensorsData[id].data;
                if(sData) {
                    const min = sData.angleBegin / 10000.0;
                    const resol = sData.angleResol / 10000.0;
                    const count = sData.amountOfData;
                    const max = min + (count - 1) * resol;
                    document.getElementById('scan-min').value = min.toFixed(1);
                    document.getElementById('scan-max').value = max.toFixed(1);
                }
            }

            // 하이라이트 처리
            document.querySelectorAll('.sensor-card').forEach(el => el.classList.remove('selected'));
            const card = document.getElementById('card-' + id);
            if(card) card.classList.add('selected');
        }

        // --- 렌더링 루프 ---
        async function loop() {
            if(!isLooping) return;
            try {
                const res = await fetch('/scan');
                if(res.ok) {
                    const data = await res.json();
                    
                    // 데이터 전처리 및 저장
                    const activeIds = new Set();
                    data.sensors.forEach(s => {
                        sensorsData[s.id] = s;
                        activeIds.add(s.id);
                    });

                    // UI 업데이트
                    updateDashboardCards(data.sensors, activeIds);
                    drawMergedView(); // 통합 뷰 그리기
                }
            } catch(e) {}
            requestAnimationFrame(loop);
        }

        // 1. 개별 카드 업데이트
        function updateDashboardCards(sensorList, activeIds) {
            const grid = document.getElementById('dashboard-grid');
            const emptyMsg = document.getElementById('empty-msg');
            
            emptyMsg.style.display = sensorList.length === 0 ? 'block' : 'none';

            // 죽은 센서 카드 제거
            document.querySelectorAll('.sensor-card').forEach(card => {
                const id = parseInt(card.dataset.id);
                if (!activeIds.has(id)) card.remove();
            });

            // 카드 생성 및 그리기
            sensorList.forEach(s => {
                let card = document.getElementById('card-' + s.id);
                if (!card) {
                    card = document.createElement('div');
                    card.className = 'sensor-card';
                    card.id = 'card-' + s.id;
                    card.dataset.id = s.id;
                    card.onclick = () => selectSensor(s.id);
                    card.innerHTML = \`
                        <div class="card-header">
                            <span style="color:\${s.config.color}; font-weight:bold;">● ID \${s.id}</span>
                            <span>\${s.ip}</span>
                        </div>
                        <div class="card-body"><canvas width="250" height="270"></canvas></div>
                    \`;
                    grid.appendChild(card);
                }
                
                // 개별 캔버스 그리기 (Local View)
                if(s.data) {
                    const ctx = card.querySelector('canvas').getContext('2d');
                    drawLocalSensor(ctx, s.data, 250, 270, s.config.color);
                }
            });
        }

        // 2. 통합 뷰 그리기 (핵심 로직)
        function drawMergedView() {
            const w = mergedCanvas.width;
            const h = mergedCanvas.height;
            const cx = w / 2;
            const cy = h / 2;

            // 초기화
            mergedCtx.fillStyle = '#080808';
            mergedCtx.fillRect(0, 0, w, h);

            // 그리드 (1m 단위)
            mergedCtx.strokeStyle = '#222';
            mergedCtx.lineWidth = 1;
            mergedCtx.beginPath();
            
            // 동심원
            for(let r=1; r*scale < Math.max(w,h)/1.5; r++) {
                mergedCtx.moveTo(cx + r*scale, cy);
                mergedCtx.arc(cx, cy, r*scale, 0, Math.PI*2);
            }
            // 십자선
            mergedCtx.moveTo(0, cy); mergedCtx.lineTo(w, cy);
            mergedCtx.moveTo(cx, 0); mergedCtx.lineTo(cx, h);
            mergedCtx.stroke();

            // 모든 센서 데이터 순회
            Object.values(sensorsData).forEach(sensor => {
                if(!sensor.data) return;

                const cfg = sensor.config; // {x, y, rotation, color}
                const scan = sensor.data;

                mergedCtx.fillStyle = cfg.color;
                
                // 센서 위치 표시
                const sensorScreenX = cx + cfg.x * scale;
                const sensorScreenY = cy - cfg.y * scale; // Y축 반전
                
                mergedCtx.fillRect(sensorScreenX - 3, sensorScreenY - 3, 6, 6); // 센서 본체
                
                // 포인트 클라우드 변환 및 그리기
                const startAngle = scan.angleBegin / 10000.0;
                const stepAngle = scan.angleResol / 10000.0;
                
                // 회전 라디안 변환 (Global Rotation)
                const sensorRotRad = cfg.rotation * (Math.PI / 180);

                for(let i=0; i<scan.ranges.length; i++) {
                    const dist = scan.ranges[i];
                    if(dist < 0.05) continue;

                    // 1. 로컬 극좌표 -> 로컬 직교좌표
                    const angleDeg = startAngle + (i * stepAngle);
                    const angleRad = angleDeg * (Math.PI / 180);
                    
                    const localX = dist * Math.cos(angleRad);
                    const localY = dist * Math.sin(angleRad);

                    // 2. 로컬 직교 -> 전역 직교 (회전 변환)
                    // x' = x*cos(t) - y*sin(t)
                    // y' = x*sin(t) + y*cos(t)
                    const rotX = localX * Math.cos(sensorRotRad) - localY * Math.sin(sensorRotRad);
                    const rotY = localX * Math.sin(sensorRotRad) + localY * Math.cos(sensorRotRad);

                    // 3. 평행 이동 (위치 보정)
                    const globalX = rotX + cfg.x;
                    const globalY = rotY + cfg.y;

                    // 4. 화면 좌표 변환 (Screen Mapping)
                    const screenX = cx + globalX * scale;
                    const screenY = cy - globalY * scale; // Y축은 위로 갈수록 +이므로 캔버스에선 뺌

                    mergedCtx.fillRect(screenX, screenY, 2, 2);
                }
            });
        }

        // 개별 뷰 (단순 로컬 좌표)
        function drawLocalSensor(ctx, data, w, h, color) {
            const cx = w/2, cy = h/2;
            ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(0,0,w,h); // Clear
            
            // 점 그리기
            ctx.fillStyle = color;
            const start = data.angleBegin / 10000.0;
            const step = data.angleResol / 10000.0;

            for(let i=0; i<data.ranges.length; i++) {
                const dist = data.ranges[i];
                if(dist < 0.05) continue;
                const rad = (start + i*step) * (Math.PI/180);
                // 1/2 축소해서 보여줌 (개별뷰는 작으니까)
                ctx.fillRect(cx + Math.cos(rad)*dist*(scale/2), cy + Math.sin(rad)*dist*(scale/2), 2, 2); 
            }
        }

        init();
    </script>
</body>
</html>
`;

// ... 기존 runLogBasedInit 함수는 그대로 사용 ...
async function runLogBasedInit(driver: LidarDriver, id: number) {
    try {
        driver.sendCommand('SetAccessLevel,0000');
        await delay(100);
        driver.sendCommand('SensorStart');
    } catch (e) { console.error(e); }
}

// --- API 라우트 ---

fastify.get('/', async (req, reply) => reply.type('text/html').send(indexHtml));

// 1. 연결
fastify.post<{ Body: { ip: string; port?: number } }>('/connect', async (request, reply) => {
    const { ip, port } = request.body;
    const targetPort = port || 8000;

    for (const [sId, ctx] of sensors) {
        if (ctx.ip === ip && ctx.port === targetPort) {
            return { status: 'connected', message: 'Already connected', id: sId };
        }
    }

    try {
        const id = nextSensorId++;
        const driver = new LidarDriver();

        // 초기 설정값 (색상 순환 할당)
        const config: TransformConfig = {
            x: 0, y: 0, rotation: 0,
            color: COLORS[(id - 1) % COLORS.length]
        };

        const context: SensorContext = { driver, data: null, ip, port: targetPort, config };

        driver.on('scan', (data: ScanData) => { context.data = data; });

        if (!driver.isConnected()) {
            await driver.connect(ip, targetPort);
            sensors.set(id, context);
            runLogBasedInit(driver, id).catch(err => console.error(err));
        }

        return { status: 'connected', id };
    } catch (err: any) {
        return { status: 'error', message: err.message };
    }
});

// 2. 연결 해제
fastify.post<{ Body: { id: number } }>('/disconnect', async (request, reply) => {
    const { id } = request.body;
    const context = sensors.get(id);
    if (context) {
        try { context.driver.disconnect(); } catch (e) {}
        sensors.delete(id);
    }
    return { status: 'disconnected', id };
});

// 3. 스캔 데이터 + 설정 반환
fastify.get('/scan', async (request, reply) => {
    const result = [];
    for (const [id, ctx] of sensors) {
        result.push({
            id: id,
            ip: ctx.ip,
            data: ctx.data,
            config: ctx.config // 위치 설정 정보 포함
        });
    }
    return { sensors: result };
});

// 4. 스캔 범위 설정
fastify.post<{ Body: { id: number; min: number; max: number } }>('/config/scan', async (request, reply) => {
    const { id, min, max } = request.body;
    const context = sensors.get(id);
    if (!context) return { status: 'error' };

    const startVal = Math.round(min * 10000);
    const endVal = Math.round(max * 10000);
    const cmd = `LSScanDataConfig,${toHex(startVal)},${toHex(endVal)},1,1,1`;
    
    context.driver.sendCommand('SetAccessLevel,0000');
    setTimeout(() => context.driver.sendCommand(cmd), 100);
    
    return { status: 'success' };
});

// 5. [신규] 위치/회전 설정 업데이트
fastify.post<{ Body: { id: number; x: number; y: number; rotation: number } }>('/config/transform', async (request, reply) => {
    const { id, x, y, rotation } = request.body;
    const context = sensors.get(id);
    
    if (context) {
        context.config.x = x;
        context.config.y = y;
        context.config.rotation = rotation;
        return { status: 'success', config: context.config };
    }
    return { status: 'error', message: 'Sensor not found' };
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