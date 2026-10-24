import json
import re

def extract_directives():
    with open("docker_logs.txt", "r", encoding="utf-16") as f:
        logs = f.readlines()
        
    current_turn = None
    turn_directives = {}
    
    for line in logs:
        m = re.search(r'TURN (\d+): Candidate', line)
        if m:
            current_turn = int(m.group(1))
            
        if current_turn:
            if '"system_directive":' in line:
                m = re.search(r'"system_directive":\s*"([^"]+)"', line)
                if m:
                    turn_directives[current_turn] = m.group(1)
                    
    for t in sorted(turn_directives.keys()):
        print(f"Turn {t}: {turn_directives[t]}")

if __name__ == "__main__":
    extract_directives()
