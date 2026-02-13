import socket
import time
import sys

# --- Configuration ---
LIDAR_IP = '192.168.0.33'
LIDAR_PORT = 8001
STX = b'\x02'
ETX = b'\x03'

def make_command(cmd):
    """
    Format: STX + Length(4bytes Hex) + , + Type + , + Command + ... + ETX
    """
    cmd_type = 'sMC'
    if 'SensorScanInfo' in cmd:
        cmd_type = 'sRC'
    elif cmd.startswith('LSScanDataConfig'):
        cmd_type = 'sWC' if ',' in cmd else 'sRC'
        
    payload = f",{cmd_type},{cmd}"
    # Length incl STX, LengthField(4), Payload, ETX
    total_len = 1 + 4 + len(payload) + 1
    len_str = f"{total_len:04X}"
    
    packet = STX + len_str.encode('ascii') + payload.encode('ascii') + ETX
    return packet

def main():
    print(f"[LidarTest] Target: {LIDAR_IP}:{LIDAR_PORT}")
    
    cnt = 0
    total_points = 0
    last_time = time.time()
    buffer = b""

    try:
        # Create Socket
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.settimeout(5.0)
        client.connect((LIDAR_IP, LIDAR_PORT))
        print("[LidarTest] Connected!")

        # Initialize Sensor
        print("[LidarTest] Sending Init Command...")
        client.send(make_command('SetAccessLevel,0000'))
        time.sleep(0.1)
        client.send(make_command('SensorStart'))
        print("[LidarTest] Init Sent. Waiting for data...")

        while True:
            try:
                data = client.recv(4096)
                if not data:
                    print("[LidarTest] Connection Closed by Server")
                    break
                
                buffer += data
                
                while True:
                    stx_idx = buffer.find(STX)
                    if stx_idx == -1:
                        # Keep only last few bytes just in case STX is split?
                        # Or discard garbage before STX.
                        # Simple approach: clear buffer if too large and no STX
                        if len(buffer) > 10000: buffer = b"" 
                        break
                    
                    etx_idx = buffer.find(ETX, stx_idx)
                    if etx_idx != -1:
                        # Found Packet
                        packet = buffer[stx_idx+1 : etx_idx]
                        buffer = buffer[etx_idx+1:]
                        
                        # Process minimal parsing for stats
                        # Check signatures using bytes directly (fast)
                        if b'DIST1' in packet and (b'ScanData' in packet or b'sSN' in packet):
                            cnt += 1
                            
                            # Simple parsing to get point count
                            # Header is before DIST1
                            try:
                                dist_idx = packet.find(b'DIST1')
                                header_part = packet[:dist_idx].decode('ascii')
                                fields = header_part.split(',')
                                # Remove empty trailing if any
                                if fields[-1] == '': fields.pop()
                                
                                # amountOfData is 2nd from last in header
                                points = int(fields[-2], 16)
                                total_points += points
                            except:
                                pass
                                
                    else:
                        # Incomplete packet, wait for next recv
                        break
            
            except socket.timeout:
                print("[LidarTest] Read Timeout...")
                continue
            except Exception as e:
                print(f"[LidarTest] Error: {e}")
                break

            # Stats Output
            now = time.time()
            delta = now - last_time
            if delta >= 1.0:
                fps = cnt / delta
                pps = total_points / delta
                print(f"--- [Stats] FPS: {fps:.2f} | Points/sec: {int(pps)} ---")
                
                if fps < 5.0 and cnt > 0:
                    print(f"[WARNING] Low FPS detected: {fps:.2f}")

                cnt = 0
                total_points = 0
                last_time = now

    except KeyboardInterrupt:
        print("\n[LidarTest] Stopped by User")
    except Exception as e:
        print(f"\n[LidarTest] Fatal Error: {e}")
    finally:
        try: client.close()
        except: pass

if __name__ == "__main__":
    main()
