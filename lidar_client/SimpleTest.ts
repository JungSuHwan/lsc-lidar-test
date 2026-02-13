import { StandardLidarDriver, ScanData } from './LidarDriver';

// --- Configuration ---
const LIDAR_IP = '192.168.0.31'; // Target Lidar IP
const LIDAR_PORT = 8000;         // Target Lidar Port (Default: 8000)

async function main() {
    console.log(`[LidarTest] Starting simple test client...`);
    console.log(`[LidarTest] Target: ${LIDAR_IP}:${LIDAR_PORT}`);

    const driver = new StandardLidarDriver();

    // Statistics
    let frameCount = 0;
    let lastTime = Date.now();
    let totalPoints = 0;

    // 1. Setup Event Listeners
    driver.on('scan', (data: ScanData) => {
        frameCount++;
        totalPoints += data.amountOfData;

        // Log every 10 frames to avoid console spam, but show we are alive
        if (frameCount % 60 === 0) {
            console.log(`[Data] Scan #${data.scanCounter} | Points: ${data.amountOfData} | StartAngle: ${data.angleBegin / 10000}°`);
        }
    });

    driver.on('disconnected', () => {
        console.log('[LidarTest] Disconnected from sensor');
        process.exit(0);
    });

    driver.on('error', (err) => {
        console.error('[LidarTest] Error:', err.message);
    });

    // 2. Connect
    try {
        console.log('[LidarTest] Connecting...');
        await driver.connect(LIDAR_IP, LIDAR_PORT);
        console.log('[LidarTest] Connected!');

        // 3. Initialize Sensor (Essential High-level commands)
        console.log('[LidarTest] Initializing sensor...');
        await driver.initialize();
        console.log('[LidarTest] Sensor initialized. Waiting for data...');

    } catch (err) {
        console.error('[LidarTest] Failed to connect:', err);
        process.exit(1);
    }

    // 4. Performance Monitor Loop (1 second interval)
    setInterval(() => {
        const now = Date.now();
        const delta = (now - lastTime) / 1000;

        if (delta >= 1.0) {
            const fps = frameCount / delta;
            const pps = totalPoints / delta;

            console.log(`--- [Stats] FPS: ${fps.toFixed(2)} | Points/sec: ${Math.floor(pps)} ---`);

            if (fps < 5.0) {
                console.warn(`[WARNING] FPS is very low! (${fps.toFixed(2)}) - Check Network/CPU`);
            }

            // Reset counters
            frameCount = 0;
            totalPoints = 0;
            lastTime = now;
        }
    }, 1000);
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log('\n[LidarTest] Stopping...');
    process.exit(0);
});

main();
