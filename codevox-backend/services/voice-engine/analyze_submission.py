import os
from typing import Any

import httpx

AI_EVALUATION_URL = os.getenv("AI_EVALUATION_SERVICE_URL", "http://localhost:8000").rstrip("/")


async def analyze_submission(
    source_code: str,
    language: str = "PYTHON",
) -> dict[str, Any]:
    code = (source_code or "").strip()
    if not code:
        return {"code_quality_score": 0, "architectural_flaws": ["empty_submission"]}

    payload = {
        "codeText": code[:12000],
        "techStack": language.upper(),
        "questionContext": "Autonomous interview coding stage",
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                f"{AI_EVALUATION_URL}/api/v1/evaluate-code",
                json=payload,
            )
            if res.status_code == 200:
                data = res.json()
                return {
                    "code_quality_score": int(data.get("quality_score", 0)),
                    "architectural_flaws": list(data.get("architectural_flaws") or []),
                }
    except Exception:
        pass

    # Heuristic fallback when ai-evaluation is offline
    flaws: list[str] = []
    if "eval(" in code or "exec(" in code:
        flaws.append("unsafe_dynamic_execution")
    if len(code.splitlines()) > 400:
        flaws.append("excessive_file_length")
    score = min(100, max(10, len(code) // 20))
    return {"code_quality_score": score, "architectural_flaws": flaws or ["manual_review_required"]}
