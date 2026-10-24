import re
import json

def analyze():
    with open("docker_logs.txt", "r", encoding="utf-16") as f:
        logs = f.readlines()
        
    mismatches = 0
    mismatch_turns = []
    salvages = 0
    decision_failed = 0
    
    turns = []
    current_turn = None
    turn_data = {}
    jsonl_events = []
    
    for line in logs:
        if "tier_mismatch=" in line and "True" in line:
            mismatches += 1
            # Try to find turn from context if possible, or just log
            
        if "Decision validation failed" in line or "Interview Brain LLM validation failed" in line:
            decision_failed += 1
            
        if "field-level salvage" in line or "corrected from invalid value" in line or "salvaged" in line.lower():
            salvages += 1
            
        if '{"event_type": "turn_event"' in line:
            idx = line.find('{"event_type":')
            try:
                evt = json.loads(line[idx:])
                jsonl_events.append(evt)
            except:
                pass
                
        # Parse trace output
        m = re.search(r'TURN (\d+): Candidate', line)
        if m:
            if current_turn and turn_data:
                turns.append(turn_data)
            current_turn = int(m.group(1))
            turn_data = {"turn": current_turn}
            
        if current_turn:
            if '"understanding_level":' in line:
                m = re.search(r'"understanding_level":\s*"([^"]+)"', line)
                if m and "understanding_level" not in turn_data:
                    turn_data["understanding_level"] = m.group(1)
            
            if '"internal_score_10":' in line:
                m = re.search(r'"internal_score_10":\s*(\d+)', line)
                if m and "internal_score_10" not in turn_data:
                    turn_data["internal_score_10"] = int(m.group(1))
                    
            if '"difficulty":' in line:
                m = re.search(r'"difficulty":\s*"([^"]+)"', line)
                if m and "difficulty" not in turn_data:
                    turn_data["difficulty"] = m.group(1)
                    
            if "BUG FLAG: competency_desync" in line or "tier_mismatch=True" in line:
                if "tier_mismatch" not in turn_data:
                    turn_data["tier_mismatch"] = True
                    mismatch_turns.append(current_turn)
                    
            if "answer_verbatim" in line:
                m = re.search(r'"answer_verbatim":\s*"([^"]+)"', line)
                if m and "answer" not in turn_data:
                    turn_data["answer"] = m.group(1)
                    
            if "target_rubric" in line or "target_competency" in line:
                m = re.search(r'"target_rubric":\s*"([^"]+)"', line)
                if not m:
                    m = re.search(r'"target_competency":\s*"([^"]+)"', line)
                if m and "target_rubric" not in turn_data:
                    turn_data["target_rubric"] = m.group(1)

    if current_turn and turn_data:
        turns.append(turn_data)
        
    print(f"tier_mismatches: {mismatches} on turns {set(mismatch_turns)}")
    print(f"validation_failed: {decision_failed}")
    print(f"field_level_salvage: {salvages}")
    
    print("\n--- TURN PROGRESSION ---")
    for t in turns:
        print(t)
        
    # Write JSONL to file
    with open("extracted_turn_events.jsonl", "w") as f:
        for evt in jsonl_events:
            f.write(json.dumps(evt) + "\n")

if __name__ == "__main__":
    analyze()
