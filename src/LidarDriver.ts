import net from 'net';
import { EventEmitter } from 'events';

export interface ScanData {
  scanCounter: number;
  scanFreq: number;
  measFreq: number;
  angleBegin: number;
  angleResol: number;
  amountOfData: number;
  ranges: number[];
  rssi: number[];
}

export class LidarDriver extends EventEmitter {
  private client: net.Socket;
  private connected: boolean = false;
  private buffer: Buffer = Buffer.alloc(0);

  private readonly STX = 0x02;
  private readonly ETX = 0x03;

  constructor() {
    super();
    this.client = new net.Socket();

    this.client.on('data', (data) => this.handleData(data as Buffer));
    this.client.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
      console.log('Lidar disconnected');
    });
    this.client.on('error', (err) => {
      console.error('Lidar Socket Error:', err);
      this.emit('error', err);
    });
  }

  public connect(host: string, port: number = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.connect(port, host, () => {
        this.connected = true;
        console.log(`Connected to Lidar at ${host}:${port}`);
        resolve();
      });
      this.client.on('error', (err) => reject(err));
    });
  }

  public disconnect() {
    this.client.destroy();
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  // [수정됨] C++ autolidar.cpp의 makeCommand 함수 로직을 그대로 구현
  public sendCommand(rawCmd: string) {
    if (!this.connected) return;

    // 1. 명령어 타입 결정 (C++ 코드 기반 매핑)
    let type = '';
    
    if (rawCmd.includes('SetAccessLevel') || rawCmd.includes('SensorStart') || rawCmd.includes('SensorStop')) {
        type = 'sMC';
    } else if (rawCmd.includes('SensorScanInfo') || rawCmd.includes('ScanDataConfig')) {
        type = 'sRC';
    } else if (rawCmd.includes('LSScanDataConfig')) {
        type = 'sWC'; // setScanAngle 함수 참조
    } else {
        type = 'sMC'; // 기본값
    }

    // 2. 페이로드 구성: "," + Type + "," + Command
    // 예: ,sMC,SetAccessLevel,0000
    const payloadStr = `,${type},${rawCmd}`;

    // 3. 전체 패킷 길이 계산
    // 구조: STX(1) + Length(4) + payloadStr + ETX(1)
    const totalLen = 1 + 4 + payloadStr.length + 1;

    // 4. 길이 필드 (4바이트 Hex String)
    const lenStr = totalLen.toString(16).toUpperCase().padStart(4, '0');

    // 5. 최종 패킷 생성
    // Format: [STX][L][L][L][L][,][s][M][C][,][C][m][d][...][ETX]
    const packetStr = `${lenStr}${payloadStr}`;
    const packetBuf = Buffer.alloc(1 + packetStr.length + 1);
    
    packetBuf[0] = this.STX;
    packetBuf.write(packetStr, 1);
    packetBuf[packetBuf.length - 1] = this.ETX;

    console.log(`Sending: [${packetStr}] (Total Len: ${totalLen})`);
    this.client.write(packetBuf);
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    let stxIndex = this.buffer.indexOf(this.STX);
    while (stxIndex !== -1) {
      const etxIndex = this.buffer.indexOf(this.ETX, stxIndex);
      
      if (etxIndex !== -1) {
        const packet = this.buffer.subarray(stxIndex + 1, etxIndex);
        this.parsePacket(packet);
        this.buffer = this.buffer.subarray(etxIndex + 1);
        stxIndex = this.buffer.indexOf(this.STX);
      } else {
        break;
      }
    }
  }

  private parsePacket(packet: Buffer) {
    const msg = packet.toString('ascii');
    
    // 응답 디버깅용 (어떤 응답이 오는지 확인)
    if (!msg.includes('DIST1')) {
        console.log('Sensor Response:', msg);
    }

    const fields = msg.split(',');

    // 데이터 패킷 확인
    if (fields.includes('ScanData') || fields.includes('sRA') || fields.includes('sSN')) { 
        if (msg.includes('DIST1')) {
             try {
                const scanData = this.parseScanData(fields);
                this.emit('scan', scanData);
            } catch (e) {
                console.error('Parsing error:', e);
            }
        }
    }
  }

  private parseScanData(fields: string[]): ScanData {
    const distIndex = fields.indexOf('DIST1');
    if (distIndex === -1) throw new Error('No DIST1 field');

    // 필드 인덱스 역추적
    const scanCounter = parseInt(fields[distIndex - 9], 16);
    const scanFreq = parseInt(fields[distIndex - 6], 16);
    const measFreq = parseInt(fields[distIndex - 5], 16);
    const angleBegin = parseInt(fields[distIndex - 4], 16);
    const angleResol = parseInt(fields[distIndex - 3], 16);
    const amountOfData = parseInt(fields[distIndex - 2], 16);

    const result: ScanData = {
      scanCounter, scanFreq, measFreq, angleBegin, angleResol, amountOfData,
      ranges: [], rssi: []
    };

    let idx = distIndex + 1;
    for (let i = 0; i < amountOfData; i++) {
      if (idx >= fields.length) break;
      result.ranges.push(parseInt(fields[idx++], 16) / 1000.0);
    }
    
    return result;
  }
}