import re
import json
import sys

def parse_output():
    with open("test_interview_output.txt", "r", encoding="utf-16") as f:
        lines = f.readlines()
        
    transcript = []
    jsonl_events = []
    
    for line in lines:
        if line.startswith("Candidate: "):
            transcript.append(f"**Candidate:** {line[11:].strip()}")
        elif line.startswith("Interviewer: "):
            transcript.append(f"**Interviewer:** {line[13:].strip()}")
        elif '{"event_type":' in line:
            # try to parse json
            try:
                # Find the first {
                idx = line.find('{"event_type":')
                data = json.loads(line[idx:])
                jsonl_events.append(data)
            except:
                pass

    with open("test_interview_result.md", "w", encoding="utf-8") as f:
        f.write("# Interview Simulation Transcript\n\n")
        for turn in transcript:
            f.write(turn + "\n\n")
        
        f.write("\n\n# JSONL Turn Events\n\n")
        for evt in jsonl_events:
            f.write("```json\n")
            f.write(json.dumps(evt, indent=2))
            f.write("\n```\n\n")

if __name__ == "__main__":
    parse_output()
