import asyncio
import os
import sys

# Ensure local imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

os.environ["TURN_EVENT_JSONL"] = "true"
os.environ.setdefault("INTERVIEW_TRACE", "true")

from orchestrator_llm import _process_orchestrated_turn, InterviewSessionState
from llm_engine import LlmEngine
from topic_orchestrator import TopicOrchestrator
from session_audit import SessionAuditLedger

async def main():
    # Setup candidate profile
    tech_stack = "PHP, Python, ML"
    job_profile_context = {
        "resume_projects": "DSA World; Federated Learning"
    }
    
    # 1. Setup Engine
    engine = LlmEngine(tech_stack=tech_stack, phase="intro_verbal")
    engine.job_profile_context = job_profile_context
    engine.entry_level = True
    
    # 2. Setup State
    state = InterviewSessionState(
        "17890265863768470",
        "test_room",
        engine=engine,
        phase="intro_verbal"
    )
    state.resume_skills = ["PHP", "Python", "ML"]
    state.tech_stack = tech_stack
    
    # 3. Setup Orchestrator
    # We define a rubric to match what Brain expects
    state.rubric_criteria = [
        {"id": "ai_ml", "label": "AI/ML Fundamentals", "weight_pct": 50, "target_score": 8},
        {"id": "php_backend", "label": "PHP & Backend Development", "weight_pct": 50, "target_score": 8},
    ]
    
    orch = TopicOrchestrator(tech_stack=tech_stack, min_turns=5, max_turns=18)
    state.orchestrator = orch
    state.audit = SessionAuditLedger("17890265863768470", tech_stack)
    
    # The list of answers simulating the candidate
    # Turn 1 is empty user_text (just asking for the opening question)
    answers = [
        "", # Turn 1 (Opening)
        "I approach problems by first understanding the data. If it's a tabular dataset with clear relationships, traditional statistical models like XGBoost or Logistic Regression often work best and are highly interpretable. I only move to deep learning architectures if the data is unstructured, like images or text, or if there are complex non-linear patterns that simpler models miss.", # STRONG answer
        "I don't know much about clustering, to be honest.", # WEAK / IDK
        "Um, I'm still not sure about clustering or how to validate it. I haven't used it.", # IDK (Escape test)
        "For my DSA World project, I used PHP and MySQL for the backend to manage user profiles and submission tracking. When I added new features, I just used phpMyAdmin to alter the tables directly. I didn't really use migration scripts.", # WEAK / Resume mention
        "Yes, federated learning was challenging. We trained local models on decentralized chest X-ray datasets. By aggregating the model weights instead of the raw data, we preserved patient privacy while still benefiting from a globally shared model. The aggregation was done using federated averaging.", # STRONG answer
        "I'm not sure what the exact drawbacks of federated averaging are. Maybe it's slow?", # WEAK
    ]
    
    # Loop over the turns
    for turn_idx, answer in enumerate(answers):
        # We must increment the orchestrator turn, except OrchestratorLLM actually increments it inside evaluate_and_decide? No, it's driven by `current_turn` tracking.
        if turn_idx == 0:
            orch.current_turn = 1
        else:
            orch.current_turn += 1
            
        print(f"\n=================== TURN {orch.current_turn} ===================")
        if answer:
            print(f"Candidate: {answer}")
        
        reply = await _process_orchestrated_turn(state, user_text=answer, confidence=1.0)
        print(f"Interviewer: {reply}")
        
        # Manually append to history since _process_orchestrated_turn relies on external loop to append user/assistant
        if answer:
            engine.chat_history.append({"role": "user", "content": answer})
        engine.chat_history.append({"role": "assistant", "content": reply})
        
        if state.assessment.conversational_done_event.is_set():
            print("--- INTERVIEW CONCLUDED ---")
            break
            
if __name__ == "__main__":
    asyncio.run(main())
