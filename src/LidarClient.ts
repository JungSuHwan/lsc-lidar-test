import Fastify, { FastifyInstance } from 'fastify';
import { ILidarDriver, StandardLidarDriver, ScanData } from './LidarDriver';

const fastify: FastifyInstance = Fastify({ logger: true });

// --- 다중 센서 상태 관리 ---
interface TransformConfig {
    x: number;        // Global X (meter)
    y: number;        // Global Y (meter)
    rotation: number; // Global Rotation (degree)
    color: string;    // Display Color
}

interface SensorContext {
    driver: ILidarDriver;
    data: ScanData | null;
    ip: string;
    port: number;
    config: TransformConfig;
}

// 센서 ID를 키로 하여 관리
const sensors = new Map<number, SensorContext>();
let nextSensorId = 1;

// 색상 팔레트 (빨간색은 임계값 표시용으로 예약)
const COLORS = ['#FF8800', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- 웹 대시보드 HTML ---
const indexHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
    <title>Multi-Lidar Fusion Dashboard</title>
    <style>
        * { box-sizing: border-box; }
        body { background-color: #121212; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; margin: 0; padding: 0; display: flex; height: 100vh; width: 100vw; overflow: hidden; }
        
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
        #main-area { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; position: relative; }
        
        /* 통합 뷰 (Merged View) */
        #merged-container { flex: 2; background: #000; border-bottom: 2px solid #333; position: relative; display: flex; justify-content: center; align-items: center; min-height: 0; overflow: hidden; }
        #merged-canvas { background: #080808; cursor: crosshair; display: block; max-width: 100%; max-height: 100%; }
        .view-label { position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.7); padding: 5px 10px; border-radius: 4px; font-weight: bold; color: #00afff; pointer-events: none; }

        /* 개별 센서 그리드 */
        #grid-container { flex: 1; padding: 10px; overflow-x: hidden; overflow-y: auto; background: #121212; border-top: 1px solid #444; min-height: 0; }
        #dashboard-grid { display: flex; flex-wrap: wrap; gap: 10px; }
        
        /* 개별 센서 카드 */
        .sensor-card { 
            background: #1a1a1a; border: 1px solid #333; border-radius: 6px; 
            width: 250px; height: 300px; display: flex; flex-direction: column; 
            position: relative; transition: all 0.2s; cursor: crosshair;
        }
        .sensor-card.selected { border: 2px solid #00afff; box-shadow: 0 0 15px rgba(0, 175, 255, 0.4); transform: translateY(-2px); }
        
        .card-header { padding: 8px; background: #252525; border-bottom: 1px solid #333; font-size: 0.85rem; display: flex; justify-content: space-between; pointer-events: none; }
        .card-body { flex: 1; background: #000; position: relative; pointer-events: none; }
        .card-canvas { width: 100%; height: 100%; display: block; }
        
        #empty-msg { width: 100%; text-align: center; color: #444; margin-top: 20px; }

        /* 툴팁 스타일 */
        #canvas-tooltip {
            position: absolute; 
            display: none; 
            background: rgba(0, 0, 0, 0.85); 
            color: #00afff; 
            padding: 8px 12px; 
            border-radius: 4px; 
            font-size: 12px; 
            pointer-events: none; 
            z-index: 9999;
            border: 1px solid #00afff;
            box-shadow: 0 0 10px rgba(0,175,255,0.4);
            line-height: 1.5;
            white-space: nowrap;
        }
    </style>
</head>
<body>
    <div id="canvas-tooltip"></div>

    <div id="sidebar">
        <h2 style="margin-top:0">Connection</h2>
        <div class="control-group">
            <div class="input-row">
                <input type="text" id="new-ip" value="127.0.0.1" placeholder="IP Address">
                <input type="number" id="new-port" value="8001" placeholder="Port" style="width: 50px;">
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
            <div style="margin-top:12px; border-top:1px solid #444; padding-top:12px;">
                <div class="input-row">
                    <label style="width:auto;">Threshold (m)</label>
                    <input type="number" id="threshold-val" value="0" min="0" step="0.5" style="width:80px;">
                </div>
                <button class="danger" onclick="updateThreshold()" style="margin-top:5px;">Apply Threshold</button>
                <div id="threshold-status" style="margin-top:5px; font-size:0.8rem; color:#888;">Threshold: OFF</div>
            </div>
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
        let scale = 15; 
        let selectedSensorId = null;
        let isLooping = false;
        let sensorsData = {}; 
        let threshold = 0; // 임계값 (0이면 OFF)

        const mergedCanvas = document.getElementById('merged-canvas');
        const mergedCtx = mergedCanvas.getContext('2d');
        const tooltip = document.getElementById('canvas-tooltip');

        function resizeCanvas() {
            const container = document.getElementById('merged-container');
            const rect = container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            
            // 실제 표시 크기
            const displayWidth = rect.width;
            const displayHeight = rect.height;
            
            // 캔버스 내부 해상도 (고해상도 디스플레이 대응)
            mergedCanvas.width = displayWidth * dpr;
            mergedCanvas.height = displayHeight * dpr;
            
            // CSS 크기 설정
            mergedCanvas.style.width = displayWidth + 'px';
            mergedCanvas.style.height = displayHeight + 'px';
            
            // 스케일 조정 (고해상도 대응)
            mergedCtx.scale(dpr, dpr);
        }
        
        // ResizeObserver로 컨테이너 크기 변경 감지 (줌 포함)
        const resizeObserver = new ResizeObserver(() => {
            resizeCanvas();
        });
        resizeObserver.observe(document.getElementById('merged-container'));
        
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        function init() {
            isLooping = true;
            loop();
        }

        // --- 툴팁 표시 함수 (공통 사용) ---
        function showTooltip(e, title, dist, angle, x, y) {
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX + 15) + 'px';
            tooltip.style.top = (e.clientY + 15) + 'px';
            tooltip.innerHTML = \`
                <div style="font-weight:bold; color:white; border-bottom:1px solid #444; margin-bottom:4px;">\${title}</div>
                <b>Dist:</b> \${dist.toFixed(3)} m<br>
                <b>Angle:</b> \${angle.toFixed(1)}°<br>
                <span style="color:#888; font-size:11px;">(X: \${x.toFixed(2)}, Y: \${y.toFixed(2)})</span>
            \`;
        }

        // --- Merged Canvas 마우스 이벤트 ---
        mergedCanvas.addEventListener('mousemove', (e) => {
            const rect = mergedCanvas.getBoundingClientRect();
            // CSS 표시 크기 기준 좌표 계산
            const canvasDisplayWidth = rect.width;
            const canvasDisplayHeight = rect.height;
            // 캔버스 중앙 기준 좌표 (픽셀)
            const mx = (e.clientX - rect.left) - canvasDisplayWidth / 2;
            const my = canvasDisplayHeight / 2 - (e.clientY - rect.top); // Y축 반전
            
            // 물리 좌표 (m)
            const realX = mx / scale;
            const realY = my / scale;

            // 거리 및 각도 계산
            const dist = Math.sqrt(realX*realX + realY*realY);
            let angle = Math.atan2(realY, realX) * (180 / Math.PI);
            if(angle < 0) angle += 360;

            showTooltip(e, "Global Merged View", dist, angle, realX, realY);
        });

        mergedCanvas.addEventListener('mouseout', () => {
            tooltip.style.display = 'none';
        });

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
            await fetch('/config/transform', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    id: selectedSensorId, 
                    x: parseFloat(document.getElementById('tf-x').value), 
                    y: parseFloat(document.getElementById('tf-y').value), 
                    rotation: parseFloat(document.getElementById('tf-rot').value) 
                })
            });
        }

        async function applyConfig() {
            if(!selectedSensorId) return alert("Select a sensor");
            await fetch('/config/scan', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    id: selectedSensorId, 
                    min: parseFloat(document.getElementById('scan-min').value), 
                    max: parseFloat(document.getElementById('scan-max').value) 
                })
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

        function updateThreshold() {
            const val = parseFloat(document.getElementById('threshold-val').value);
            threshold = isNaN(val) || val <= 0 ? 0 : val;
            const statusEl = document.getElementById('threshold-status');
            if (threshold > 0) {
                statusEl.innerText = 'Threshold: ' + threshold.toFixed(1) + 'm (RED highlight)';
                statusEl.style.color = '#FF4444';
            } else {
                statusEl.innerText = 'Threshold: OFF';
                statusEl.style.color = '#888';
            }
        }

        function selectSensor(id) {
            selectedSensorId = id;
            if(sensorsData[id]) {
                const cfg = sensorsData[id].config;
                document.getElementById('tf-target-id').innerText = \`#\${id} (\${cfg.color})\`;
                document.getElementById('tf-target-id').style.color = cfg.color;
                document.getElementById('tf-x').value = cfg.x;
                document.getElementById('tf-y').value = cfg.y;
                document.getElementById('tf-rot').value = cfg.rotation;

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
                    const activeIds = new Set();
                    // 서버 응답 기준으로 sensorsData를 완전히 새로 구성
                    const newSensorsData = {};
                    data.sensors.forEach(s => {
                        newSensorsData[s.id] = s;
                        activeIds.add(s.id);
                    });
                    sensorsData = newSensorsData;
                    updateDashboardCards(data.sensors, activeIds);
                    drawMergedView();
                }
            } catch(e) {}
            requestAnimationFrame(loop);
        }

        function updateDashboardCards(sensorList, activeIds) {
            const grid = document.getElementById('dashboard-grid');
            const emptyMsg = document.getElementById('empty-msg');
            emptyMsg.style.display = sensorList.length === 0 ? 'block' : 'none';

            document.querySelectorAll('.sensor-card').forEach(card => {
                if (!activeIds.has(parseInt(card.dataset.id))) card.remove();
            });

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
                    
                    // --- 개별 카드 마우스 이벤트 추가 ---
                    card.addEventListener('mousemove', (e) => {
                        const rect = card.getBoundingClientRect();
                        const canvas = card.querySelector('canvas');
                        // 카드 캔버스 중앙 기준 (250x270 -> 125, 135)
                        const cx = 125;
                        const cy = 135;
                        const mx = (e.clientX - rect.left) - cx;
                        const my = cy - (e.clientY - rect.top); // Y축 반전
                        
                        // 카드 뷰 스케일은 전체 스케일의 절반 (scale/2) 사용 중
                        const localScale = scale / 2;
                        const realX = mx / localScale;
                        const realY = my / localScale;

                        const dist = Math.sqrt(realX*realX + realY*realY);
                        let angle = Math.atan2(realY, realX) * (180 / Math.PI);
                        if(angle < 0) angle += 360;

                        showTooltip(e, "Local Sensor #" + s.id, dist, angle, realX, realY);
                        e.stopPropagation(); // 부모 캔버스 이벤트 방지
                    });

                    card.addEventListener('mouseout', () => {
                        tooltip.style.display = 'none';
                    });
                    
                    grid.appendChild(card);
                }
                
                if(s.data) {
                    const ctx = card.querySelector('canvas').getContext('2d');
                    drawLocalSensor(ctx, s.data, 250, 270, s.config.color);
                }
            });
        }

        function drawMergedView() {
            // CSS 표시 크기 사용 (DPR 보정 전)
            const rect = mergedCanvas.getBoundingClientRect();
            const w = rect.width;
            const h = rect.height;
            const cx = w / 2;
            const cy = h / 2;
            
            // 캔버스 클리어 (실제 내부 해상도로)
            mergedCtx.clearRect(0, 0, mergedCanvas.width, mergedCanvas.height);

            mergedCtx.fillStyle = '#080808';
            mergedCtx.fillRect(0, 0, w, h);

            mergedCtx.strokeStyle = '#222';
            mergedCtx.lineWidth = 1;
            mergedCtx.beginPath();
            for(let r=1; r*scale < Math.max(w,h)/1.5; r++) {
                mergedCtx.moveTo(cx + r*scale, cy);
                mergedCtx.arc(cx, cy, r*scale, 0, Math.PI*2);
            }
            mergedCtx.moveTo(0, cy); mergedCtx.lineTo(w, cy);
            mergedCtx.moveTo(cx, 0); mergedCtx.lineTo(cx, h);
            mergedCtx.stroke();

            Object.values(sensorsData).forEach(sensor => {
                if(!sensor.data) return;
                const cfg = sensor.config;
                const scan = sensor.data;

                mergedCtx.fillStyle = cfg.color;
                const sensorScreenX = cx + cfg.x * scale;
                const sensorScreenY = cy - cfg.y * scale;
                mergedCtx.fillRect(sensorScreenX - 3, sensorScreenY - 3, 6, 6);
                
                const startAngle = scan.angleBegin / 10000.0;
                const stepAngle = scan.angleResol / 10000.0;
                const sensorRotRad = cfg.rotation * (Math.PI / 180);

                for(let i=0; i<scan.ranges.length; i++) {
                    const dist = scan.ranges[i];
                    if(dist < 0.05) continue;
                    const angleRad = (startAngle + i*stepAngle) * (Math.PI / 180);
                    const localX = dist * Math.cos(angleRad);
                    const localY = dist * Math.sin(angleRad);
                    const rotX = localX * Math.cos(sensorRotRad) - localY * Math.sin(sensorRotRad);
                    const rotY = localX * Math.sin(sensorRotRad) + localY * Math.cos(sensorRotRad);
                    const globalX = rotX + cfg.x;
                    const globalY = rotY + cfg.y;

                    // 임계값 체크: 센서 기준 거리가 임계값 이내이면 빨간색
                    if (threshold > 0 && dist <= threshold) {
                        mergedCtx.fillStyle = '#FF0000';
                    } else {
                        mergedCtx.fillStyle = cfg.color;
                    }
                    mergedCtx.fillRect(cx + globalX * scale, cy - globalY * scale, 2, 2);
                }
            });
        }

        function drawLocalSensor(ctx, data, w, h, color) {
            const cx = w/2, cy = h/2;
            ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(0,0,w,h);
            const start = data.angleBegin / 10000.0;
            const step = data.angleResol / 10000.0;
            for(let i=0; i<data.ranges.length; i++) {
                const dist = data.ranges[i];
                if(dist < 0.05) continue;
                const rad = (start + i*step) * (Math.PI/180);
                // 임계값 체크: 거리가 임계값 이내이면 빨간색
                if (threshold > 0 && dist <= threshold) {
                    ctx.fillStyle = '#FF0000';
                } else {
                    ctx.fillStyle = color;
                }
                // 개별 뷰는 공간이 작으므로 scale/2 사용
                ctx.fillRect(cx + Math.cos(rad)*dist*(scale/2), cy - Math.sin(rad)*dist*(scale/2), 2, 2); 
            }
        }
        init();
    </script>
</body>
</html>
`;

async function runLogBasedInit(driver: ILidarDriver, id: number) {
    try {
        await driver.initialize();
    } catch (e) { console.error(e); }
}

// --- API 라우트 ---
fastify.get('/', async (req, reply) => reply.type('text/html').send(indexHtml));

fastify.post<{ Body: { ip: string; port?: number } }>('/connect', async (request, reply) => {
    const { ip, port } = request.body;
    const targetPort = port || 8000;
    for (const [sId, ctx] of sensors) {
        if (ctx.ip === ip && ctx.port === targetPort) return { status: 'connected', message: 'Already connected', id: sId };
    }
    try {
        const id = nextSensorId++;
        const driver = new StandardLidarDriver();
        const config: TransformConfig = { x: 0, y: 0, rotation: 0, color: COLORS[(id - 1) % COLORS.length] };
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

fastify.post<{ Body: { id: number } }>('/disconnect', async (request, reply) => {
    const { id } = request.body;
    const context = sensors.get(id);
    if (context) {
        try { context.driver.disconnect(); } catch (e) { }
        sensors.delete(id);
    }
    return { status: 'disconnected', id };
});

fastify.get('/scan', async (request, reply) => {
    const result = [];
    for (const [id, ctx] of sensors) {
        result.push({ id: id, ip: ctx.ip, data: ctx.data, config: ctx.config });
    }
    return { sensors: result };
});

fastify.post<{ Body: { id: number; min: number; max: number } }>('/config/scan', async (request, reply) => {
    const { id, min, max } = request.body;
    const context = sensors.get(id);
    if (!context) return { status: 'error' };
    await context.driver.configureScanRange(min, max);
    return { status: 'success' };
});

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