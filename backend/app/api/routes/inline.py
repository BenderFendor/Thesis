from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.inline import InlineDefineRequest, InlineDefineResponse
from app.services.inline_definition import define_term_with_gemini

router = APIRouter(tags=["inline"])


@router.post("/api/inline/define", response_model=InlineDefineResponse)
async def define_inline(request: InlineDefineRequest) -> InlineDefineResponse:
	"""Return a short one-paragraph definition for a highlighted term.

	Expects JSON: {"term": "Janet Yellen", "context": "US economics"}
	"""
	if not request.term or not request.term.strip():
		raise HTTPException(status_code=400, detail="Term must not be empty")

	result = await define_term_with_gemini(request.term.strip(), request.context)
	if "error" in result:
		return InlineDefineResponse(
			success=False, term=request.term, definition=None, error=result.get("error")
		)

	return InlineDefineResponse(
		success=True, term=request.term, definition=result.get("definition", "")
	)
