"""Interview prompt templates for autonomous voice sessions."""

from __future__ import annotations

import re

from candidate_knowledge import QuestionSource, canonical_seniority_band, normalize_question_source
from topic_catalog import topic_display_name
from topic_orchestrator import ActionMode, OrchestratorAction

Phase = str  # "intro_verbal" | "hr_verbal" | "pre_assessment" | "closing"

def normalize_interview_language(raw: str | None) -> str:
    value = (raw or "").strip().lower().replace("_", "-")
    if value in {"hi", "hi-in", "hindi"}:
        return "hi-IN"
    return "en-IN"


def conduct_language_rule(language: str | None) -> str:
    if normalize_interview_language(language) == "hi-IN":
        return (
            "LANGUAGE LOCK: Conduct this entire interview in Hindi, written in Devanagari. "
            "Every question you ask must be Hindi. Technical terms may stay in English. "
            "The candidate may answer in Hindi, English, or a mix — understand the meaning. "
            "Do not switch the interview back to English."
        )
    return (
        "LANGUAGE LOCK: Conduct this entire interview in English. "
        "Ask every question in English."
    )


_HINDI_FIXED_LINES = {
    "Thank you for your time. You can now continue to the next rounds for the recruitment.": (
        "आपके समय के लिए धन्यवाद। अब आप भर्ती के अगले राउंड जारी रख सकते हैं।"
    ),
    "Thank you for completing the interview. We'll get back to you once your assessment has been evaluated.": (
        "इंटरव्यू पूरा करने के लिए धन्यवाद। असेसमेंट का मूल्यांकन होने के बाद हम आपसे संपर्क करेंगे।"
    ),
    "Welcome to the assessment round. We will now begin your assessment.": (
        "असेसमेंट राउंड में आपका स्वागत है। अब हम आपका असेसमेंट शुरू करेंगे।"
    ),
    "Thank you. That concludes this interview.": "धन्यवाद। यह इंटरव्यू यहीं समाप्त होता है।",
    "Thank you for sharing that. We will be in touch about next steps.": (
        "यह बताने के लिए धन्यवाद। अगले कदमों के बारे में हम आपसे संपर्क करेंगे।"
    ),
    "We are out of time for this round. Thank you for the conversation.": (
        "इस राउंड का समय पूरा हो गया है। बातचीत के लिए धन्यवाद।"
    ),
    "Thank you. That concludes the behavioural interview.": (
        "धन्यवाद। बिहेवियरल इंटरव्यू यहीं समाप्त होता है।"
    ),
    "Thanks for sharing that.": "यह बताने के लिए धन्यवाद।",
    "Got it, thank you.": "समझ गया, धन्यवाद।",
    "That's helpful - thank you.": "यह मददगार है, धन्यवाद।",
    "Appreciate the detail there.": "यह विवरण अच्छा रहा, धन्यवाद।",
    "I noticed your screen isn't shared yet. Please share your screen so we can open the assessment environment.": (
        "मैंने देखा कि आपकी स्क्रीन अभी शेयर नहीं हुई है। असेसमेंट शुरू करने के लिए कृपया अपनी स्क्रीन शेयर करें।"
    ),
    "Thank you — that covers what we needed for screening today. We'll continue with the next steps of the interview shortly.": (
        "धन्यवाद। Screening के लिए जो जानना था, वह आज पूरा हो गया। इंटरव्यू के अगले कदम हम जल्द ही जारी रखेंगे।"
    ),
    "Thank you — that covers what we needed for screening today.": (
        "धन्यवाद। Screening के लिए जो जानना था, वह आज पूरा हो गया।"
    ),
    "Thanks for sharing. Could you tell me a little more?": (
        "धन्यवाद। क्या आप इसके बारे में थोड़ा और बता सकते हैं?"
    ),
    "Could you tell me a bit more about that?": "क्या आप इसके बारे में थोड़ा और बता सकते हैं?",
    "Thanks — could you expand on that briefly?": "धन्यवाद। क्या आप इस पर थोड़ा और बता सकते हैं?",
    "We have covered the topics for this conversation. Thank you for your time. That completes this part of the interview.": (
        "हमने इस बातचीत के topics cover कर लिए हैं। आपके समय के लिए धन्यवाद। इंटरव्यू का यह हिस्सा यहीं पूरा होता है।"
    ),
    "We are wrapping up this session. Thank you for your time today. We will be in touch with the next steps shortly.": (
        "हम इस session को समाप्त कर रहे हैं। आज आपके समय के लिए धन्यवाद। अगले कदमों के बारे में हम जल्द ही संपर्क करेंगे।"
    ),
    "Thank you from my side, that concludes our interview. You have completed the assessment successfully.": (
        "मेरी तरफ से धन्यवाद, इससे हमारा इंटरव्यू समाप्त होता है। आपने असेसमेंट सफलतापूर्वक पूरा कर लिया है।"
    ),
    "Thank you. We have covered this conversation, and we will move on to the next part of the assessment.": (
        "धन्यवाद। हमने यह बातचीत cover कर ली है, और अब हम असेसमेंट के अगले हिस्से पर जाएंगे।"
    ),
    "Thank you for your time today. We covered several areas from your resume. We'll be in touch soon with the next steps.": (
        "आज आपके समय के लिए धन्यवाद। हमने आपके resume के कई topics cover किए। अगले कदमों के लिए हम जल्द ही संपर्क करेंगे।"
    ),
    "Thank you for your time today. We've covered the baseline areas we needed to discuss. This part of the interview is now complete.": (
        "आज आपके समय के लिए धन्यवाद। जिन topics पर बात करनी थी, वे cover हो गए। इंटरव्यू का यह हिस्सा अब पूरा हो गया है।"
    ),
    "Thank you for walking me through your Take-Home work. That completes the verification questions for this interview.": (
        "Take-home work समझाने के लिए धन्यवाद। इस इंटरव्यू के verification सवाल यहीं पूरे होते हैं।"
    ),
}


def speak_line(english: str, language: str | None) -> str:
    if normalize_interview_language(language) != "hi-IN":
        return english
    key = " ".join((english or "").split())
    return _HINDI_FIXED_LINES.get(key, english)


MULTILINGUAL_RULE = (
    "Candidates may choose to speak in English, their native language, or use a fluid mix "
    "of both (Code-Mixing). Do not correct or penalize language choices. Respond naturally "
    "by matching their linguistic tone, but keep evaluations focused purely on underlying "
    "core logic and competence."
)

INTERVIEWER_ROLE_RULE = (
    "Interviewer boundaries (mandatory): you are assessing the candidate, not teaching them. "
    "NEVER give answers, model answers, hints, definitions, explanations, examples, tips, advice, "
    "summaries of the topic, or preparation guidance — even if the candidate asks "
    "('tell me', 'what is the answer', 'can you explain'). "
    "If they explicitly ask you for the answer or ask you to explain a concept, state in one short polite sentence "
    "that you cannot share answers during the interview, then ask the next question. "
    "CRITICAL 'I DON'T KNOW' RULE: If the candidate simply states they do not know the answer, are unsure, or cannot recall "
    "(e.g., 'I don't know', 'no idea', 'not sure', 'actually I don't know about this answer'), "
    "they did NOT ask you to explain or provide the answer. Do NOT recite interview policy disclaimers or say 'I cannot share answers'. "
    "Simply transition smoothly and naturally, e.g.: 'No problem at all, let's explore another area of [Topic]: [Follow-up question]' "
    "or 'That's completely fine, let's look at another aspect: [Follow-up question]'. "
    "Keep acknowledgements short and neutral; do not add information about the topic. "
    "Stay in the interviewer role at all times: never act as an assistant, coach or tutor, "
    "never offer help, and never ask what they would like to focus on."
)

SYSTEM_STYLE = """Conversational style (mandatory):
- Act as an expert behavioral and technical interviewer. Frame technical questions naturally around the candidate's actual resume experience, making the interview feel like a peer-to-peer conversation rather than a rigid technical quiz.
- Begin with exactly ONE short neutral acknowledgement. Praise only when the answer was clearly strong.
- Then ask exactly ONE question about a single concept. Never ask compound or multi-part questions.
- QUESTION CALIBRATION BY SENIORITY & TIER:
  * For JUNIOR candidates or FOUNDATIONAL tier questions: Ask clear conceptual questions about core definitions, what a term means, why it is used, or the fundamental difference between two related concepts (e.g., "What is the difference between a list and a tuple in Python?", "What does immutability mean in Python?", "What is overfitting and why does it occur?", "What does an activation function do in a neural network?"). Prioritize testing foundational conceptual clarity and mechanics. Do not demand end-to-end production pipelines or multi-step architecture from junior candidates on foundational questions.
  * For MID-LEVEL and SENIOR candidates or APPLIED/DESIGN tiers: Ground the question in a concrete scenario or trade-off based on the job responsibilities. Do not ask bare dictionary definitions ("What is X?"). Ground broad competencies in concrete engineering tasks and trade-offs.
- CONCRETE SCENARIOS FOR SENIOR/MID: When introducing or probing any competency for Mid/Senior roles (especially broad ones like Deep Learning, Machine Learning, System Design, or Cloud), ground the question in a lightweight, concrete scenario with clear stages/tasks (e.g., "Suppose you are tasked with building an image classification pipeline for defect detection. Walk me through the stages you'd follow, from dataset preparation and architecture choice to model evaluation."). For Juniors, prioritize conceptual clarity, definitions, and fundamental mechanisms.
- HANDLING "I DON'T KNOW": If the candidate states they do not know the answer, do not recite interview policy disclaimers or robotic phrases like "I cannot share answers". Simply transition smoothly and naturally without answering the question, e.g.: "No problem at all, let's explore another area of [Topic]: [Follow-up question]".
- CRITICAL: Never use repetitive stock phrases like "Let's step back", "Let's go back to basics", or "Let's pivot". Just naturally transition to the next question.
- Do not use yes/no steering questions.
- Keep the full spoken reply to 2-4 sentences total.
- Sound like a seasoned professional in a live conversation, not a quiz bot.
- When referencing a candidate's resume project, DO NOT read the raw bullet points. Weave it in conversationally (e.g., "I saw you used X for your work at Y...").
- Semantic Repetition: Do NOT repeat the exact same conversational phrasing or transition styles (e.g., 'That is a great explanation', 'I see you have experience with') across different turns. Ensure high variety in your validation and transitions.
- CRITICAL VOICE RULE: Do NOT use asterisks, bold text, emojis, or any Markdown formatting. Output only plain spoken text. The voice synthesizer will fail with a 400 error if it encounters Markdown.
- CRITICAL VOICE-ONLY RULE: This is a spoken interview. NEVER ask the candidate to type, write, paste, chat, fill a form, share a code snippet in text, or complete any written exercise. Ask only questions they can answer out loud."""


CLOSING_HANDSHAKE_SCRIPT = (
    "We have covered the topics for this conversation. "
    "Thank you for your time. That completes this part of the interview."
)

HR_CLOSING_SCRIPT = (
    "We are wrapping up this session. Thank you for your time today. "
    "We will be in touch with the next steps shortly."
)

PRE_ASSESSMENT_SCRIPT = (
    "Thank you from my side, that concludes our interview. You have completed the assessment successfully."
)

SCREEN_SHARE_REMINDER = (
    "I noticed your screen isn't shared yet. Please share your screen so we can "
    "open the assessment environment."
)

INTRO_VERBAL_SYSTEM_PROMPT = f"""You are an elite interviewer in a live voice conversation.

Rules for natural dialogue:
- Listen to what the candidate just said and respond directly to it.
- Prefer follow-up questions on their current answer before switching skills.
- If they give a shallow answer, probe with a targeted scenario on the active competency.
- Sound conversational, not like a fixed questionnaire.
- Ask conceptual and judgment questions about the active competency — no live exercises, trivia, or rote recall on this pass.
- NEVER ask them to type, write, paste, or complete any text/code exercise — answers must be spoken only.
- {INTERVIEWER_ROLE_RULE}
- {MULTILINGUAL_RULE}"""

INTRO_VERBAL_RESUME_SYSTEM_PROMPT = f"""You are an elite interviewer in a live voice conversation.

Rules for natural dialogue:
- Listen to what the candidate just said and respond directly to it.
- Validate a specific resume claim tied to the active competency.
- Prefer follow-up questions on their current answer before switching skills.
- Sound conversational, not like a fixed questionnaire.
- Ask conceptual and judgment questions — no live exercises, trivia, or rote recall on this pass.
- NEVER ask them to type, write, paste, or complete any text/code exercise — answers must be spoken only.
- {INTERVIEWER_ROLE_RULE}
- {MULTILINGUAL_RULE}"""

HR_VERBAL_SYSTEM_PROMPT = f"""You are an HR Director in a live voice interview after a practical assessment.

Rules:
- Conduct a realistic interview that covers the candidate's full resume — projects, skills, and experience across their domains.
- Rotate naturally across resume skills and domains; do not hammer one topic back-to-back.
- Blend behavioral questions (collaboration, ownership, communication) with light depth on resume-listed competencies.
- In the closing window, cover notice period, salary expectations, and team fit.
- Keep responses concise and professional (2-4 spoken sentences).
- {INTERVIEWER_ROLE_RULE}
- {MULTILINGUAL_RULE}"""

_ADVANCED_ROLE_RULE = (
    "Senior/Lead interview: ask about architectural judgment, system trade-offs, scalability, "
    "failure domains, and handling complex situations in this role. "
    "Do not default to software design unless the role is technical."
)

_MID_ROLE_RULE = (
    "Mid-level interview: ask practical questions about feature implementation, component design, "
    "clean coding, debugging, and everyday error handling for the active competency. "
    "Inquire about practical decisions and edge cases they handle in regular development. "
    "Do NOT demand enterprise-scale system trade-offs, distributed consensus, or principal-level architecture."
)

_ENTRY_PRACTICAL_RULE = (
    "Entry-level / Junior interview: ask practical questions about fundamental concepts, core syntax, "
    "standard tool usage, and basic problem solving for the active competency. Whenever introducing a competency, "
    "provide a lightweight, concrete scenario with straightforward steps rather than vague open-ended or advanced questions "
    "(e.g., writing a helper function, handling input validation, or basic API usage). "
    "Do NOT ask for end-to-end multi-tier pipeline design, system-wide trade-offs, or advanced architecture."
)

_ENTRY_PRACTICAL_RESUME_RULE = (
    "Entry-level / Junior interview: ask practical questions about foundational skills, basic workflows, "
    "and projects or coursework on their resume. "
    "Frame questions around straightforward tasks and their direct contribution. "
    "Do NOT ask senior-level strategy or advanced system design."
)

_NO_CV_RULE = (
    "Question-source policy: This turn is TECHNICAL/PRACTICAL. "
    "Do NOT open with a CV project walkthrough, named resume project, or experience recap. "
    "Ask about the active competency/concept itself. "
    "Obey any no-CV / no-resume directive in the system addon below."
)

_RESUME_MUST_RULE = (
    "Question-source policy: This turn MUST be RESUME_VALIDATION. "
    "Ask exactly ONE question grounded in a named resume project, experience bullet, "
    "or explicit CV claim (use the resume_anchor / Candidate Context below). "
    "Do NOT ask a generic abstract technical question about retries, pooling, indexing, "
    "or theory unless it is explicitly tied to that named project/claim. "
    "Forbidden: pure hypotheticals with no project name."
)


def _allows_resume_context(question_source: QuestionSource | str | None) -> bool:
    return normalize_question_source(question_source) == "RESUME_VALIDATION"


def build_resume_fallback_question(
    *,
    resume_anchor: str | None,
    current_tech: str,
    job_profile_context: dict | None = None,
) -> str:
    """Deterministic spoken question when the LLM drifts off RESUME_VALIDATION."""
    anchor = (resume_anchor or "").strip()
    if job_profile_context:
        from candidate_knowledge import pick_resume_anchor

        chosen = pick_resume_anchor(
            job_profile_context,
            existing=anchor or None,
            rubric_label=current_tech,
        )
        anchor = chosen or ""
    tech = (current_tech or "this area").strip()
    topic = topic_display_name(tech) if tech else "this work"
    if anchor:
        return (
            f"Thanks. On {anchor}, how did you use {topic} in your work?"
        )
    return ""


def build_icebreaker_opening_message(
    *,
    candidate_name: str | None = None,
    resume_skills: list[str],
    phase: str = "intro_verbal",
) -> str:
    name_hint = f" Their name is {candidate_name}." if candidate_name else ""
    skills_line = ", ".join(resume_skills[:6]) if resume_skills else "their background"
    if phase == "hr_verbal":
        return (
            f"Begin the HR interview.{name_hint} "
            "Welcome them back after the practical assessment. "
            "Ask them to tell you about themselves — their background, journey, and what they enjoy working on. "
            f"Their resume highlights: {skills_line}. "
            "Do not ask a depth quiz or notice-period question yet."
        )
    return (
        f"Begin the screening interview.{name_hint} "
        "Give a warm greeting and ask them to tell you about themselves — "
        "their background, journey, and what they enjoy working on. "
        f"Their resume lists skills and domains such as: {skills_line}. "
        "Do not ask a depth or judgment question on this opening turn."
    )


def job_profile_question_context(job_profile_context: dict | None, *, entry_level: bool = False) -> str:
    """Department and seniority the question generator must see on every turn."""
    profile = job_profile_context or {}
    department = str(profile.get("department") or "").strip() or "not specified"
    raw_seniority = str(profile.get("seniority_level") or "").strip()
    band = canonical_seniority_band(raw_seniority, entry_level=entry_level)
    labels = {
        "junior": "Junior",
        "mid": "Mid-Level",
        "mid level": "Mid-Level",
        "senior": "Senior",
        "lead": "Staff/Principal",
        "staff": "Staff/Principal",
        "principal": "Staff/Principal",
        "staff principal": "Staff/Principal",
    }
    seniority_label = labels.get(raw_seniority.lower().replace("/", " ").replace("-", " "), raw_seniority or "not specified")
    title = str(profile.get("title") or "").strip() or "not specified"
    return (
        "JOB PROFILE (use this before every question):\n"
        f"- Job title: {title}\n"
        f"- Department: {department}\n"
        f"- Seniority: {seniority_label}\n"
        f"- Question depth: {band}\n"
        "The department decides the kind of question. Engineering, Design, Product Management, "
        "Sales, People, and Growth are different jobs. Do not ask an engineering question for a "
        "non-engineering department, or a sales question for an engineering department.\n"
        "Match depth to Question depth. Junior and Staff/Principal stay at junior depth. "
        "Mid-Level stays mid-level. Senior stays senior.\n"
        "This seniority is fixed for the whole interview. A strong answer does not raise it. "
        "A weak answer does not lower it. Follow-ups only change how deeply you explore "
        "the same seniority.\n"
    )


def _question_lock_line(action: OrchestratorAction) -> str:
    """Keep the spoken question on the rubric the plan just locked."""
    tech = (getattr(action, "current_tech", None) or "").strip()
    if not tech or action.mode in ("icebreaker", "closing"):
        return ""
    if action.mode in ("probe_depth", "challenge", "clarify", "reorient", "analogous"):
        return (
            f"This is the one follow-up for the current question about {tech}. "
            "Stay on that question. Do not start a new topic."
        )
    return (
        f"Ask a new question about {tech} only. "
        "Do not continue a topic from earlier in the conversation."
    )


def build_topic_question_prompt(
    action: OrchestratorAction,
    *,
    current_tech: str,
    turn: int,
    min_turns: int,
    max_turns: int,
    phase: str = "intro_verbal",
    resume_skills: list[str] | None = None,
    entry_level: bool = False,
    job_profile_context: dict | None = None,
    interview_language: str | None = None,
) -> str:
    if phase == "pre_assessment":
        return PRE_ASSESSMENT_SCRIPT

    qs = normalize_question_source(getattr(action, "question_source", None))
    allow_resume = _allows_resume_context(qs)

    if phase == "hr_verbal":
        base_prompt = HR_VERBAL_SYSTEM_PROMPT
    elif allow_resume:
        base_prompt = INTRO_VERBAL_RESUME_SYSTEM_PROMPT
    else:
        base_prompt = INTRO_VERBAL_SYSTEM_PROMPT

    topic_label = topic_display_name(action.topic)
    skills_line = ", ".join(resume_skills or []) or current_tech

    context_addon = ""
    if allow_resume and job_profile_context:
        proj = job_profile_context.get("resume_projects")
        exp = job_profile_context.get("resume_experience")
        if proj or exp:
            context_addon = "\nCandidate Context:\n"
            if proj:
                context_addon += f"- Projects: {proj}\n"
            if exp:
                context_addon += f"- Experience: {exp}\n"
            context_addon += (
                "Use the above context to ground this RESUME_VALIDATION question "
                "in a specific past claim.\n"
            )

    if allow_resume:
        mode_hints: dict[ActionMode, str] = {
            "icebreaker": (
                "Opening turn only: warm greeting and ask them to tell you about themselves. "
                "No depth quiz yet."
            ),
            "ask": (
                f"Ask ONE resume-grounded question about {current_tech} tied to a named "
                "project/claim from Candidate Context or resume_anchor."
            ),
            "recovery": (
                f"Simplify to an easier resume-grounded question about how they used "
                f"{current_tech} on a named project. Not abstract theory."
            ),
            "pivot": (
                f"Pivot to {topic_label} via a specific resume project/claim — name the project."
            ),
            "tech_pivot": (
                f"Move to {current_tech} by validating a specific resume project/claim. "
                "Name the project. Do not ask a generic technical question."
            ),
            "closing": (
                HR_CLOSING_SCRIPT
                if phase == "hr_verbal"
                else "Deliver the closing fairness handshake only."
            ),
            "probe_depth": (
                f"Probe depth on how they applied {current_tech} inside a named resume "
                "project/claim. The project name must appear in your question."
            ),
            "challenge": (
                f"Challenge a trade-off they faced while using {current_tech} on a named "
                "resume project. Name the project. Stay at the seniority in JOB PROFILE."
            ),
            "clarify": (
                f"Clarify a gap using a concrete scene from their resume project involving "
                f"{current_tech}. Name the project."
            ),
            "reorient": (
                f"Ask another angle on a practical task they did with {current_tech} "
                "on a named resume project. Stay at the same seniority. Do not make it a junior question."
            ),
            "analogous": (
                "Acknowledge parallel experience and probe how they applied that tool "
                "on a named resume project."
            ),
        }
    else:
        mode_hints = {
            "icebreaker": (
                "Opening turn only: warm greeting and ask them to tell you about themselves. "
                "No depth quiz yet."
            ),
            "ask": (
                f"Continue the interview on competency {current_tech}. "
                "Ask a TECHNICAL or PRACTICAL question about the active concept — "
                "not a CV project walkthrough. Ground it in a concrete, lightweight scenario "
                "rather than an overly broad or vague question."
            ),
            "recovery": (
                f"Simplify to an easier technical/practical question about {current_tech} — "
                "judgment and fundamentals, not rote recall. One recovery attempt only. "
                "Do NOT open with a resume project."
            ),
            "pivot": f"Pivot to a new area: {topic_label}.",
            "tech_pivot": (
                f"Pivot to competency {current_tech}. "
                "Ask ONE fresh TECHNICAL or PRACTICAL question about that competency only. "
                "Do NOT begin with a CV project walkthrough or named resume project. "
                "Provide a lightweight, concrete scenario (e.g. building a specific workflow, pipeline, or feature); "
                f"never ask vague open-ended questions like 'how would you handle {current_tech}?'. "
                "Do not repeat subtopics already covered in this session."
            ),
            "closing": (
                HR_CLOSING_SCRIPT
                if phase == "hr_verbal"
                else "Deliver the closing fairness handshake only."
            ),
            "probe_depth": (
                f"Probe technical depth, internal mechanics, or architectural trade-offs regarding {current_tech}."
            ),
            "challenge": (
                f"Ask a harder follow-up on {current_tech} while staying at the seniority "
                "already given in JOB PROFILE. Do not jump to a higher seniority."
            ),
            "clarify": (
                f"Target the candidate's misconception with a concrete scenario or trade-off "
                f"regarding {current_tech} to test if they can self-correct."
            ),
            "reorient": (
                f"Ask a different angle on {current_tech} at the same seniority in JOB PROFILE. "
                "Do not drop to a lower seniority, and do not open a resume project to rescue a weak answer."
            ),
            "analogous": (
                "Acknowledge their parallel experience and probe depth on how they applied "
                "that alternative tool in your work."
            ),
        }

    intent_addon = ""
    if action.intent == "OFFTOPIC":
        intent_addon = " Gently redirect off-topic rambling back to the interview."
    elif action.intent == "ANALOGOUS_REDIRECT":
        intent_addon = " Acknowledge their parallel experience and probe deeper."

    role_depth_rule = ""
    if phase == "intro_verbal" and action.mode != "icebreaker":
        sen = job_profile_context.get("seniority_level") if job_profile_context else None
        band = canonical_seniority_band(sen, entry_level=entry_level)
        if band == "JUNIOR":
            rule = _ENTRY_PRACTICAL_RESUME_RULE if allow_resume else _ENTRY_PRACTICAL_RULE
            role_depth_rule = f"{rule} Focus on {current_tech}.\n"
        elif band == "MID":
            role_depth_rule = f"{_MID_ROLE_RULE} Focus on {current_tech}.\n"
        else:
            role_depth_rule = f"{_ADVANCED_ROLE_RULE} Focus on {current_tech}.\n"

    source_policy = ""
    if phase != "hr_verbal" and action.mode != "icebreaker" and not allow_resume:
        source_policy = f"{_NO_CV_RULE}\n"
    elif phase != "hr_verbal" and action.mode != "icebreaker" and allow_resume:
        source_policy = f"{_RESUME_MUST_RULE}\n"

    anchor = getattr(action, "resume_anchor", None)
    anchor_line = f"resume_anchor={anchor}\n" if allow_resume and anchor else ""

    skills_line_label = (
        "Resume skills and domains for this session"
        if allow_resume or phase == "hr_verbal"
        else "Session competency domains"
    )

    return (
        f"{base_prompt}\n\n"
        f"{job_profile_question_context(job_profile_context, entry_level=entry_level)}\n"
        f"{SYSTEM_STYLE}\n\n"
        f"question_source={qs}\n"
        f"{anchor_line}"
        f"{skills_line_label}: {skills_line}.\n"
        f"Active focus: {current_tech or 'introduction'}. Exchange {turn} "
        f"(at least {min_turns} before wrapping, up to {max_turns}).\n"
        f"{role_depth_rule}"
        f"{source_policy}"
        f"{context_addon}"
        f"{mode_hints.get(action.mode, mode_hints['ask'])}\n"
        f"{action.system_addon}{intent_addon}\n"
        f"{_question_lock_line(action)}\n"
        f"{conduct_language_rule(interview_language)}\n"
        "Output only what you will say aloud."
    )


def build_opening_user_message(
    resume_skills: list[str],
    action: OrchestratorAction,
    *,
    candidate_name: str | None = None,
    phase: str = "intro_verbal",
) -> str:
    return build_icebreaker_opening_message(
        candidate_name=candidate_name,
        resume_skills=resume_skills,
        phase=phase,
    )


def build_closing_prompt(
    *,
    resume_alignment: dict | None,
    code_quality_score: int | None = None,
    architectural_flaws: list[str] | None = None,
    candidate_name: str | None = None,
    phase: str = "hr_verbal",
    interview_language: str | None = None,
) -> str:
    alignment = resume_alignment or {}
    verified = alignment.get("verified") or []
    skipped = alignment.get("skipped_due_to_struggles") or []
    un_assessed = alignment.get("un_assessed_due_to_time") or []
    name_hint = f"Address {candidate_name} by name. " if candidate_name else ""
    assessment_line = ""
    if code_quality_score is not None:
        flaws = ", ".join(architectural_flaws or []) or "none noted"
        assessment_line = (
            f"Acknowledge their practical assessment (quality score {code_quality_score}/10; "
            f"noted areas: {flaws}). "
        )
    
    base_prompt = HR_VERBAL_SYSTEM_PROMPT if phase == "hr_verbal" else INTRO_VERBAL_SYSTEM_PROMPT
    
    if phase == "hr_verbal":
        closing_instructions = (
            "3) Deliver a warm professional sign-off and thank them for their time.\n"
            "4) DO NOT ask any questions (like notice period) because the session will disconnect immediately after you speak.\n"
        )
    else:
        closing_instructions = (
            "3) Wrap up the technical screening politely and inform them that this part of the interview is complete.\n"
            "4) DO NOT ask if they have any final questions, because the system will automatically transition to the next phase immediately after you speak.\n"
        )

    return (
        f"{base_prompt}\n\n"
        f"{SYSTEM_STYLE}\n\n"
        f"{name_hint}Deliver exactly ONE closing spoken turn that:\n"
        f"1) Summarizes topics covered — verified: {', '.join(verified) or 'none'}; "
        f"skipped: {', '.join(skipped) or 'none'}.\n"
        f"2) {assessment_line}"
        f"{closing_instructions}"
        f"{conduct_language_rule(interview_language)}\n"
        "Output only what you will say aloud (2-4 sentences)."
    )
