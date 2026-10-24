import json
import re
from collections import defaultdict

def analyze_logs():
    with open("docker_logs_latest.txt", "r", encoding="utf-16") as f:
        logs = f.readlines()

    events = []
    directives = {}
    current_turn = None
    
    # Parse jsonl events and system directives
    for line in logs:
        m_turn = re.search(r'TURN (\d+): Candidate', line)
        if m_turn:
            current_turn = int(m_turn.group(1))

        if current_turn and '"system_directive":' in line:
            m_dir = re.search(r'"system_directive":\s*"([^"]+)"', line)
            if m_dir:
                directives[current_turn] = m_dir.group(1)

        if "[TURN_EVENT_JSONL]" in line:
            try:
                json_str = line.split("[TURN_EVENT_JSONL]")[1].strip()
                events.append(json.loads(json_str))
            except Exception:
                pass
                
    if not events:
        print("No events found.")
        return

    # Get the latest session token
    latest_session = events[-1]["session_token"]
    session_events = [e for e in events if e.get("session_token") == latest_session]
    
    print(f"=== Analysis for Session: {latest_session} ===")
    
    # 1. Rubric Coverage
    rubrics = set(e.get("rubric_active") for e in session_events if e.get("rubric_active"))
    print("\n1. RUBRIC COVERAGE")
    print(f"Unique Rubrics Touched: {rubrics}")
    
    last_event = session_events[-1]
    print(f"Final Action Mode: {last_event.get('action_mode')}")
    print(f"Incomplete Disconnect Flag: {last_event.get('incomplete_disconnect', 'NOT_FOUND')}")
    
    # 2. Foundational Question Quality
    print("\n2. FOUNDATIONAL QUESTION QUALITY")
    foundational_turns = [e for e in session_events if e.get("difficulty_tier") == "FOUNDATIONAL"]
    mismatches = [e for e in foundational_turns if e.get("tier_mismatch")]
    
    print(f"Total FOUNDATIONAL turns: {len(foundational_turns)}")
    print(f"Total Mismatches (tier_mismatch=true): {len(mismatches)} ({(len(mismatches)/len(foundational_turns))*100 if foundational_turns else 0:.1f}%)")
    
    for m in mismatches:
        t_id = m.get("turn_id")
        action = m.get("action_mode")
        print(f"  - Turn {t_id} ({action}):")
        print(f"    Directive: {directives.get(t_id, 'Not found')}")
        
    print("\n3. RUBRIC BUDGET (Turn count per rubric)")
    rubric_counts = defaultdict(int)
    for e in session_events:
        r = e.get("rubric_active")
        if r:
            rubric_counts[r] += 1
    for r, count in rubric_counts.items():
        print(f"  - {r}: {count} turns")

if __name__ == "__main__":
    analyze_logs()
