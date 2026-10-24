"""HTTP and in-process controls for live viva sessions."""



from __future__ import annotations



import logging



from viva_runtime_registry import get_viva_state



logger = logging.getLogger("viva-control")





async def apply_viva_control(

    token: str,

    action: str,

    *,

    text: str | None = None,

    topic: str | None = None,

    language: str | None = None,

) -> dict:

    state = get_viva_state(token)

    if state is None:

        logger.warning("Viva control ignored — no active state token=%s action=%s", token, action)

        return {"ok": False, "reason": "no_active_session"}



    if action == "pause":

        state.paused = True

        return {"ok": True, "paused": True}



    if action == "resume":

        state.paused = False

        state.paused_event.set()

        return {"ok": True, "resumed": True}



    if action == "inject":

        if not text or not text.strip():

            return {"ok": False, "reason": "text_required"}

        state.injected_queue.append({"text": text.strip(), "topic": topic})

        state.paused_event.set()

        return {"ok": True, "queued": True}



    if action == "skip":

        state.skip_pending = True

        state.paused_event.set()

        return {"ok": True, "skip": True}



    if action == "student_pass":

        state.skip_pending = True

        state.paused_event.set()

        return {"ok": True, "student_pass": True}



    if action == "takeover":

        state.human_takeover = True

        state.panel_mode = "human_takeover"

        state.paused = True

        return {"ok": True, "takeover": True}



    if action == "release_ai":

        state.human_takeover = False

        state.panel_mode = "ai_co_questioner"

        state.paused = False

        state.paused_event.set()

        state.takeover_event.set()

        return {"ok": True, "released": True}



    if action == "set_language":

        if language:

            state.pending_language = language

        state.paused_event.set()

        return {"ok": True, "language": language}



    return {"ok": False, "reason": "unknown_action"}

